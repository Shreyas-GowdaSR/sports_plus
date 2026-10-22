import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GoogleGenAI } from '@google/genai'
import { createRetriever } from './rag.mjs'

const root = dirname(fileURLToPath(import.meta.url))

function loadLocalEnvironment() {
  const localEnv = join(root, '.env.local')
  if (!existsSync(localEnv)) return
  for (const line of readFileSync(localEnv, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(GEMINI_API_KEY|GEMINI_MODEL|GEMINI_NUTRITION_MODEL)\s*=\s*(.*?)\s*$/)
    if (!match || process.env[match[1]]) continue
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}
loadLocalEnvironment()

const port = Number(process.env.PORT ?? 8787)
const distPath = join(root, 'dist')
const model = process.env.GEMINI_MODEL ?? process.env.GEMINI_NUTRITION_MODEL ?? 'gemini-3.8-flash'
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null

// ── Evidence library (RAG) ───────────────────────────────────
// Cited passages from knowledge/corpus, embedded into a FAISS index by rag/build_index.py
// and searched by meaning (rag.mjs). The coach uses them silently to get facts right.
const knowledgeDir = join(root, 'knowledge')
const retriever = createRetriever({ indexDir: join(knowledgeDir, 'index'), gemini })
const STOP = new Set('about after also and are can could does for from have how into is just like meal much my need should some that the their there this through what when which with would you your will want tell give me'.split(' '))
const tokenize = text => text.toLowerCase().match(/[a-z0-9]+/g)?.filter(word => word.length > 2 && !STOP.has(word)) ?? []

async function findEvidence(question) {
  if (!retriever || !question.trim()) return { mode: 'none', hits: [] }
  try { return await retriever.search(question) }
  catch (error) { console.warn('[rag] search failed:', error); return { mode: 'none', hits: [] } }
}

// Food values from the Kaggle Indian Food Nutrition dataset, only when the athlete asks for them.
const foods = (() => {
  const file = join(knowledgeDir, 'dataset', 'Indian_Food_Nutrition_Processed.csv')
  if (!existsSync(file)) return []
  const cells = line => { const out = []; let cell = ''; let quoted = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') quoted = !quoted; else if (c === ',' && !quoted) { out.push(cell.trim()); cell = '' } else cell += c } out.push(cell.trim()); return out }
  return readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1).map(line => {
    const [name, kcal, carbs, protein, fat, , fibre] = cells(line)
    return { name, kcal: +kcal, carbs: +carbs, protein: +protein, fat: +fat, fibre: +fibre, terms: tokenize(name) }
  }).filter(food => food.name && Number.isFinite(food.kcal))
})()
const ASKS_FOR_VALUES = /\b(calorie|calories|kcal|macro|macros|nutrition(al)? (value|values|facts|info)|how much (protein|carb|carbs|fat|fibre|fiber|sugar) (is |are )?(in|does)|protein in|carbs in|fat in)\b/i

function foodValues(question) {
  if (!ASKS_FOR_VALUES.test(question)) return []
  const wanted = new Set(tokenize(question))
  return foods.map(food => ({ food, hits: food.terms.filter(term => wanted.has(term)).length / Math.max(food.terms.length, 1) }))
    .filter(item => item.hits >= 0.5).sort((a, b) => b.hits - a.hits).slice(0, 3)
    .map(({ food }) => `${food.name} (per standard serving in the Indian Food Nutrition dataset): ${Math.round(food.kcal)} kcal, ${food.carbs.toFixed(0)} g carbs, ${food.protein.toFixed(0)} g protein, ${food.fat.toFixed(0)} g fat, ${food.fibre.toFixed(0)} g fibre`)
}

// ── Coach prompt ─────────────────────────────────────────────
const COACH_RULES = `You are "Coach" inside SportsAI+, a personal running coach and sports-nutrition guide for Indian athletes. Your job is to tell the athlete exactly what to eat and drink, how much, and when, so they train well and stay healthy.

HOW TO TALK
- Very simple English, like a friendly Indian coach talking to a college athlete. Short sentences, everyday words.
- If you must use a term, explain it in brackets, e.g. "carbs (energy foods like rice, idli, banana)", "kcal (calories, the energy in food)".
- Talk to the athlete as "you". Use their first name once in a while.
- Indian home foods and Indian measures: katori, glass (250 ml), cup, plate, chapati, idli, dosa, handful, tablespoon. Water in ml or glasses.
- Use "- " bullet points and **bold** headings. No long introductions, no "Great question", no closing summary.

HOW TO ANSWER
Read the question and pick ONE of these shapes.

A) GUIDANCE QUESTIONS: what to eat or drink for a session or a day, a diet plan, "what should I eat", "guide me", how to eat as an athlete. Answer in three short parts, about 15–25 lines in total:
  1. **For your session** (only if a session is mentioned or planned today): **Before**, **During**, **After**, **Water**, each with foods, amounts and timing, plus one swap per item ("or ...").
  2. **Your day**: name the day type and give its targets: energy (kcal), protein, carbs, fat, water. For today's session use the Day type and values in TODAY'S TARGETS exactly. For any other day, choose from ATHLETE NUMBERS: rest day; normal training day (up to about 90 minutes of running, or a gym session); hard or long day (a race, 90 minutes or more, or two sessions).
  3. **How to hit it**: a sample day of 6 lines in clock order around the training time, each with a time, foods with amounts, about how much protein it gives, and one swap. Build it from the FOOD SIZES so the whole day lands inside the protein and energy ranges; if your meals add up short, add a glass of milk, a katori of dal or curd, or a handful of nuts. End with one line: "This day gives about ... g protein and ... kcal."
     - Morning runner (training before 9 am): pre-run snack → post-run breakfast → mid-morning → lunch → evening snack → dinner. The post-run meal IS breakfast; do not list a separate "after training" meal later in the day.
     - Evening runner: breakfast → mid-morning → lunch → pre-run snack → post-run snack → dinner (dinner is the recovery meal).
     - Use real Indian meal types for each slot: breakfast = idli, dosa, pongal, poha, upma, paratha, oats or eggs; lunch and dinner = rice or chapati with dal, sabzi, curd, paneer, soya, egg or meat; snacks = fruit, milk, curd, sprouts, chana, nuts.

B) SPECIFIC QUESTIONS: one food, one swap, one number, cramps, sleep, a recipe, eating out, fasting, festivals, hostel food, budget, form, motivation. Answer that question directly in about 5–12 lines, with 2–3 alternatives where food is involved. If it is about protein, energy or water, also give the matching daily target in one line ("Across the day you need ...").

C) OUTSIDE SPORT AND HEALTH: give a short, helpful answer, then offer to help with running or food.

Never reply with the same text twice. Never paste TODAY'S PLAN when it does not answer the question.

NUMBERS (very important)
- Daily and per-session targets (kcal, protein, carbs, fat, water) must come from ATHLETE NUMBERS or TODAY'S PLAN, copied exactly. Never invent or recalculate them.
- Gym, weights, strength or "intense workout" questions use the gym lines; running questions use the run lines.
- Always write a range low to high, e.g. "20–25 g", never "25–20 g".
- For a meal, you may add up the FOOD SIZES to say about how much protein or energy it gives (for example "about 24 g protein"). Keep these clearly approximate ("about").
- Timing rules not in the numbers: before a run, a light familiar carb meal 1–3 hours ahead, or a small snack 30–90 min ahead for runs before 8 am. During runs under 60 min, water only; 60–90 min, about 30 g carbs per hour; 90–150 min, about 45 g per hour; longer, about 60 g per hour. For runs over 90 min or in heat, add salt (ORS, or 1/8 tsp salt per 500 ml).
- If asked about BMI: weight divided by height squared; 18.5–25 is the healthy range; it over-reads for very muscular athletes.

FOOD SIZES (approximate, for building meals)
- Carbs: 1 idli ≈ 8 g carbs, 60 kcal · 1 plain dosa ≈ 20 g, 130 kcal · 1 chapati ≈ 15 g, 100 kcal · 1 cup cooked rice ≈ 45 g, 200 kcal · 1 plate poha or upma ≈ 40 g, 250 kcal · 1 banana ≈ 27 g, 105 kcal · 3 dates ≈ 18 g, 70 kcal · 2 slices bread ≈ 26 g, 140 kcal · 1 medium sweet potato ≈ 25 g, 110 kcal · 500 ml homemade glucose drink (2 tbsp sugar) ≈ 25 g, 100 kcal.
- Protein: 1 katori dal ≈ 7 g protein, 150 kcal · 1 katori chana or rajma ≈ 7 g, 160 kcal · 1 katori curd ≈ 5 g, 90 kcal · 1 glass milk ≈ 8 g, 150 kcal · 50 g paneer ≈ 9 g, 145 kcal · 1 small katori soya chunks ≈ 13 g, 90 kcal · 1 katori sprouts ≈ 5 g, 100 kcal · 1 egg ≈ 6 g, 75 kcal · 100 g chicken ≈ 25 g, 165 kcal · 100 g fish ≈ 20 g, 130 kcal · 30 g roasted chana ≈ 6 g, 110 kcal · 1 handful peanuts or nuts (30 g) ≈ 7 g, 170 kcal.
- Fat: 1 tsp oil or ghee ≈ 45 kcal · 1 tbsp ≈ 120 kcal.

FOOD RULES
- Follow the athlete's diet strictly. veg = no egg, meat or fish. egg = eggs allowed, no meat or fish. vegan = no milk, curd, paneer, ghee, honey or eggs. Never suggest anything in their "avoid" list.
- Whenever you suggest a food, drink or meal, give a swap or two with amounts. If they dislike or cannot get something, lead with the alternatives.
- Prefer cheap, easy Indian foods; add a hostel or travel option when it helps.
- For running-form questions, use the LATEST FORM CHECK: the one most important fix and 1–2 drills with sets and reps.
- EVIDENCE holds short passages from sports-science research and Indian nutrition guidelines, picked for this question. Use them to get facts right and to add a useful tip or warning. If a passage disagrees with ATHLETE NUMBERS, follow ATHLETE NUMBERS. Ignore passages that do not fit the question. Write everything in your own simple words: never copy passages, never add citations, reference numbers or a sources list, and never mention "evidence", "passages", "studies say", "sources", "RAG" or "dataset".
- If something important is missing (run time, distance, gym or run), make a sensible guess, say it in one line, and answer anyway.

SAFETY
- The energy numbers are for keeping weight steady while training well. Do not design weight-loss or weight-gain diets or calorie deficits; if asked, give the maintenance numbers, simple healthy habits, and suggest a sports dietitian.
- Warn simply if someone seems to be eating far too little for their training: it causes tiredness, injuries and missed periods.
- No supplement or medicine doses. For pain, injury, fainting, chest pain, diabetes, pregnancy, eating disorders, very heavy periods or long tiredness: kindly tell them to see a doctor or sports physio or dietitian first, then give only safe general tips.
- Never tell them to drink as much water as possible. Too much plain water during long runs is dangerous.`

function contextBlock(context, question, evidence) {
  const values = foodValues(question)
  return [
    COACH_RULES,
    `\n=== ATHLETE ===\n${context.athlete || 'Not set'}`,
    `\n=== ATHLETE NUMBERS (pre-calculated; copy these exactly, never compute your own) ===\n${context.numbers || 'Not set'}`,
    `\n=== TODAY'S PLAN (already calculated for this athlete) ===\n${context.plan || 'Not set'}`,
    `\n=== LATEST FORM CHECK ===\n${context.form || 'No form check yet. If they ask about form, suggest they upload a 10–20 second side-view running video in Form check.'}`,
    evidence.length ? `\n=== EVIDENCE (for checking facts; do not cite) ===\n${evidence.map(item => `- ${item.section}: ${item.text.replace(/\s+/g, ' ')}`).join('\n')}` : '',
    values.length ? `\n=== FOOD VALUES (the athlete asked for numbers) ===\n${values.map(value => `- ${value}`).join('\n')}` : '',
  ].join('\n')
}

async function coachRequestFrom(payload) {
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const clean = messages.slice(-12).flatMap(message => {
    if (!message || typeof message.text !== 'string' || !message.text.trim()) return []
    return [{ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.text.trim().slice(0, 2000) }] }]
  })
  if (!clean.length || clean[clean.length - 1].role !== 'user') throw new Error('A question is required.')
  const text = value => (typeof value === 'string' ? value.slice(0, 4000) : '')
  const context = payload.context && typeof payload.context === 'object' ? payload.context : {}
  const question = clean.filter(message => message.role === 'user').slice(-2).map(message => message.parts[0].text).join(' ')
  const evidence = await findEvidence(question)
  const system = contextBlock({ athlete: text(context.athlete), numbers: text(context.numbers), plan: text(context.plan), form: text(context.form) }, question, evidence.hits)
  return { contents: clean, system, evidence }
}

