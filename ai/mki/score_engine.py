"""SportsAI+ — MKI Score Engine (0-100 composite movement quality index)"""
class MKIEngine:
    WEIGHTS = {"cadence":0.22,"symmetry":0.20,"ground_contact_time":0.18,
               "stride_length":0.12,"knee_angle":0.10,"hip_angle":0.08,
               "ankle_angle":0.05,"torso_lean":0.05}
    IDEALS  = {"cadence":175,"symmetry":100,"ground_contact_time":0.22,
               "stride_length":1.2,"knee_angle":155,"hip_angle":145,
               "ankle_angle":90,"torso_lean":8}
    RANGES  = {"cadence":30,"symmetry":20,"ground_contact_time":0.15,
               "stride_length":0.5,"knee_angle":30,"hip_angle":30,
               "ankle_angle":30,"torso_lean":10}

    def run(self, metrics):
        total, wsum = 0.0, 0.0
        component_scores = {}
        recs = []
        for key,w in self.WEIGHTS.items():
            val  = metrics.get(key,self.IDEALS[key])
            diff = abs(val - self.IDEALS[key])
            rng  = self.RANGES[key]
            score= max(0.0, 100.0 - (diff/rng)*100.0)
            component_scores[key] = round(score,1)
            total += score*w; wsum += w
        mki = min(100.0, max(0.0, total/max(wsum,1e-8)))
        grade = "Excellent" if mki>=85 else "Good" if mki>=70 else "Average" if mki>=55 else "Poor"
        if metrics.get("cadence",175) < 165: recs.append("Increase cadence toward 175 spm using A-Skip drills")
        if metrics.get("symmetry",100) < 90: recs.append("Address left-right asymmetry with single-leg strength work")
        if metrics.get("ground_contact_time",0.25) > 0.28: recs.append("Reduce ground contact time with ankle hop drills")
        if metrics.get("torso_lean",8) > 14: recs.append("Reduce excessive forward lean — lean from ankles not waist")
        if not recs: recs.append("Maintain current mechanics and continue progressive loading")
        return {"mki_score":round(mki,1),"grade":grade,"component_scores":component_scores,"recommendations":recs}
