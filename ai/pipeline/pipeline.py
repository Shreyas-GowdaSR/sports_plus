"""
SportsAI+ — 8-Stage Pipeline Orchestrator
AI folder structure: ai/ is the root, storage is at ../storage/
"""
import sys, json
from datetime import datetime
from pathlib import Path

AI_DIR = Path(__file__).resolve().parent.parent   # sportsai_v3/ai/
sys.path.insert(0, str(AI_DIR))

from motionbert.motionbert_wrapper import MotionBERTWrapper
from ds_fusion.ds_fusion           import DSFusion
from stgcn.stgcn_wrapper           import STGCNWrapper
from analysis.running_analysis     import RunningAnalysis
from mki.score_engine              import MKIEngine
from coach.coach_engine            import CoachEngine
from rag_llm.rag_engine            import RAGCoachEngine


class SportsAIPipeline:

    def __init__(self, country: str = "india"):
        self.country     = country.lower()
        self.storage_dir = AI_DIR.parent / "storage"
        self.results_dir = self.storage_dir / "results"
        self.results_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n=== SportsAI+ Pipeline | country={self.country} ===")
        self.motionbert = MotionBERTWrapper()
        self.ds_fusion  = DSFusion()
        self.stgcn      = STGCNWrapper()
        self.analysis   = RunningAnalysis()
        self.mki        = MKIEngine()
        self.coach      = CoachEngine()
        self.rag        = RAGCoachEngine(country=self.country)
        print("[Pipeline] All modules loaded ✓")

    def _step(self, steps, name, status, msg=None):
        steps.append({"name": name, "status": status, "message": msg})
        print(f"  [{status.upper():<9}] {name}" + (f" — {msg}" if msg else ""))

    def run(self, frames: list, video_name: str = "video") -> dict:
        steps = []

        # Stage 2: MotionBERT 3D lifting
        try:
            mb = self.motionbert.run(frames)
            self._step(steps, "MotionBERT-3D", "completed",
                       f"latency={mb.get('latency_ms', 0):.1f}ms")
        except Exception as e:
            self._step(steps, "MotionBERT-3D", "failed", str(e))
            mb = {"skeleton3d": frames, "lifted_3d": []}

        # Stage 3: D-S Fusion
        try:
            mm    = self.ds_fusion.run(mb)
            stats = mm.get("fusion_stats", {})
            self._step(steps, "DSFusion", "completed",
                       f"recovery={stats.get('recovery_rate', 0):.1%}")
        except Exception as e:
            self._step(steps, "DSFusion", "failed", str(e))
            mm = {"refined_pose": frames, "fusion_stats": {}}

        # Stage 4: ST-GCN
        try:
            sg = self.stgcn.run(mm)
            self._step(steps, "ST-GCN", "completed",
                       f"strides={len(sg.get('stride_cycles', []))}")
        except Exception as e:
            self._step(steps, "ST-GCN", "failed", str(e))
            sg = {"body_keypoints": frames, "stride_cycles": [],
                  "joint_trajectories": {}, "frames": len(frames), "fusion_stats": {}}

        # Stage 5: Running analysis
        try:
            metrics = self.analysis.run(sg)
            self._step(steps, "RunningAnalysis", "completed",
                       f"cadence={metrics['cadence']:.0f} sym={metrics['symmetry']:.0f}%")
        except Exception as e:
            self._step(steps, "RunningAnalysis", "failed", str(e))
            metrics = self.analysis._empty()

        # Stage 6: MKI score
        try:
            mki_out = self.mki.run(metrics)
            self._step(steps, "MKI", "completed",
                       f"score={mki_out['mki_score']:.1f} grade={mki_out['grade']}")
        except Exception as e:
            self._step(steps, "MKI", "failed", str(e))
            mki_out = {"mki_score": 0.0, "grade": "Poor",
                       "recommendations": [], "component_scores": {}}

        # Stage 7: Rule-based coach
        try:
            coach_out = self.coach.run(metrics, mki_out)
            self._step(steps, "CoachEngine", "completed")
        except Exception as e:
            self._step(steps, "CoachEngine", "failed", str(e))
            coach_out = {"strengths": [], "improvements": [],
                         "training_plan": [], "personalized_advice": ""}

        # Stage 8: RAG-LLM
        try:
            rag_out = self.rag.run(metrics, mki_out)
            self._step(steps, "RAG-LLM", "completed",
                       f"drills={len(rag_out.get('drill_plan', []))}")
        except Exception as e:
            self._step(steps, "RAG-LLM", "failed", str(e))
            rag_out = {
                "coaching_cue":   coach_out.get("personalized_advice", ""),
                "drill_plan":     [],
                "nutrition_plan": {},
                "injury_risk":    {"level": "Unknown", "factors": [], "advice": ""},
                "errors_detected": [],
            }

        result = {
            "status":           "success",
            "video_name":       video_name,
            "frames_processed": len(frames),
            "country":          self.country,
            "running_metrics":  metrics,
            "mki_output":       mki_out,
            "coach_output":     coach_out,
            "rag_output":       rag_out,
            "pipeline_steps":   steps,
            "completed_at":     datetime.utcnow().isoformat(),
        }

        out = self.results_dir / f"{Path(video_name).stem}.json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, default=str)

        print(f"\n[Pipeline] ✓ MKI={mki_out['mki_score']:.1f}"
              f" | Grade={mki_out['grade']} | {out}")
        return result