// ── HTTP ─────────────────────────────────────────────────────
function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(payload))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []
    request.on('data', chunk => { size += chunk.length; if (size > 200_000) { reject(new Error('Request is too large')); request.destroy() } else chunks.push(chunk) })
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(new Error('Request must be valid JSON')) } })
    request.on('error', reject)
  })
}

// Busy (503) or rate-limited (429) models are common on the free tier. Try the
// configured model twice, then fall back to other Flash models before giving up.
// ── Model pool ───────────────────────────────────────────────
// The free tier allows about 20 requests a day *per model*, and Google retires
// models over time. Work through every usable Flash model in order of quality:
// a retired model (404) is dropped for good, and a model that hit its quota (429)
// is parked until the reset time Google reports, so requests never wait on it.
const PREFERRED = [
  'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest',
  'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite',
]
let pool = [model, ...PREFERRED].filter((name, index, all) => all.indexOf(name) === index)
const retired = new Set()
const parkedUntil = new Map()
const noThinking = new Set()

async function refreshPool() {
  if (!gemini) return
  try {
    const available = new Set()
    for await (const entry of await gemini.models.list()) {
      if (entry.supportedActions?.includes('generateContent')) available.add(entry.name.replace(/^models\//, ''))
    }
    pool = pool.filter(name => available.has(name))
    console.log(`coach: model pool ${pool.join(', ')}`)
  } catch (error) {
    console.warn(`coach: could not list models (${error?.status ?? error?.message}); using the default pool`)
  }
}
refreshPool()

/** Seconds until a quota resets, from Google's "retry in 1h38m5s" / retryDelay text. */
function retrySeconds(error) {
  const text = String(error?.message ?? '')
  const match = text.match(/retry in ((?:\d+h)?(?:\d+m)?(?:[\d.]+s)?)/i)
  if (match) {
    const [, h = 0, m = 0, sec = 0] = match[1].match(/(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/) ?? []
    return Number(h) * 3600 + Number(m) * 60 + Number(sec)
  }
  const delay = text.match(/"retryDelay":\s*"(\d+)s"/)
  return delay ? Number(delay[1]) : 60
}

class CoachUnavailable extends Error {
  constructor(reason, retryAt) { super(reason); this.reason = reason; this.retryAt = retryAt }
}

async function openStream(contents, system) {
  let sawQuota = false
  for (const name of pool) {
    if (retired.has(name) || (parkedUntil.get(name) ?? 0) > Date.now()) continue
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const config = { systemInstruction: system, temperature: 0.5, maxOutputTokens: 4096 }
        if (!noThinking.has(name)) config.thinkingConfig = { thinkingLevel: 'LOW' }
        const stream = await gemini.models.generateContentStream({ model: name, contents, config })
        return { stream, used: name }
      } catch (error) {
        const status = error?.status ?? 0
        if (status === 400 && !noThinking.has(name) && /thinking/i.test(String(error?.message))) { noThinking.add(name); continue }
        if (status === 404) { retired.add(name); console.warn(`coach: ${name} is retired, removed from the pool`) }
        else if (status === 429) {
          sawQuota = true
          const wait = retrySeconds(error)
          parkedUntil.set(name, Date.now() + wait * 1000)
          console.warn(`coach: ${name} hit its quota, parked for ${Math.round(wait / 60)} min`)
        } else console.warn(`coach: ${name} failed (${status || 'network'}), trying the next model`)
        break
      }
    }
  }
  const nextReset = Math.min(...[...parkedUntil.values()].filter(time => time > Date.now()))
  throw new CoachUnavailable(sawQuota || parkedUntil.size ? 'quota' : 'unavailable', Number.isFinite(nextReset) ? new Date(nextReset).toISOString() : null)
}

async function streamCoach(request, response) {
  if (!gemini) return send(response, 503, { error: 'GEMINI_API_KEY is not set on the server.', reason: 'no-key' })
  const { contents, system, evidence } = await coachRequestFrom(await readJson(request))
  let opened
  try { opened = await openStream(contents, system) }
  catch (error) {
    if (error instanceof CoachUnavailable) return send(response, 503, { error: 'All AI models are busy or out of free quota.', reason: error.reason, retryAt: error.retryAt })
    throw error
  }
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Coach-Model': opened.used,
    'X-Coach-Retrieval': `${evidence.mode}; ${evidence.hits.map(hit => hit.id).join(', ') || 'none'}` })
  let wrote = false
  for await (const chunk of opened.stream) {
    const text = chunk.text
    if (text) { response.write(text); wrote = true }
  }
  if (!wrote) response.write('Sorry, I could not answer that just now. Please ask again.')
  response.end()
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' }
function serveStatic(response, pathname) {
  if (!existsSync(distPath)) return send(response, 404, { error: 'Frontend build not found. Run npm run build, or use npm run dev:all.' })
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const candidate = normalize(join(distPath, requested))
  const inside = candidate === distPath || candidate.startsWith(`${distPath}${sep}`)
  const file = inside && existsSync(candidate) ? candidate : join(distPath, 'index.html')
  response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' })
  createReadStream(file).pipe(response)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  try {
    if (request.method === 'GET' && url.pathname === '/api/coach/status') {
      const ready = pool.filter(name => !retired.has(name) && (parkedUntil.get(name) ?? 0) <= Date.now())
      return send(response, 200, { live: Boolean(gemini) && ready.length > 0, model: ready[0] ?? null, models: ready.length, rag: retriever?.info ?? null })
    }
    if (request.method === 'GET' && url.pathname === '/api/rag/search') {
      const question = (url.searchParams.get('q') ?? '').slice(0, 500)
      if (!question.trim()) return send(response, 400, { error: 'Add ?q=your question' })
      return send(response, 200, { question, ...(await findEvidence(question)) })
    }
    if (request.method === 'POST' && url.pathname === '/api/coach') return await streamCoach(request, response)
    if (url.pathname.startsWith('/api/')) return send(response, 404, { error: 'Unknown API route' })
    return serveStatic(response, url.pathname)
  } catch (error) {
    console.error(error)
    if (response.headersSent) return response.end()
    return send(response, 502, { error: error instanceof Error ? error.message : 'Request failed' })
  }
})

server.listen(port, '127.0.0.1', () => console.log(`SportsAI+ server on http://127.0.0.1:${port} · coach ${gemini ? 'live' : 'offline (no GEMINI_API_KEY)'} · ${retriever ? `RAG: ${retriever.info.chunks} cited passages, ${retriever.info.vectors ? `vector index (${retriever.info.model}, ${retriever.info.dim} dims)` : 'keyword search only (no vectors.f32)'}` : 'RAG: no index (run python rag/build_index.py)'}`))
