"""Legacy ankle-trajectory peak heuristic, not a graph convolution network."""
import numpy as np
class STGCNWrapper:
    def run(self, mmpose_output):
        frames = mmpose_output.get("refined_pose",[])
        trajectories = {}
        for frame in frames:
            for lm in frame.get("landmarks",[]):
                jid = lm.get("id",-1)
                if jid<0: continue
                if jid not in trajectories: trajectories[jid]=[]
                trajectories[jid].append({"x":lm.get("x",0),"y":lm.get("y",0),"z":lm.get("z",0),"visibility":lm.get("visibility",1.0)})
        # Detect stride cycles from ankle vertical motion
        cycles = []
        for ankle_id in [27,28]:
            if ankle_id not in trajectories: continue
            ay = [p["y"] for p in trajectories[ankle_id]]
            for i in range(1,len(ay)-1):
                if ay[i]>=ay[i-1] and ay[i]>=ay[i+1] and abs(ay[i]-ay[i-1])>0.005:
                    cycles.append(i)
        cycles = sorted(set(cycles))
        return {"frames":len(frames),"stride_cycles":cycles,
                "joint_trajectories":{str(k):v for k,v in trajectories.items()},
                "body_keypoints":frames,"fusion_stats":mmpose_output.get("fusion_stats",{})}
