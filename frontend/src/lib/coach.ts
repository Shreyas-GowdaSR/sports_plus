import type { AthleteProfile } from '../types'
import type { FuelPlan, FuelStep } from './fuel'
import { planAsText } from './fuel'
import { analysisAsText, drillsFor, talkFor } from './plainTalk'
import type { SavedCheck } from './store'

export type ChatMessage = { role: 'user' | 'assistant'; text: string; offline?: boolean }

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

/** Streams the coach's reply. Returns false when the live coach is unreachable. */
export async function askCoach(messages: ChatMessage[], context: CoachContext, onText: (text: string) => void, signal?: AbortSignal): Promise<boolean> {
  let response: Response
  try {
    response = await fetch('/api/coach', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.filter(m => !m.offline || m.role === 'user').map(({ role, text }) => ({ role, text })), context: contextPayload(context) }),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    return false
  }
  if (!response.ok || !response.body) return false
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    onText(text)
  }
  return text.trim().length > 0
}

// ── Offline answers from the athlete's own plan ──────────────
const steps = (title: string, list: FuelStep[]) =>
  [`**${title}**`, ...list.map(step => `- **${step.when}:** ${step.lines.join(step.choice ? ' — or — ' : ', ')}`)].join('\n')

export function offlineAnswer(question: string, { profile, plan, latest }: CoachContext): string {
  const q = question.toLowerCase()
  const name = profile.name.trim().split(/\s+/)[0]
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
