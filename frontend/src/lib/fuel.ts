import type { AthleteProfile, Diet, Session, SessionKind } from '../types'

export const SESSION_LABEL: Record<SessionKind, string> = {
  easy: 'Easy run', long: 'Long run', hard: 'Hard workout', race: 'Race day', strength: 'Strength', rest: 'Rest day',
}

export function defaultSession(profile: AthleteProfile): Session {
  return { kind: 'easy', minutes: 45, weather: 'normal', startTime: profile.trainingTime || '06:00' }
}

/**
 * Turns sports-nutrition targets into Indian home foods and household measures.
 * The athlete sees foods, amounts and timing; gram targets stay behind "Show the numbers".
 *
 * Sources for every range used below:
 * - Thomas, Erdman & Burke. ACSM / Academy of Nutrition and Dietetics / Dietitians of Canada
 *   joint position, "Nutrition and Athletic Performance", Med Sci Sports Exerc 2016:
 *   daily carbs 3–5 g/kg (light) · 5–7 (≈1 h/day) · 6–10 (1–3 h/day); protein 1.2–2.0 g/kg/day;
 *   1–4 g/kg carbs 1–4 h before; 30–60 g/h during 1–2.5 h, up to 90 g/h beyond;
 *   recovery 1.0–1.2 g/kg carbs + 0.25–0.3 g/kg protein; fluid 5–7 ml/kg ≥2–4 h before,
 *   0.4–0.8 L/h during, 1.25–1.5 L per kg body mass lost after; sodium 20–30 mmol/L.
 * - EFSA 2010 adequate water intake (2.5 L/day men, 2.0 L/day women, ~80% from drinks).
 *
 * Carbs and protein are scaled to a "plan weight": actual weight when BMI ≤ 25, otherwise
 * the adjusted body weight (weight at BMI 25 + 40% of the excess), the standard clinical
 * correction so heavier athletes are not over-fed. Fluids use actual weight.
 *
 * Food values are rounded household approximations, e.g. 1 idli ≈ 8 g carbs,
 * 1 banana ≈ 27 g, 1 cup cooked rice ≈ 45 g, 1 katori dal ≈ 7 g protein.
 */

export type FuelStep = { when: string; lines: string[]; choice?: boolean; note?: string }

export type Body = { bmi: number; category: string; planWeight: number; note?: string }

export type FuelPlan = {
  label: string
  body: Body
  summary: string
  before: FuelStep[]
  during: FuelStep[]
  after: FuelStep[]
  water: FuelStep[]
  numbers: { label: string; value: string }[]
}

type Food = { text: string; keys: string[]; not?: Diet[] }

const MEAT: Diet[] = ['veg', 'egg', 'vegan']

function blocked(food: Food, profile: AthleteProfile) {
  if (food.not?.includes(profile.diet)) return true
  const avoid = profile.avoid.toLowerCase()
  return food.keys.some(key => avoid.includes(key))
}

