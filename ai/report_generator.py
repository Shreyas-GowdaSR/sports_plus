"""
SportsAI+ — Standalone PDF Report Generator
Works independently of FastAPI. Called by backend/app/routes/report.py
"""
import json
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen.canvas import Canvas


def generate_pdf(data: dict, out_path: Path) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    c = Canvas(str(out_path), pagesize=letter)
    W, H = letter
    m    = inch * 0.75

    # ── Header ──────────────────────────────────────────────────
    c.setFillColorRGB(0.04, 0.27, 0.53)
    c.rect(0, H-70, W, 70, fill=True, stroke=False)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(m, H-42, "SportsAI+ Performance Report")
    c.setFont("Helvetica", 11)
    c.drawString(m, H-60,
        f"Video: {data.get('video_name','')}  |  "
        f"Country: {data.get('country','').title()}  |  "
        f"{data.get('completed_at','')[:10]}")
    c.setFillColorRGB(0, 0, 0)
    y = H - m - 50

    # ── MKI Score ───────────────────────────────────────────────
    mki   = data.get("mki_output", {})
    score = mki.get("mki_score", 0)
    grade = mki.get("grade", "")
    col   = (0,140,0) if score>=80 else (200,120,0) if score>=60 else (180,0,0)
    c.setFillColorRGB(*[v/255 for v in col])
    c.roundRect(m, y-40, 220, 50, 8, fill=True, stroke=False)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(m+15, y-15, f"MKI Score: {score:.1f}/100")
    c.setFont("Helvetica-Bold", 12)
    c.drawString(m+15, y-32, f"Grade: {grade}")
    c.setFillColorRGB(0, 0, 0)
    y -= 60

    # ── Metrics table ───────────────────────────────────────────
    metrics = data.get("running_metrics", {})
    c.setFont("Helvetica-Bold", 12)
    c.drawString(m, y, "Running Biomechanics"); y -= 16
    c.setFont("Helvetica", 10)
    for label, val, note in [
        ("Cadence",             f"{metrics.get('cadence',0):.0f} spm",          "Optimal: 170-180"),
        ("Stride Length",       f"{metrics.get('stride_length',0):.2f}m",        "Optimal: 1.0-1.3m"),
        ("Ground Contact Time", f"{metrics.get('ground_contact_time',0):.3f}s",  "Target: <0.25s"),
        ("Symmetry",            f"{metrics.get('symmetry',0):.1f}%",             "Target: >95%"),
        ("Running Efficiency",  f"{metrics.get('running_efficiency',0):.1f}%",   "Higher is better"),
        ("Knee Angle",          f"{metrics.get('knee_angle',0):.1f}°",           "Optimal: ~155°"),
        ("Hip Angle",           f"{metrics.get('hip_angle',0):.1f}°",            "Optimal: ~145°"),
        ("Ankle Angle",         f"{metrics.get('ankle_angle',0):.1f}°",          "Optimal: ~90°"),
        ("Torso Lean",          f"{metrics.get('torso_lean',0):.1f}°",           "Optimal: <12°"),
        ("Foot Strike",         metrics.get("foot_strike",""),                   "Target: Midfoot"),
    ]:
        c.drawString(m, y, f"{label}:")
        c.drawString(m+190, y, val)
        c.setFillColorRGB(0.4, 0.4, 0.4)
        c.drawString(m+295, y, note)
        c.setFillColorRGB(0, 0, 0)
        y -= 14
        if y < m+80: c.showPage(); y = H-m

    # ── RAG Coaching Cue ────────────────────────────────────────
    rag = data.get("rag_output", {})
    if rag.get("coaching_cue"):
        y -= 8
        if y < m+80: c.showPage(); y = H-m
        c.setFont("Helvetica-Bold", 12)
        c.setFillColorRGB(0.04, 0.27, 0.53)
        c.drawString(m, y, "AI Coaching Cue")
        c.setFillColorRGB(0, 0, 0); y -= 16
        c.setFont("Helvetica", 10)
        words = rag["coaching_cue"].split(); line = ""
        for w in words:
            if len(line)+len(w) < 105: line += (" " if line else "")+w
            else:
                c.drawString(m, y, line); y -= 13; line = w
                if y < m+60: c.showPage(); y = H-m
        if line: c.drawString(m, y, line); y -= 20

    # ── Drill Plan ──────────────────────────────────────────────
    drills = rag.get("drill_plan", [])
    if drills:
        if y < m+120: c.showPage(); y = H-m
        c.setFont("Helvetica-Bold", 12)
        c.setFillColorRGB(0.04, 0.27, 0.53)
        c.drawString(m, y, "Corrective Drill Plan")
        c.setFillColorRGB(0, 0, 0); y -= 16
        for d in drills:
            if y < m+80: c.showPage(); y = H-m
            c.setFont("Helvetica-Bold", 10)
            c.drawString(m, y, f"  {d.get('name','')} — {d.get('sets_reps','')}"); y -= 13
            c.setFont("Helvetica", 10)
            c.drawString(m, y, f"    Cue: {d.get('cue','')[:90]}"); y -= 12
            c.drawString(m, y, f"    {d.get('frequency','')} | Target: {d.get('target','')[:60]}"); y -= 16

    # ── Nutrition Plan ──────────────────────────────────────────
    nut = rag.get("nutrition_plan", {})
    if nut:
        if y < m+120: c.showPage(); y = H-m
        c.setFont("Helvetica-Bold", 12)
        c.setFillColorRGB(0.04, 0.53, 0.27)
        c.drawString(m, y, f"Nutrition Plan — {nut.get('country','').title()}")
        c.setFillColorRGB(0, 0, 0); y -= 16
        for title, items in [
            ("Pre-Run Foods",     nut.get("pre_run_foods", [])),
            ("Post-Run Recovery", nut.get("post_run_recovery", [])),
            ("Hydration",         nut.get("hydration", [])),
            ("Anti-Inflammatory", nut.get("anti_inflammatory", [])),
        ]:
            if not items: continue
            if y < m+50: c.showPage(); y = H-m
            c.setFont("Helvetica-Bold", 10)
            c.drawString(m, y, f"  {title}:"); y -= 12
            c.setFont("Helvetica", 10)
            for item in items[:3]:
                c.drawString(m+12, y, f"• {item[:100]}"); y -= 12
                if y < m+40: c.showPage(); y = H-m
            y -= 4
        sups = nut.get("supplements", [])
        if sups:
            if y < m+80: c.showPage(); y = H-m
            c.setFont("Helvetica-Bold", 10)
            c.drawString(m, y, "  Supplements:"); y -= 12
            c.setFont("Helvetica", 10)
            for s in sups:
                c.drawString(m+12, y,
                    f"• {s.get('name','')} — {s.get('dose','')} ({s.get('reason','')[:60]})")
                y -= 12
                if y < m+40: c.showPage(); y = H-m
        if nut.get("budget_meal"):
            if y < m+40: c.showPage(); y = H-m
            c.setFont("Helvetica-Bold", 10)
            c.drawString(m, y, "  Budget Recovery Meal:"); y -= 12
            c.setFont("Helvetica", 10)
            c.drawString(m+12, y, f"• {nut['budget_meal'][:100]}"); y -= 16
        tp = nut.get("tendon_protocol")
        if tp:
            if y < m+60: c.showPage(); y = H-m
            c.setFont("Helvetica-Bold", 10)
            c.setFillColorRGB(0.6, 0.1, 0)
            c.drawString(m, y, "  Tendon Support Protocol:")
            c.setFillColorRGB(0, 0, 0); y -= 12
            c.setFont("Helvetica", 10)
            c.drawString(m+12, y, f"• {tp.get('protocol','')[:100]}"); y -= 12
            c.drawString(m+12, y, f"• Duration: {tp.get('duration','')}"); y -= 16

    # ── Injury Risk ─────────────────────────────────────────────
    risk = rag.get("injury_risk", {})
    if risk.get("level"):
        if y < m+100: c.showPage(); y = H-m
        level = risk["level"]
        rc = (0,140,0) if level=="Low" else (200,100,0) if level=="Moderate" else (180,0,0)
        c.setFillColorRGB(*[v/255 for v in rc])
        c.setFont("Helvetica-Bold", 12)
        c.drawString(m, y, f"Injury Risk: {level} (score={risk.get('risk_score',0)})")
        c.setFillColorRGB(0, 0, 0); y -= 16
        c.setFont("Helvetica", 10)
        for f in risk.get("factors", []):
            c.drawString(m, y, f"  ⚠ {f[:100]}"); y -= 13
            if y < m+50: c.showPage(); y = H-m
        c.drawString(m, y, f"  → {risk.get('advice','')[:100]}"); y -= 16

    # ── MKI Recommendations ─────────────────────────────────────
    recs = mki.get("recommendations", [])
    if recs:
        if y < m+80: c.showPage(); y = H-m
        c.setFont("Helvetica-Bold", 12)
        c.setFillColorRGB(0.3, 0.3, 0.8)
        c.drawString(m, y, "MKI Recommendations")
        c.setFillColorRGB(0, 0, 0); y -= 16
        c.setFont("Helvetica", 10)
        for r in recs:
            c.drawString(m, y, f"  • {r[:100]}"); y -= 13
            if y < m+40: c.showPage(); y = H-m

    # ── Footer ──────────────────────────────────────────────────
    c.setFont("Helvetica-Oblique", 8)
    c.setFillColorRGB(0.5, 0.5, 0.5)
    c.drawString(m, m-10,
        "SportsAI+ | RNSIT Final Year AIML Project | AI Biomechanics + RAG Nutrition | 2026")
    c.save()
    return out_path


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        result_path = Path(sys.argv[1])
        data        = json.loads(result_path.read_text())
        out         = Path("../storage/reports") / f"{result_path.stem}.pdf"
        out.parent.mkdir(parents=True, exist_ok=True)
        p = generate_pdf(data, out)
        print(f"Report saved → {p}  ({p.stat().st_size} bytes)")
