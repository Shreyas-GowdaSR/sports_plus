import type { AthleteProfile } from '../types'
import type { FuelPlan, FuelStep } from './fuel'
import { planAsText } from './fuel'
import { analysisAsText, drillsFor, talkFor } from './plainTalk'
import type { SavedCheck } from './store'

export type ChatMessage = { role: 'user' | 'assistant'; text: string; offline?: boolean; notice?: string }

export type CoachContext = { profile: AthleteProfile; plan: FuelPlan; latest: SavedCheck | null }

const DIET_WORD = { veg: 'vegetarian (no egg, meat or fish)', egg: 'eggetarian (eggs ok, no meat or fish)', nonveg: 'non-vegetarian', vegan: 'vegan (no dairy, eggs, honey)' }
const REGION_WORD = { south: 'South Indian food', north: 'North Indian food', any: 'any Indian food' }

function contextPayload({ profile, plan, latest }: CoachContext) {
  return {
    athlete: [
      `Name: ${profile.name || 'not given'} · ${profile.age} years · ${profile.gender}`,
      `Weight ${profile.weightKg} kg · height ${profile.heightCm} cm`,
      `Event: ${profile.event} · runs about ${profile.weeklyKm} km per week · usually trains at ${profile.trainingTime}`,
      `Diet: ${DIET_WORD[profile.diet]} · prefers ${REGION_WORD[profile.region]}`,
      `Avoid / allergies: ${profile.avoid.trim() || 'none'}`,
    ].join('\n'),
    plan: planAsText(plan),
    form: latest ? analysisAsText(latest) : '',
  }
}

export async function coachStatus(): Promise<{ live: boolean; model: string | null }> {
  try {
    const response = await fetch('/api/coach/status')
    if (!response.ok) return { live: false, model: null }
    return await response.json()
  } catch { return { live: false, model: null } }
}

export type CoachResult = { ok: true } | { ok: false; reason: 'quota' | 'no-key' | 'unavailable' | 'offline'; retryAt: string | null }

/** Streams the coach's reply, or says why the live coach could not answer. */
export async function askCoach(messages: ChatMessage[], context: CoachContext, onText: (text: string) => void, signal?: AbortSignal): Promise<CoachResult> {
  let response: Response
  try {
    response = await fetch('/api/coach', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.filter(m => !m.offline || m.role === 'user').map(({ role, text }) => ({ role, text })), context: contextPayload(context) }),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    return { ok: false, reason: 'offline', retryAt: null }
  }
  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => ({})) as { reason?: string; retryAt?: string | null }
    const reason = detail.reason === 'quota' || detail.reason === 'no-key' ? detail.reason : 'unavailable'
    return { ok: false, reason, retryAt: detail.retryAt ?? null }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    onText(text)
  }
  return text.trim().length > 0 ? { ok: true } : { ok: false, reason: 'unavailable', retryAt: null }
}

/** One honest line explaining why this answer is not from the live AI. */
export function offlineNotice(result: Exclude<CoachResult, { ok: true }>) {
  if (result.reason === 'quota') {
    const minutes = result.retryAt ? Math.max(1, Math.round((new Date(result.retryAt).getTime() - Date.now()) / 60000)) : null
    const when = minutes === null ? 'later today' : minutes >= 60 ? `in about ${Math.floor(minutes / 60)} h ${minutes % 60} min` : `in about ${minutes} min`
    return `Live AI has used up today's free Gemini quota and is back ${when}. Quick answer from your plan:`
  }
  if (result.reason === 'no-key') return 'Live AI is off because no Gemini key is set on the server. Quick answer from your plan:'
  if (result.reason === 'offline') return 'Cannot reach the coach server (is npm run dev:all running?). Quick answer from your plan:'
  return 'Live AI is busy right now. Quick answer from your plan:'
}

// ── Offline answers from the athlete's own plan ──────────────