const roundHalf = (value: number) => Math.round(value * 2) / 2
const round50 = (value: number) => Math.round(value / 50) * 50
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
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
    { text: '1 katori sprouts', keys: ['sprout', 'moong'], protein: 5 },
  ],
  vegan: [
    { text: '1 small katori soya chunks', keys: ['soya', 'soy'], protein: 13 },
    { text: '1 katori dal', keys: ['dal'], protein: 7 },
    { text: '1 katori chana or rajma', keys: ['chana', 'rajma', 'chickpea'], protein: 7 },
    { text: '100 g tofu', keys: ['tofu', 'soy'], protein: 10 },
    { text: '1 katori sprouts', keys: ['sprout', 'moong'], protein: 5 },
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

// ── Body ─────────────────────────────────────────────────────
export function bodyFor(profile: AthleteProfile): Body {
  const metres = profile.heightCm / 100
  const bmi = Math.round(profile.weightKg / (metres * metres) * 10) / 10
  const atBmi25 = 25 * metres * metres
  if (bmi < 18.5) return { bmi, category: 'Underweight', planWeight: profile.weightKg, note: 'BMI is low. Never skip meals around training, and see a sports dietitian.' }
  if (bmi <= 25) return { bmi, category: 'Healthy', planWeight: profile.weightKg }
  const planWeight = Math.round(atBmi25 + 0.4 * (profile.weightKg - atBmi25))
  return {
    bmi, category: bmi < 30 ? 'Overweight' : 'Obese', planWeight,
    note: `Food amounts use ${planWeight} kg, adjusted for BMI. Very muscular? BMI over-reads, so ask a dietitian.`,
  }
}

/**
 * Protein in the 0–2 h after a session, low–high in grams.
 * Endurance: 0.25–0.3 g/kg (ACSM/AND 2016). Strength or gym: 0.3–0.4 g/kg with at
 * least 20 g (ISSN position stand on protein and exercise, 2017).
 */
export function proteinAfter(kind: SessionKind, planWeight: number): [number, number] {
  if (kind === 'strength') {
    const low = Math.max(20, Math.round(0.3 * planWeight))
    return [low, Math.max(low + 5, Math.min(40, Math.round(0.4 * planWeight)))]
  }
  const low = Math.max(15, Math.round(0.25 * planWeight))
  return [low, Math.max(low + 3, Math.min(30, Math.round(0.3 * planWeight)))]
}

const range = (low: number, high: number, unit = 'g') => `${Math.round(Math.min(low, high))}–${Math.round(Math.max(low, high))} ${unit}`

/**
 * Every target the coach may need, worked out here so the language model never
 * does arithmetic. All ranges are written low–high.
 */
export function athleteNumbers(profile: AthleteProfile) {
  const body = bodyFor(profile)
  const kg = body.planWeight
  const fluidKg = profile.weightKg
  const run = proteinAfter('easy', kg); const gym = proteinAfter('strength', kg)
  const female = profile.gender === 'female'
  const dayWaterLow = clamp(fluidKg * 0.03, female ? 1.6 : 2.0, 3.0); const dayWaterHigh = clamp(fluidKg * 0.035, female ? 1.9 : 2.3, 3.5)
  const sweat = clamp(fluidKg / 65, 0.8, 1.2)
  const hour = (low: number, high: number) => `${round50(low * sweat)}–${Math.min(850, round50(high * sweat))} ml per hour`
  return [
    `Plan weight for food: ${kg} kg (BMI ${body.bmi}, ${body.category}). Actual weight for water: ${fluidKg} kg.`,
    'PROTEIN AFTER A SESSION (eat within 0–2 hours):',
    `- After a run (easy, long, hard or race): ${range(run[0], run[1])}`,
    `- After gym, weights or any intense strength workout: ${range(gym[0], gym[1])}`,
    'PROTEIN PER DAY (spread over 4–5 meals):',
    `- Running training days: ${range(1.4 * kg, 1.8 * kg)}, about ${range(0.3 * kg, 0.4 * kg)} per meal`,
    `- Heavy gym or strength days: ${range(1.6 * kg, 2.0 * kg)}, about ${range(0.3 * kg, 0.4 * kg)} per meal`,
    'CARBS PER DAY:',
    `- Rest or light day: ${range(3 * kg, 5 * kg)}`,
    `- About 1 hour of training: ${range(5 * kg, 7 * kg)}`,
    `- 1–3 hours of hard or long training: ${range(6 * kg, 8 * kg)}`,
    'CARBS AFTER A SESSION:',
    `- After a hard or long run, or before a second session the same day: ${range(1.0 * kg, 1.2 * kg)} in the first hour`,
    `- After gym or strength work: ${range(0.5 * kg, 1.0 * kg)} with the next meal`,
    'WATER:',
    `- Whole day: ${dayWaterLow.toFixed(1)}–${dayWaterHigh.toFixed(1)} litres, plus what is drunk during training (add 0.5 litre on hot days)`,
    `- 2–4 hours before a run: ${range(fluidKg * 5, fluidKg * 7, 'ml')}`,
    `- During a run: ${hour(400, 550)} cool, ${hour(450, 700)} normal, ${hour(600, 800)} hot`,
    '- After: 1.5 litres for every 1 kg of body weight lost, or 500–750 ml in the first hour',
  ].join('\n')
}

// ── Plan ─────────────────────────────────────────────────────
export function buildFuelPlan(profile: AthleteProfile, session: Session): FuelPlan {
  const body = bodyFor(profile)
  const kg = body.planWeight
  const fluidKg = profile.weightKg
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
  const [proteinLow, proteinHigh] = proteinAfter(kind, kg)
  const recoveryProtein = Math.round((proteinLow + proteinHigh) / 2)
  const recoveryCarbs = Math.round((hard || long ? 1 : 0.6) * kg)
  // 0.4–0.8 L/h for a typical adult, scaled with body size (sweat rate tracks body mass).
  const sweatScale = clamp(fluidKg / 65, 0.8, 1.2)
  const [baseLo, baseHi] = weather === 'hot' ? [600, 800] : weather === 'cool' ? [400, 550] : [450, 700]
  // Capped so the plan never pushes over-drinking (risk of low blood sodium).
  const rateLo = round50(baseLo * sweatScale); const rateHi = Math.min(850, round50(baseHi * sweatScale))
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
    const drink = 'water + 2 tbsp glucose or sugar + ⅛ tsp salt + half a lemon'
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
  // 30–35 ml/kg/day drinking water, kept within the EFSA adult range.
  const female = profile.gender === 'female'
  const dayLo = clamp(fluidKg * 0.03, female ? 1.6 : 2.0, 3.0) + (weather === 'hot' ? 0.5 : 0)
  const dayHi = clamp(fluidKg * 0.035, female ? 1.9 : 2.3, 3.5) + (weather === 'hot' ? 0.5 : 0)
  if (!rest) {
    const preLo = round50(fluidKg * 5); const preHi = round50(fluidKg * 7)
    water.push({ when: '2–4 hours before', lines: [`${preLo}–${preHi} ml (about ${glasses((preLo + preHi) / 2)})`, 'A few sips just before you start'] })
    if (minutes < 30) water.push({ when: 'During', lines: ['Not needed. Sip if thirsty.'] })
    else {
      const sipLo = round50(rateLo / 3.5); const sipHi = round50(rateHi / 3.5)
      const total = round50(((rateLo + rateHi) / 2) * minutes / 60)
      water.push({
        when: 'During',
        lines: [`${sipLo}–${sipHi} ml every 15–20 min`, `About ${total >= 1000 ? `${(total / 1000).toFixed(1)} litres` : `${total} ml`} in total for this session`],
        note: salty ? 'Add salt: use ORS, or nimbu-pani with ⅛ tsp salt and sugar per 500 ml, for at least half of it. Plain water alone is not enough for long or hot runs.' : 'Do not force water. Drinking far too much plain water is also harmful.',
      })
    }
    water.push({ when: 'After', lines: ['500–750 ml in the first hour', profile.diet === 'vegan' ? 'Coconut water or salted nimbu-pani is good' : 'Buttermilk with salt or coconut water is good'], note: 'Keep sipping until your urine is light yellow. If you weigh yourself before and after: drink 1.5 L for every 1 kg lost.' })
  }
  water.push({ when: 'Whole day', lines: [`About ${dayLo.toFixed(1)}–${dayHi.toFixed(1)} litres, spread across the day`], note: rest ? undefined : 'This is on top of what you drink during training.' })

  const dayCarbs = rest ? [3, 5] : kind === 'race' || long ? [6, 8] : hard || minutes >= 60 ? [5, 7] : [3, 5]
  const numbers = [
    { label: 'BMI', value: `${body.bmi} · ${body.category}` },
    { label: 'Plan weight', value: `${kg} kg` },
    { label: 'Carbs before', value: preCarbs ? `${preCarbs} g` : 'None needed' },
    { label: 'Carbs during', value: duringCarbs ? `${duringCarbs} g / hour` : 'None needed' },
    { label: 'Protein after', value: range(proteinLow, proteinHigh) },
    { label: 'Fluid during', value: rest || minutes < 30 ? '—' : `${rateLo}–${rateHi} ml / hour` },
    { label: 'Carbs for the day', value: `${Math.round(dayCarbs[0] * kg)}–${Math.round(dayCarbs[1] * kg)} g` },
    { label: 'Protein for the day', value: kind === 'strength' ? range(1.6 * kg, 2.0 * kg) : range(1.4 * kg, 1.8 * kg) },
    { label: 'Water for the day', value: `${dayLo.toFixed(1)}–${dayHi.toFixed(1)} L` },
  ]

  const summary = rest
    ? 'Rest day. Eat normal, balanced meals and drink water through the day.'
    : duringCarbs
      ? 'Eat well before, take small sips and bites during, and eat a proper meal after.'
      : preCarbs
        ? 'A light meal before, water during, and a balanced meal after.'
        : 'A short session. Water is enough; eat a normal meal after.'

  return { label, body, summary, before, during, after, water, numbers }
}

/** Plain text version, sent to the AI coach as the athlete's calculated plan. */
export function planAsText(plan: FuelPlan) {
  const block = (title: string, steps: FuelStep[]) =>
    `${title}:\n${steps.map(step => `- ${step.when}: ${step.lines.join(step.choice ? ' OR ' : '; ')}${step.note ? ` (${step.note})` : ''}`).join('\n')}`
  return [plan.label, `BODY: BMI ${plan.body.bmi} (${plan.body.category}); food amounts use plan weight ${plan.body.planWeight} kg, water uses actual weight`, block('BEFORE', plan.before), block('DURING', plan.during), block('AFTER', plan.after), block('WATER', plan.water),
    `TARGETS (hidden unless athlete asks): ${plan.numbers.map(n => `${n.label} ${n.value}`).join('; ')}`].join('\n')
}
