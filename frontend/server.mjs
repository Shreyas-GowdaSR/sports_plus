import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GoogleGenAI } from '@google/genai'

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

// ── Reference library (RAG) ──────────────────────────────────
// Knowledge files are background reading for the coach, never the answer itself.
const knowledgeDir = join(root, 'knowledge')
const DUBIOUS = /ashwagandha|nattokinase|clinically proven|2000%|mandatory/i
const STOP = new Set('about after also and are can could does for from have how into is just like meal much my need should some that the their there this through what when which with would you your will want tell give me'.split(' '))
const tokenize = text => text.toLowerCase().match(/[a-z0-9]+/g)?.filter(word => word.length > 2 && !STOP.has(word)) ?? []

const passages = ['nutrition', 'form'].flatMap(folder => {
  const dir = join(knowledgeDir, folder)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(name => name.endsWith('.txt')).flatMap(name =>
    readFileSync(join(dir, name), 'utf8').split(/\n\s*\n/)
      .map(text => text.replace(/\s+/g, ' ').replace(/\s*Source:.*$/i, '').trim())
      .filter(text => text.length > 40 && !DUBIOUS.test(text))
      .map(text => ({ text, topic: folder, terms: tokenize(text) })))
})
const docFreq = new Map()
for (const passage of passages) for (const term of new Set(passage.terms)) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)

const EXPAND = {
  before: ['pre', 'workout'], after: ['post', 'recovery'], during: ['carbohydrate', 'fluid'], water: ['hydration', 'fluid', 'sodium'],
  drink: ['hydration', 'fluid'], cramp: ['sodium', 'hydration'], eat: ['carbohydrate', 'food'], protein: ['recovery', 'muscle'],
  knee: ['injury', 'overstriding'], shin: ['injury', 'overstriding'], cadence: ['steps', 'stride'], form: ['gait', 'posture'],
}