// Swap groups: foods that do the same job, with a portion that does it about as well.
type Swap = { food: string; keys: RegExp; not?: AthleteProfile['diet'][] }
const SWAPS: { job: string; options: Swap[] }[] = [
  { job: 'quick energy before or during a run', options: [
    { food: '1 banana', keys: /banana|kela/ }, { food: '3 dates', keys: /date|khajur/ }, { food: '1 chikoo', keys: /chikoo|sapota/ },
    { food: '2 slices bread with jam', keys: /bread|toast/ }, { food: '2 idlis', keys: /idli/ }, { food: '1 small plate poha', keys: /poha/ },
    { food: '1 handful raisins (about 30 g)', keys: /raisin|kishmish/ }, { food: '500 ml nimbu-pani with 2 tbsp sugar', keys: /nimbu|lemon|glucose/ },
  ] },
  { job: 'protein after a run', options: [
    { food: '50 g paneer', keys: /paneer/, not: ['vegan'] }, { food: '1 katori dal + 1 katori curd', keys: /dal|curd|dahi/, not: ['vegan'] },
    { food: '2 boiled eggs', keys: /egg/, not: ['veg', 'vegan'] }, { food: '1 small katori soya chunks', keys: /soya|soy/ },
    { food: '1 katori sprouts', keys: /sprout|moong/ }, { food: '1 katori chana or rajma', keys: /chana|rajma|chickpea/ },
    { food: '100 g chicken or fish', keys: /chicken|fish|meat/, not: ['veg', 'egg', 'vegan'] }, { food: '1 glass milk', keys: /milk/, not: ['vegan'] },
  ] },
  { job: 'main carbs in a meal', options: [
    { food: '1 cup rice', keys: /rice|chawal/ }, { food: '3 chapatis', keys: /chapati|roti|wheat/ }, { food: '1 ragi mudde or 3 ragi rotis', keys: /ragi/ },
    { food: '1 plate upma', keys: /upma|rava|sooji/ }, { food: '1 medium sweet potato', keys: /sweet potato|shakarkand/ }, { food: '2 dosas', keys: /dosa/ },
  ] },
  { job: 'drinks to replace salt and water', options: [
    { food: '1 glass ORS', keys: /ors|electral/ }, { food: '1 glass salted nimbu-pani', keys: /nimbu|lemon/ },
    { food: '1 glass coconut water', keys: /coconut/ }, { food: '1 glass salted buttermilk', keys: /buttermilk|chaas|majjige/, not: ['vegan'] },
  ] },
]

function alternatives(q: string, profile: AthleteProfile): string | null {
  const avoid = profile.avoid.toLowerCase()
  const allowed = (swap: Swap) => !swap.not?.includes(profile.diet) && !(avoid && swap.keys.test(avoid))
  for (const group of SWAPS) {
    const named = group.options.find(option => option.keys.test(q))
    if (!named) continue
    const others = group.options.filter(option => option !== named && allowed(option)).slice(0, 4)
    if (!others.length) continue
    const asked = q.match(named.keys)?.[0] ?? named.food
    return [`**Instead of ${asked}** (${group.job}), any one of these works:`, ...others.map(option => `- ${option.food}`)].join('\n')
  }
  return null
}
const steps = (title: string, list: FuelStep[]) =>
  [`**${title}**`, ...list.map(step => `- **${step.when}:** ${step.lines.join(step.choice ? ' — or — ' : ', ')}`)].join('\n')

export function offlineAnswer(question: string, { profile, plan, latest }: CoachContext): string {
  const q = question.toLowerCase()
  const name = profile.name.trim().split(/\s+/)[0]
  if (/instead|alternative|replace|swap|substitute|other than|don'?t like|do not like|hate|can'?t (eat|get|find)|allergic|option/.test(q)) {
    const swap = alternatives(q, profile)
    if (swap) return swap
  }
  if (/\b(form|posture|foot|knee|stride|arm|drill|technique|land)/.test(q)) {
    if (!latest) return 'I have not seen you run yet. Go to **Form check** and upload a 10–20 second side-view video. Then I can tell you exactly what to fix.'
    const weakest = [...latest.metrics].sort((a, b) => a.score - b.score)[0]
    const talk = talkFor(weakest, latest.view)
    const drills = drillsFor(latest.metrics).slice(0, 2)
    return [`Your main thing to fix is **${talk.name.toLowerCase()}**.`, `- ${talk.issue}`, `- **What to do:** ${talk.fix}`, ...drills.map(d => `- **${d.name}:** ${d.dose}. ${d.how}`)].join('\n')
  }
  const topics = [
    { match: /\b(water|drink|hydrat|thirst|ors|electrolyte|sweat)/, title: 'Water plan', list: plan.water },
    { match: /\b(during|mid|while running|gel)/, title: 'During your session', list: plan.during },
    { match: /\b(after|post|recover)/, title: 'After your session', list: plan.after },
    { match: /\b(before|pre|breakfast|morning)/, title: 'Before your session', list: plan.before },
  ].filter(topic => topic.match.test(q))
  // One clear topic gets a focused answer; "what to eat and drink" gets the whole plan.
  const eatAndDrink = topics[0]?.list === plan.water && /\beat\b|\bfood\b/.test(q)
  if (topics.length === 1 && !eatAndDrink) return steps(topics[0].title, topics[0].list)
  return [`${name ? `${name}, here` : 'Here'} is your plan for **${plan.label.toLowerCase()}**:`, '', steps('Before', plan.before), '', steps('During', plan.during), '', steps('After', plan.after), '', steps('Water', plan.water)].join('\n')
}
