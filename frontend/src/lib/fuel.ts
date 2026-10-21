import type { AthleteProfile, Diet, Session, SessionKind } from '../types'

export const SESSION_LABEL: Record<SessionKind, string> = {
  easy: 'Easy run', long: 'Long run', hard: 'Hard workout', race: 'Race day', strength: 'Strength', rest: 'Rest day',
}

export function defaultSession(profile: AthleteProfile): Session {
  return { kind: 'easy', minutes: 45, weather: 'normal', startTime: profile.trainingTime || '06:00' }
}

/**
 * Turns sports-nutrition targets (ACSM / IOC consensus ranges) into Indian home
 * foods and household measures. The athlete sees foods, amounts and timing;
 * the gram targets stay behind "Show the numbers".
 *
 * Food values are rounded household approximations, e.g. 1 idli ≈ 8 g carbs,
 * 1 banana ≈ 27 g, 1 cup cooked rice ≈ 45 g, 1 katori dal ≈ 7 g protein.
 */

export type FuelStep = { when: string; lines: string[]; choice?: boolean; note?: string }

export type FuelPlan = {
  label: string
  summary: string
  before: FuelStep[]
  during: FuelStep[]
  after: FuelStep[]
  water: FuelStep[]
  numbers: { label: string; value: string }[]
}

type Food = { text: string; keys: string[]; not?: Diet[] }

const DAIRY: Diet[] = ['vegan']
const MEAT: Diet[] = ['veg', 'egg', 'vegan']

function blocked(food: Food, profile: AthleteProfile) {
  if (food.not?.includes(profile.diet)) return true
  const avoid = profile.avoid.toLowerCase()
  return food.keys.some(key => avoid.includes(key))
}

const roundHalf = (value: number) => Math.round(value * 2) / 2
const round50 = (value: number) => Math.round(value / 50) * 50
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const glasses = (ml: number) => {
  const g = roundHalf(ml / 250)
  return g <= 0.5 ? 'half a glass' : g === 1 ? '1 glass' : `${g} glasses`
}

// ── Carb foods ───────────────────────────────────────────────
type Base = Food & { carbs: number; min: number; max: number; step: number; fmt: (n: number) => string; side?: Food & { carbs: number } }

const BASES: Record<string, Base> = {
  idli:  { text: 'idli', keys: ['idli'], carbs: 8, min: 2, max: 6, step: 1, fmt: n => `${n} idlis`, side: { text: 'a small katori of sambar', keys: ['sambar'], carbs: 8 } },
  rice:  { text: 'rice', keys: ['rice'], carbs: 45, min: 1, max: 2.5, step: 0.5, fmt: n => `${n} ${n > 1 ? 'cups' : 'cup'} of rice`, side: { text: 'thin dal or rasam', keys: ['dal', 'rasam'], carbs: 6 } },
  poha:  { text: 'poha', keys: ['poha'], carbs: 40, min: 1, max: 2, step: 0.5, fmt: n => `${n} ${n > 1 ? 'plates' : 'plate'} of poha` },
  bread: { text: 'bread', keys: ['bread', 'wheat', 'gluten'], carbs: 20, min: 2, max: 5, step: 1, fmt: n => `${n} slices of bread with honey or jam` },
  upma:  { text: 'upma', keys: ['upma', 'rava', 'sooji', 'wheat', 'gluten'], carbs: 40, min: 1, max: 2, step: 0.5, fmt: n => `${n} ${n > 1 ? 'plates' : 'plate'} of upma` },
}
const BANANA: Food & { carbs: number } = { text: '1 banana', keys: ['banana'], carbs: 27 }
const DATES: Food & { carbs: number } = { text: '3 dates', keys: ['date', 'khajur'], carbs: 18 }

function fruit(profile: AthleteProfile) {
  return [BANANA, DATES].find(item => !blocked(item, profile))
}

function composeMeal(baseKey: string, target: number, profile: AthleteProfile): string | null {
  const base = BASES[baseKey]
  if (blocked(base, profile)) return null
  const parts: string[] = []
  let left = target
  if (base.side && !blocked(base.side, profile)) { left -= base.side.carbs }
  const extra = fruit(profile)
  if (extra && target >= 35) { left -= extra.carbs }
  const units = clamp(Math.round(left / base.carbs / base.step) * base.step, base.min, base.max)
  parts.push(base.fmt(units))
  if (base.side && !blocked(base.side, profile)) parts[0] += ` with ${base.side.text}`
  if (extra && target >= 35) parts.push(extra.text)
  // Very large pre-race meals need a top-up the base food cannot carry alone.
  const covered = target - left + units * base.carbs
  if (extra && target - covered > 20) parts[parts.length - 1] = extra === BANANA ? '2 bananas' : '6 dates'
  const meal = parts.join(' + ')
  return profile.diet === 'vegan' ? meal.replace('honey or jam', 'jam') : meal
}

