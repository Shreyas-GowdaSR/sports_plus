"""SportsAI+ — Running Biomechanics Analysis"""
import math, statistics
from typing import List, Dict

def _angle(a,b,c):
    ba = (a[0]-b[0], a[1]-b[1]); bc = (c[0]-b[0], c[1]-b[1])
    dot = ba[0]*bc[0]+ba[1]*bc[1]
    mag = math.hypot(*ba)*math.hypot(*bc)
    return math.degrees(math.acos(max(-1.0,min(1.0,dot/max(mag,1e-8)))))

def _pt(lm,idx):
    for l in lm:
        if l.get("id")==idx: return (l.get("x",0.0),l.get("y",0.0),l.get("z",0.0))
    return (0.0,0.0,0.0)

class RunningAnalysis:
    def run(self, stgcn_output):
        frames  = stgcn_output.get("body_keypoints",[])
        cycles  = stgcn_output.get("stride_cycles",[])
        n = len(frames)
        if n == 0:
            return self._empty()

        cadence_vals, knee_vals, hip_vals, ankle_vals, torso_vals, arm_vals = [],[],[],[],[],[]
        left_y, right_y = [], []

        for frame in frames:
            lm = frame.get("landmarks",[])
            lh = _pt(lm,23); rh = _pt(lm,24)
            lk = _pt(lm,25); rk = _pt(lm,26)
            la = _pt(lm,27); ra = _pt(lm,28)
            ls = _pt(lm,11); rs = _pt(lm,12)
            le = _pt(lm,13); re = _pt(lm,14)
            lw = _pt(lm,15); rw = _pt(lm,16)

            if all(v!=0 for v in [lk,lh,la,rk,rh,ra]):
                knee_vals.append((_angle(lh[:2],lk[:2],la[:2]) + _angle(rh[:2],rk[:2],ra[:2]))/2)
                hip_vals.append((_angle(ls[:2],lh[:2],lk[:2]) + _angle(rs[:2],rh[:2],rk[:2]))/2)
                ankle_vals.append((_angle(lk[:2],la[:2],(la[0],la[1]+0.1)) + _angle(rk[:2],ra[:2],(ra[0],ra[1]+0.1)))/2)

            if ls[1]!=0 and lh[1]!=0:
                dx = ls[0]-lh[0]; dy = lh[1]-ls[1]
                torso_vals.append(abs(math.degrees(math.atan2(dx,max(dy,1e-8)))))

            if all(v!=0 for v in [ls,le,lw]):
                arm_vals.append((_angle(ls[:2],le[:2],lw[:2]) + _angle(rs[:2],re[:2],rw[:2]))/2)

            if la[1]!=0: left_y.append(la[1])
            if ra[1]!=0: right_y.append(ra[1])

        fps = 30.0
        cadence = len(cycles)/max(n/fps,1e-8)*60 if cycles else 165.0

        def safe_mean(lst,default=0.0): return statistics.mean(lst) if lst else default
        def safe_std(lst): return statistics.stdev(lst) if len(lst)>1 else 0.0

        knee   = safe_mean(knee_vals, 155.0)
        hip    = safe_mean(hip_vals,  145.0)
        ankle  = safe_mean(ankle_vals, 90.0)
        torso  = safe_mean(torso_vals, 10.0)
        arm    = safe_mean(arm_vals,   90.0)

        # Symmetry: compare vertical excursion of left vs right ankle
        lrange = max(left_y)-min(left_y) if len(left_y)>1 else 0.0
        rrange = max(right_y)-min(right_y) if len(right_y)>1 else 0.0
        sym_diff = abs(lrange-rrange)/max(lrange+rrange,1e-8)
        symmetry = max(0.0, 100.0 - sym_diff*200)

        # Stride length heuristic from cadence
        stride_length = max(0.5, min(2.5, cadence/180.0*1.2))

        # Ground contact time heuristic
        gct = max(0.15, min(0.45, 0.35 - (cadence-150)*0.001))

        # Running efficiency composite
        cad_score = max(0, 100-abs(cadence-175)*1.5)
        sym_score = symmetry
        knee_score= max(0, 100-abs(knee-155)*0.8)
        efficiency= (cad_score+sym_score+knee_score)/3.0

        fs = "Heel" if cadence < 160 else "Midfoot" if cadence < 185 else "Forefoot"

        return {
            "cadence":             round(cadence,1),
            "step_frequency":      round(cadence/60,2),
            "stride_length":       round(stride_length,2),
            "ground_contact_time": round(gct,3),
            "knee_angle":          round(knee,1),
            "hip_angle":           round(hip,1),
            "ankle_angle":         round(ankle,1),
            "torso_lean":          round(torso,1),
            "arm_swing":           round(arm,1),
            "symmetry":            round(symmetry,1),
            "foot_strike":         fs,
            "running_efficiency":  round(efficiency,1),
        }

    def _empty(self):
        return {"cadence":165.0,"step_frequency":2.75,"stride_length":1.1,
                "ground_contact_time":0.28,"knee_angle":155.0,"hip_angle":145.0,
                "ankle_angle":90.0,"torso_lean":10.0,"arm_swing":90.0,
                "symmetry":90.0,"foot_strike":"Midfoot","running_efficiency":75.0}
