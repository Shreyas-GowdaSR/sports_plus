"""SportsAI+ — Rule-based Coach Engine (fallback when RAG unavailable)"""
class CoachEngine:
    def run(self, metrics, mki_output):
        score    = mki_output.get("mki_score",0)
        cadence  = metrics.get("cadence",170)
        sym      = metrics.get("symmetry",95)
        gct      = metrics.get("ground_contact_time",0.25)
        torso    = metrics.get("torso_lean",10)
        strengths, improvements, plan = [], [], []
        if cadence >= 170: strengths.append("Good cadence rhythm")
        else: improvements.append(f"Cadence {cadence:.0f} spm — target 170-180")
        if sym >= 90: strengths.append("Balanced left-right stride")
        else: improvements.append(f"Symmetry {sym:.0f}% — address with single-leg work")
        if gct <= 0.26: strengths.append("Efficient ground contact time")
        else: improvements.append(f"Ground contact time {gct:.3f}s — add ankle hops")
        if torso <= 12: strengths.append("Good trunk position")
        else: improvements.append(f"Torso lean {torso:.0f}° — lean from ankles not waist")
        plan = ["A-Skip 3×20m before easy runs","Ankle hops 3×20 reps 3×/week",
                "Single-leg deadlift 3×10 each side","Easy metronome run at 175 BPM"]
        advice = f"MKI {score:.1f}/100 ({mki_output.get('grade','')}) — " + (
            "excellent mechanics, maintain and load progressively." if score>=80 else
            "good base, address the priority items below." if score>=65 else
            "focus on technique before adding training load.")
        return {"strengths":strengths,"improvements":improvements,"training_plan":plan,"personalized_advice":advice}