function mealOptions(target: number, profile: AthleteProfile, early: boolean) {
  const order = early
    ? ['bread', 'idli', 'poha', 'upma']
    : profile.region === 'south' ? ['idli', 'rice', 'upma', 'poha', 'bread']
    : profile.region === 'north' ? ['poha', 'bread', 'rice', 'idli', 'upma']
    : ['idli', 'poha', 'rice', 'bread', 'upma']
  return order.map(key => composeMeal(key, target, profile)).filter((value): value is string => Boolean(value)).slice(0, 2)
}

// ── Protein foods ────────────────────────────────────────────
type ProteinFood = Food & { protein: number }
const PROTEIN: Record<Diet, ProteinFood[]> = {
  nonveg: [
    { text: '100 g chicken', keys: ['chicken'], protein: 25, not: MEAT },
    { text: '100 g fish', keys: ['fish'], protein: 20, not: MEAT },
    { text: '2 boiled eggs', keys: ['egg'], protein: 12 },
    { text: '1 katori dal', keys: ['dal'], protein: 7 },
    { text: '1 katori curd', keys: ['curd', 'dahi', 'dairy'], protein: 5 },
  ],
  egg: [
    { text: '2 boiled eggs', keys: ['egg'], protein: 12 },
    { text: '1 katori dal', keys: ['dal'], protein: 7 },
    { text: '50 g paneer', keys: ['paneer', 'dairy'], protein: 9 },
    { text: '1 katori curd', keys: ['curd', 'dahi', 'dairy'], protein: 5 },
  ],
  veg: [
    { text: '1 katori dal', keys: ['dal'], protein: 7 },
    { text: '50 g paneer', keys: ['paneer', 'dairy'], protein: 9 },
    { text: '1 katori curd', keys: ['curd', 'dahi', 'dairy'], protein: 5 },
    { text: '1 small katori soya chunks', keys: ['soya', 'soy'], protein: 13 },
    { text: '1 katori sprouts', keys: ['sprout', 'moong'], protein: 6 },
  ],
  vegan: [
    { text: '1 small katori soya chunks', keys: ['soya', 'soy'], protein: 13 },
    { text: '1 katori dal', keys: ['dal'], protein: 7 },
    { text: '1 katori chana or rajma', keys: ['chana', 'rajma', 'chickpea'], protein: 7 },
    { text: '100 g tofu', keys: ['tofu', 'soy'], protein: 10 },
    { text: '1 katori sprouts', keys: ['sprout', 'moong'], protein: 6 },
  ],
}

function proteinFoods(target: number, profile: AthleteProfile) {
  const picked: string[] = []
  let total = 0
  for (const food of PROTEIN[profile.diet]) {
    if (total >= target || picked.length === 3) break
    if (blocked(food, profile)) continue
    picked.push(food.text); total += food.protein
  }
  return picked.join(' + ')
}

function carbSide(target: number, profile: AthleteProfile) {
  const riceOk = !blocked(BASES.rice, profile)
  const rotiOk = !profile.avoid.toLowerCase().match(/wheat|gluten|roti|chapati/)
  const cups = clamp(roundHalf(target / 45), 1, 3)
  const rotis = clamp(Math.round(target / 15), 2, 6)
  if (profile.region === 'south' && riceOk) return `${cups} ${cups > 1 ? 'cups' : 'cup'} of rice`
  if (profile.region === 'north' && rotiOk) return `${rotis} chapatis`
  if (riceOk && rotiOk) return `${clamp(roundHalf(cups / 2), 1, 2)} cup rice + ${clamp(Math.round(rotis / 2), 1, 3)} chapatis`
  return riceOk ? `${cups} cups of rice` : `${rotis} chapatis`
}

function recoveryDrink(profile: AthleteProfile) {
  if (profile.diet === 'vegan' || /milk|dairy|lactose/.test(profile.avoid.toLowerCase())) {
    return profile.diet === 'vegan' ? '1 glass soy milk + 1 banana' : '1 handful roasted chana + 1 banana'
  }
  return '1 glass milk or sweet lassi + 1 banana'
}

