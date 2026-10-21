import { lazy, Suspense } from 'react'
import { ArrowRight, Footprints, MessageCircle, Utensils } from 'lucide-react'

// three.js is only needed here, so it loads in its own chunk.
const RunnerScene = lazy(() => import('../components/RunnerScene').then(module => ({ default: module.RunnerScene })))

type Props = { onFormCheck: () => void; onNutrition: () => void; onCoach: () => void }

export function Landing({ onFormCheck, onNutrition, onCoach }: Props) {
  return (
    <section className="landing">
      <Suspense fallback={null}><RunnerScene className="landing-canvas" /></Suspense>
      <div className="landing-shade" />
      <div className="landing-copy">
        <span className="eyebrow">AI running form lab</span>
        <h1 className="landing-title">Run In A<br /><em>Right WAY</em></h1>
        <p className="landing-sub">Film 15 seconds of your run. Get the one fix that matters.</p>
        <div className="row">
          <button className="btn btn-gold btn-lg" onClick={onFormCheck}><Footprints size={18} /> Check my form <ArrowRight size={17} /></button>
        </div>
        <div className="landing-links">
          <button onClick={onNutrition}><Utensils size={15} /> Nutrition</button>
          <span />
          <button onClick={onCoach}><MessageCircle size={15} /> AI Coach</button>
        </div>
      </div>
    </section>
  )
}
