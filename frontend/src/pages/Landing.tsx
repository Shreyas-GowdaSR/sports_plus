import { ArrowRight, Footprints, MessageCircle, Utensils } from 'lucide-react'
import { FormScan } from '../components/FormScan'

type Props = { onFormCheck: () => void; onNutrition: () => void; onCoach: () => void }

export function Landing({ onFormCheck, onNutrition, onCoach }: Props) {
  return (
    <section className="landing">
      <div className="landing-inner">
        <div className="landing-copy">
          <span className="eyebrow">AI running form lab</span>
          <h1 className="landing-title">Run the<br /><em>Right Way</em></h1>
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
        <FormScan className="landing-scan" />
      </div>
    </section>
  )
}
