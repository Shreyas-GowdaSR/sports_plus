"""Legacy confidence/interpolation experiment; not independent sensor fusion.

The current pipeline passes the same MediaPipe landmarks as both inputs to
`fuse_frame`, so its confidence combination does not add independent evidence
and should not be described as validated Dempster-Shafer pose fusion.
"""
from typing import List, Dict, Optional
import numpy as np

VISIBILITY_THRESHOLD = 0.50
EPS = 1e-8


def dempster_combine(m1: float, m2: float) -> float:
    m1d = max(0.0, min(m1, 1.0-EPS))
    m2d = max(0.0, min(m2, 1.0-EPS))
    m1o, m2o = 1.0-m1d, 1.0-m2d
    K = m1d*m2o + m1o*m2d
    if K >= 1.0-EPS:
        return (m1d+m2d)/2.0
    return float(np.clip((m1d*m2d)/(1.0-K), 0.0, 1.0))


def temporal_interpolate(series: List[Optional[Dict]], window: int = 5) -> List[Dict]:
    n = len(series)
    result = [dict(s) if s else None for s in series]
    for i in range(n):
        if result[i] is None: continue
        if result[i].get("visibility",1.0) >= VISIBILITY_THRESHOLD: continue
        prev_idx = next((j for j in range(i-1, max(i-window-1,-1),-1)
                         if result[j] and result[j].get("visibility",0) >= VISIBILITY_THRESHOLD), None)
        next_idx = next((j for j in range(i+1, min(i+window+1,n))
                         if result[j] and result[j].get("visibility",0) >= VISIBILITY_THRESHOLD), None)
        if prev_idx is not None and next_idx is not None:
            alpha = (i-prev_idx)/(next_idx-prev_idx)
            for c in ["x","y","z"]:
                p = result[prev_idx].get(c,0.0); q = result[next_idx].get(c,0.0)
                result[i][c] = p + alpha*(q-p)
            result[i]["visibility"]   = VISIBILITY_THRESHOLD
            result[i]["interpolated"] = True
        elif prev_idx is not None:
            for c in ["x","y","z"]:
                result[i][c] = result[prev_idx].get(c, result[i].get(c,0.0))
            result[i]["interpolated"] = True
    return [r if r else {} for r in result]


def fuse_frame(mp_lm: List[Dict], mb_lm: List[Dict]) -> List[Dict]:
    mp_dict = {lm.get("id",-1): lm for lm in mp_lm}
    mb_dict = {lm.get("id",-1): lm for lm in mb_lm}
    all_ids = sorted(set(mp_dict)|set(mb_dict))
    fused = []
    for idx in all_ids:
        if idx < 0: continue
        a, b = mp_dict.get(idx), mb_dict.get(idx)
        if a is None and b is None: continue
        if a is None: fused.append({**b,"fused":False}); continue
        if b is None: fused.append({**a,"fused":False}); continue
        ca = float(a.get("visibility",0.5)); cb = float(b.get("visibility",0.5))
        cf = dempster_combine(ca, cb)
        tw = ca+cb+EPS
        fused.append({
            "id":idx,
            "x":round((a.get("x",0)*ca+b.get("x",0)*cb)/tw, 6),
            "y":round((a.get("y",0)*ca+b.get("y",0)*cb)/tw, 6),
            "z":round(b.get("z_lifted", b.get("z", a.get("z",0.0))), 6),
            "visibility":round(cf,6), "conf_mp":round(ca,4), "conf_mb":round(cb,4),
            "fused":True, "interpolated":False,
        })
    return fused


class DSFusion:
    def __init__(self): self.threshold = VISIBILITY_THRESHOLD

    def fuse_sequence(self, frames):
        fused_frames = []
        joint_series: Dict[int,List] = {}
        for frame in frames:
            lm = frame.get("landmarks",[])
            fl = fuse_frame(lm, lm)
            for item in fl:
                jid = item.get("id",-1)
                if jid >= 0:
                    if jid not in joint_series: joint_series[jid] = []
                    joint_series[jid].append(item)
            fused_frames.append({**{k:v for k,v in frame.items() if k!="landmarks"},"landmarks":fl})
        for jid, series in joint_series.items():
            interp = temporal_interpolate(series)
            for fi, lm in enumerate(interp):
                if fi < len(fused_frames):
                    for j, existing in enumerate(fused_frames[fi]["landmarks"]):
                        if existing.get("id")==jid:
                            fused_frames[fi]["landmarks"][j] = lm; break
        nb = sum(1 for f in frames for lm in f.get("landmarks",[]) if lm.get("visibility",1.0)<self.threshold)
        na = sum(1 for f in fused_frames for lm in f.get("landmarks",[]) if lm.get("visibility",1.0)<self.threshold)
        rr = max(0.0,(nb-na)/max(nb,1))
        print(f"[DSFusion] before={nb} after={na} recovery={rr:.1%}")
        return fused_frames, {"occlusions_before":nb,"occlusions_after":na,"recovery_rate":round(rr,4)}

    def run(self, motionbert_output):
        frames = motionbert_output.get("skeleton3d",[])
        if not frames: return {"status":"empty","frames":0,"refined_pose":[],"fusion_stats":{}}
        fused_frames, stats = self.fuse_sequence(frames)
        return {"status":"completed","frames":len(fused_frames),"refined_pose":fused_frames,"fusion_stats":stats}