function retrieve(query, limit = 4) {
  const terms = new Set(tokenize(query).flatMap(term => [term, ...(EXPAND[term] ?? [])]))
  if (!terms.size) return []
  return passages.map(passage => {
    const counts = new Map()
    for (const term of passage.terms) counts.set(term, (counts.get(term) ?? 0) + 1)
    let score = 0
    for (const term of terms) {
      const count = counts.get(term); if (!count) continue
      const df = docFreq.get(term) ?? 0
      const idf = Math.log(1 + (passages.length - df + 0.5) / (df + 0.5))
      score += idf * (count * 2.2) / (count + 1.2 * (0.25 + 0.75 * passage.terms.length / 90))
    }
    return { ...passage, score }
  }).filter(passage => passage.score > 1).sort((a, b) => b.score - a.score).slice(0, limit)
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
const COACH_RULES = `You are "Coach" inside SportsAI+, a personal running coach and sports-food guide for Indian athletes.

HOW TO TALK
- Use very simple English, the way a friendly Indian coach talks to a college athlete. Short sentences. Everyday words.
- Avoid jargon. If you must use a term, explain it in brackets, e.g. "carbs (energy foods like rice, idli, banana)".
- Talk directly to the athlete ("you"). Use their first name once in a while, not every message.
- Use Indian home foods and Indian measures: katori, glass (250 ml), cup, plate, chapati, idli, handful, tablespoon. Water in ml or glasses.
- Keep it short: usually 4–10 lines. Use "- " bullet points. Bold the time words like **2 hours before**, **During**, **After**, **Water**.
- No long introductions, no "Great question", no closing summary paragraphs.

WHAT TO GIVE
- Always be specific: WHAT to eat or drink, HOW MUCH, and WHEN. Example: "**2 hours before:** 4 idlis with sambar + 1 banana".
- The athlete's data and TODAY'S PLAN below are already calculated for this athlete. Use those amounts. Do not contradict them.
- If the athlete changes something (another time, a longer run, a hot day, a race), adjust the amounts using these rules:
  - Use the PLAN WEIGHT (BMI-adjusted) for food amounts and the actual weight for water.
  - Before: 1–2 g carbs per kg plan weight, 1–3 hours before. For runs before 8 am, a light snack 30–90 min before instead.
  - During: under 60 min = water only. 60–90 min = about 30 g carbs per hour. 90–150 min = 45 g per hour. Longer = 60 g per hour.
  - After: about 0.3 g protein per kg plan weight (15–30 g) plus about 1 g carbs per kg within 1–2 hours.
  - Water: 5–7 ml per kg 2–4 hours before. During: about 400–550 ml/hour (cool), 450–700 (normal), 600–800 (hot), in sips every 15–20 min; a little less for light athletes, a little more for heavy ones. After: 1.5 L for every 1 kg lost, or 500–750 ml in the first hour then until urine is light yellow. Whole day: about 30–35 ml per kg. For runs over 90 min or in heat, add salt (ORS, or ⅛ tsp salt per 500 ml).
  - If the athlete asks about BMI: explain it simply (weight ÷ height²; 18.5–25 is the healthy range) and say it over-reads for very muscular athletes.
  - Food sizes to convert grams into portions: 1 idli ≈ 8 g carbs, 1 banana ≈ 27 g, 1 cup rice ≈ 45 g, 1 chapati ≈ 15 g, 1 plate poha ≈ 40 g, 3 dates ≈ 18 g, 500 ml homemade glucose drink (2 tbsp glucose or sugar) ≈ 25 g. 1 katori dal ≈ 7 g protein, 1 glass milk ≈ 8 g, 50 g paneer ≈ 9 g, 1 egg ≈ 6 g, 100 g chicken ≈ 25 g, small katori soya chunks ≈ 13 g.
- Say the amounts in foods and glasses. Do NOT list calories, grams of protein/carbs/fat, or other nutrient values unless the athlete asks for numbers. If they ask, give them clearly.
- Follow the athlete's diet strictly. veg = no egg, meat or fish. egg = eggs allowed, no meat or fish. vegan = no milk, curd, paneer, ghee, honey or eggs. Never suggest anything in their "avoid" list.
- For running-form questions, use the LATEST FORM CHECK. Give the one most important fix and 1–2 drills with sets and reps.
- REFERENCE NOTES are background facts from the app's library. Use them only to check facts or add one useful tip. Never copy them, never mention "notes", "sources", "RAG" or "dataset".
- If something important is missing (for example the run time or distance), make a sensible guess, say it in one line, and give the answer anyway.

SAFETY
- Do not give supplement or medicine doses, and do not set calorie targets for weight loss.
- For pain, injury, fainting, chest pain, diabetes, pregnancy, eating disorders, very heavy periods or long tiredness: kindly tell them to see a doctor or sports physio/dietitian first, then give only safe general tips.
- Never tell them to drink as much water as possible. Too much plain water during long runs is dangerous.`

function contextBlock(context, question) {
  const reference = retrieve(question)
  const values = foodValues(question)
  return [
    COACH_RULES,
    `\n=== ATHLETE ===\n${context.athlete || 'Not set'}`,
    `\n=== TODAY'S PLAN (already calculated for this athlete) ===\n${context.plan || 'Not set'}`,
    `\n=== LATEST FORM CHECK ===\n${context.form || 'No form check yet. If they ask about form, suggest they upload a 10–20 second side-view running video in Form check.'}`,
    reference.length ? `\n=== REFERENCE NOTES (background only) ===\n${reference.map(item => `- ${item.text}`).join('\n')}` : '',
    values.length ? `\n=== FOOD VALUES (the athlete asked for numbers) ===\n${values.map(value => `- ${value}`).join('\n')}` : '',
  ].join('\n')
}

function coachRequestFrom(payload) {
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const clean = messages.slice(-12).flatMap(message => {
    if (!message || typeof message.text !== 'string' || !message.text.trim()) return []
    return [{ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.text.trim().slice(0, 2000) }] }]
  })
  if (!clean.length || clean[clean.length - 1].role !== 'user') throw new Error('A question is required.')
  const text = value => (typeof value === 'string' ? value.slice(0, 4000) : '')
  const context = payload.context && typeof payload.context === 'object' ? payload.context : {}
  const question = clean.filter(message => message.role === 'user').slice(-2).map(message => message.parts[0].text).join(' ')
  return { contents: clean, system: contextBlock({ athlete: text(context.athlete), plan: text(context.plan), form: text(context.form) }, question) }
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
const FALLBACK_MODELS = [model, 'gemini-3.7-flash', 'gemini-flash-latest'].filter((name, index, all) => all.indexOf(name) === index)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function openStream(contents, system) {
  let lastError
  for (const [index, name] of [FALLBACK_MODELS[0], ...FALLBACK_MODELS].entries()) {
    try {
      const stream = await gemini.models.generateContentStream({
        model: name, contents,
        config: { systemInstruction: system, temperature: 0.4, maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'LOW' } },
      })
      return { stream, used: name }
    } catch (error) {
      lastError = error
      const status = error?.status ?? 0
      if (status && ![429, 500, 503, 504, 404].includes(status)) throw error
      console.warn(`coach: ${name} unavailable (${status || 'network'}), trying next`)
      if (index === 0) await sleep(800)
    }
  }
  throw lastError
}

async function streamCoach(request, response) {
  if (!gemini) return send(response, 503, { error: 'GEMINI_API_KEY is not set on the server.' })
  const { contents, system } = coachRequestFrom(await readJson(request))
  const { stream, used } = await openStream(contents, system)
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Coach-Model': used })
  let wrote = false
  for await (const chunk of stream) {
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
    if (request.method === 'GET' && url.pathname === '/api/coach/status') return send(response, 200, { live: Boolean(gemini), model: gemini ? model : null })
    if (request.method === 'POST' && url.pathname === '/api/coach') return await streamCoach(request, response)
    if (url.pathname.startsWith('/api/')) return send(response, 404, { error: 'Unknown API route' })
    return serveStatic(response, url.pathname)
  } catch (error) {
    console.error(error)
    if (response.headersSent) return response.end()
    return send(response, 502, { error: error instanceof Error ? error.message : 'Request failed' })
  }
})

server.listen(port, '127.0.0.1', () => console.log(`SportsAI+ server on http://127.0.0.1:${port} · coach ${gemini ? `live (${model})` : 'offline (no GEMINI_API_KEY)'} · ${passages.length} reference passages`))