// ── Plan ─────────────────────────────────────────────────────
export function buildFuelPlan(profile: AthleteProfile, session: Session): FuelPlan {
  const kg = profile.weightKg
  const { kind, minutes, weather } = session
  const rest = kind === 'rest'
  const hard = kind === 'hard' || kind === 'race'
  const long = kind === 'long' || minutes >= 90
  const startHour = Number(session.startTime.split(':')[0] ?? 7)
  const early = startHour < 8
  const label = rest ? 'Rest day' : `${SESSION_LABEL[kind]} · ${minutes} min · ${weather === 'hot' ? 'hot day' : weather === 'cool' ? 'cool day' : 'normal weather'}`

  // Carbohydrate before (g/kg in the 1–4 h before), carbohydrate during (g/h).
  const preGkg = rest ? 0 : kind === 'race' || minutes >= 120 ? 2 : long || hard ? 1.5 : minutes > 45 ? 1 : 0
  const preCarbs = Math.round(preGkg * kg)
  const duringCarbs = rest || minutes < 60 ? 0 : minutes < 90 ? 30 : minutes <= 150 ? 45 : 60
  const recoveryProtein = clamp(Math.round(0.3 * kg), 15, 35)
  const recoveryCarbs = Math.round((hard || long ? 1 : 0.6) * kg)
  const [rateLo, rateHi] = weather === 'hot' ? [600, 900] : weather === 'cool' ? [400, 600] : [500, 700]
  const salty = minutes >= 90 || weather === 'hot'

  // ── Before
  const before: FuelStep[] = []
  const top = fruit(profile)
  if (rest) {
    before.push({ when: 'Today', lines: ['No special pre-run food. Eat your normal 3 meals and 1–2 small snacks.', `Add some protein to every meal: ${proteinFoods(15, profile)}.`] })
  } else if (preCarbs === 0) {
    before.push({ when: '30 min before · only if hungry', lines: [top ? top.text : 'a small glass of nimbu-pani with sugar'], note: 'Short easy sessions are fine on an empty stomach if you feel good.' })
  } else if (early) {
    const target = Math.min(preCarbs, Math.round(kg))
    before.push({ when: 'Night before', lines: [`Normal dinner with a little extra rice or chapati, e.g. ${carbSide(Math.round(kg * 1.2), profile)} with dal and sabzi.`] })
    before.push({ when: hard || long ? '60–90 min before · wake up a bit early' : '30–45 min before', lines: mealOptions(target, profile, true), choice: true, note: 'Keep it light. No oily, spicy or high-fibre food in the morning.' })
  } else {
    before.push({ when: '2–3 hours before', lines: mealOptions(preCarbs, profile, false), choice: true, note: 'Pick familiar food. Less oil, less spice, less fibre as the run gets closer.' })
    if ((hard || long) && top) before.push({ when: '30 min before', lines: [top.text] })
  }

  // ── During
  const during: FuelStep[] = []
  if (rest) during.push({ when: 'Today', lines: ['Nothing extra.'] })
  else if (duringCarbs === 0) during.push({ when: 'During', lines: ['Only water. No food needed for this session.'] })
  else {
    const drink = 'water + 2 tbsp glucose or sugar + a pinch of salt + half a lemon'
    const lines = duringCarbs === 30
      ? [`500 ml energy drink (${drink})`, top ? `${top.text}, in small bites` : '1 energy gel']
      : duringCarbs === 45
        ? [`500 ml energy drink (${drink})`, `+ ${top === DATES || !top ? '3 dates' : 'half a banana and 2 dates'}`]
        : [`500 ml energy drink (${drink})`, `+ ${top ? top.text : '1 energy gel'}`, '+ 2 dates or 1 energy gel']
    during.push({
      when: duringCarbs === 30 ? 'After the first hour' : 'Every hour, starting at 30–40 min',
      lines,
      choice: duringCarbs === 30,
      note: 'Take small amounts every 20–30 minutes. Do not wait until you feel tired. Practise this in training before any race.',
    })
  }

  // ── After
  const after: FuelStep[] = []
  if (rest) after.push({ when: 'Today', lines: ['Normal meals. Sleep 8 hours tonight; rest days are when the body gets stronger.'] })
  else {
    const snack = hard || long || minutes >= 60 || kind === 'strength'
    if (snack) after.push({ when: 'Within 30–60 min', lines: [recoveryDrink(profile)] })
    after.push({
      when: snack ? 'Proper meal within 2 hours' : 'Next meal',
      lines: [`${carbSide(recoveryCarbs, profile)} + ${proteinFoods(snack ? recoveryProtein - 8 : recoveryProtein, profile)} + sabzi`],
      note: hard || long ? 'This meal refills energy and repairs muscle. Do not skip it.' : undefined,
    })
  }

  // ── Water
  const water: FuelStep[] = []
  const dayLo = Math.round(kg * 0.035 * 10) / 10 + (weather === 'hot' ? 0.5 : 0)
  const dayHi = Math.round(kg * 0.045 * 10) / 10 + (weather === 'hot' ? 0.5 : 0)
  if (!rest) {
    const preLo = round50(kg * 5); const preHi = round50(kg * 7)
    water.push({ when: '2 hours before', lines: [`${preLo}–${preHi} ml (about ${glasses((preLo + preHi) / 2)})`, 'A few sips just before you start'] })
    if (minutes < 30) water.push({ when: 'During', lines: ['Not needed. Sip if thirsty.'] })
    else {
      const sipLo = round50(rateLo / 3.5); const sipHi = round50(rateHi / 3.5)
      const total = round50(((rateLo + rateHi) / 2) * minutes / 60)
      water.push({
        when: 'During',
        lines: [`${sipLo}–${sipHi} ml every 15–20 min`, `About ${total >= 1000 ? `${(total / 1000).toFixed(1)} litres` : `${total} ml`} in total for this session`],
        note: salty ? 'Add salt: use ORS, or nimbu-pani with a pinch of salt and sugar, for at least half of it. Plain water alone is not enough for long or hot runs.' : 'Do not force water. Drinking far too much plain water is also harmful.',
      })
    }
    water.push({ when: 'After', lines: ['500–750 ml in the first hour', profile.diet === 'vegan' ? 'Coconut water or salted nimbu-pani is good' : 'Buttermilk with salt or coconut water is good'], note: 'Keep sipping until your urine is light yellow.' })
  }
  water.push({ when: 'Whole day', lines: [`About ${dayLo.toFixed(1)}–${dayHi.toFixed(1)} litres, spread across the day`], note: rest ? undefined : 'This is on top of what you drink during training.' })

  const dayCarbs = rest ? [3, 5] : kind === 'race' || long ? [6, 8] : hard ? [5, 7] : [4, 6]
  const numbers = [
    { label: 'Carbs before', value: preCarbs ? `${preCarbs} g` : 'None needed' },
    { label: 'Carbs during', value: duringCarbs ? `${duringCarbs} g / hour` : 'None needed' },
    { label: 'Protein after', value: `${recoveryProtein} g` },
    { label: 'Fluid during', value: rest || minutes < 30 ? '—' : `${rateLo}–${rateHi} ml / hour` },
    { label: 'Carbs for the day', value: `${Math.round(dayCarbs[0] * kg)}–${Math.round(dayCarbs[1] * kg)} g` },
    { label: 'Protein for the day', value: `${Math.round(1.4 * kg)}–${Math.round(1.7 * kg)} g` },
  ]

  const summary = rest
    ? 'Rest day. Eat normal, balanced meals and drink water through the day.'
    : duringCarbs
      ? 'Eat well before, take small sips and bites during, and eat a proper meal after.'
      : preCarbs
        ? 'A light meal before, water during, and a balanced meal after.'
        : 'A short session. Water is enough; eat a normal meal after.'

  return { label, summary, before, during, after, water, numbers }
}

/** Plain text version, sent to the AI coach as the athlete's calculated plan. */
export function planAsText(plan: FuelPlan) {
  const block = (title: string, steps: FuelStep[]) =>
    `${title}:\n${steps.map(step => `- ${step.when}: ${step.lines.join(step.choice ? ' OR ' : '; ')}${step.note ? ` (${step.note})` : ''}`).join('\n')}`
  return [plan.label, block('BEFORE', plan.before), block('DURING', plan.during), block('AFTER', plan.after), block('WATER', plan.water),
    `TARGETS (hidden unless athlete asks): ${plan.numbers.map(n => `${n.label} ${n.value}`).join('; ')}`].join('\n')
}
