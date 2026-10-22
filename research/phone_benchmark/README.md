# Phone form-check benchmark

How accurate is a running form check from a phone video? This folder measures it against
laboratory ground truth, so every change to the form-check engine (3D lifting, ST-GCN,
better signal processing) can be judged by numbers rather than claims.

## Idea: synthetic phone videos of real runners

The Fukuchi 2017 dataset ([PeerJ](https://doi.org/10.7717/peerj.3298),
[data](https://doi.org/10.6084/m9.figshare.4543435.v5), CC BY 4.0) has 3D motion capture
(150 Hz) and an instrumented treadmill (300 Hz) for runners at 2.5, 3.5 and 4.5 m/s. It
has no video, so we make the "video" ourselves: each trial is projected through a virtual
phone camera, and pose-detector noise is added. Because the motion is real, every clip
comes with exact answers:

| Ground truth | From |
|---|---|
| Foot contact times and step rate | Treadmill vertical force crossing 50 N |
| Foot-strike type per foot and speed | The dataset authors' own labels (`RBDSinfo.txt`) |
| Landing distance ahead of the pelvis | 3D ankle vs pelvis position at contact |
| Knee flexion angle | 3D hip, knee and ankle joint centres |
| Pelvic vertical bounce, pelvic level | 3D pelvis |

Joint centres are rebuilt from the static calibration trial (rigid cluster fit; Harrington
2007 hip centres). Each trial becomes 72 clips: 6 camera views (side left/right, two
obliques, front, back) × portrait/landscape × 30/60 fps × 3 noise levels.

## Files

| File | What it does |
|---|---|
| `download_raw.py` | Downloads the 242 raw files (421 MB, MD5-checked) to `storage/datasets/fukuchi2017/raw/` (gitignored) |
| `mocap.py` | Joint centres, sole-level heel/toe points, force-plate contact events |
| `truth.py` | Ground-truth measures per trial |
| `synth.py` | Phone camera projection and detector-noise model |
| `app_baseline.py` | Faithful Python port of the app's current screen (`frontend/src/lib/running.ts` + 60 Hz sampling from `pose.ts`) |
| `run_baseline.py` | Runs everything → `results/phase1_baseline.json` |
| `report_phase1.py` | Tables → `results/phase1_tables.md` |

```bash
python research/phone_benchmark/download_raw.py
python research/phone_benchmark/run_baseline.py     # about 1 minute
python research/phone_benchmark/report_phase1.py
```

## Phase 1 result: the current form check

36 runners, 96 trials, 6,912 synthetic clips. Runner RBDS032 is excluded (its three speed
files are byte-identical); two trials were skipped (too short; missing markers). Full
tables: [`results/phase1_tables.md`](results/phase1_tables.md). Main findings, side view,
60 fps, "typical" detector noise unless stated:

1. **Foot-contact detection breaks down under ordinary keypoint jitter.** With perfect
   keypoints it finds 97% of contacts with 93% precision. With typical noise, precision falls
   to **32%** (most "contacts" are noise), and the step rate is wrong by hundreds of steps
   per minute. The detector takes any single frame where the ankle is lowest and does no
   smoothing.
2. **30 fps video adds false contacts even before noise.** The app samples every 1/60 s, so a
   30 fps video gives each frame twice, and the "lowest point" test fires on the duplicates.
3. **Contacts are found late, so foot strike is misread.** Even with perfect keypoints,
   detections come about **+29 ms** after true contact (at the ankle's lowest point, when the
   foot is already flat). Foot-strike type per contact is then right only **21%** of the
   time (worse than guessing among three classes), and the clip-level label **15%**.
4. **The image aspect ratio is not corrected.** MediaPipe returns x as a fraction of width and
   y as a fraction of height; the app uses them directly. In a 16:9 frame this distorts every
   angle and distance ratio:
   - The knee angle from perfect side-view keypoints is off by **17.6°**; after the fix, **1.9°**.
   - With typical noise the error falls from **19.5° to 6.8°**.
   - In landscape the view detector calls front and back views "side" **100%** of the time
     (0% correct).
5. **2D cannot measure the knee from the front or back.** After the aspect fix the knee angle
   is still off by **38–41°** in front/back views and **13°** in oblique views, against
   **6.8°** from the side. This is where 3D lifting (Phase 2) has to prove itself.
6. **Pelvic bounce is swamped by noise.** The error is 6% of torso length with perfect
   keypoints, 63% with typical noise.

## What this means for the next phases

- **Before any deep model,** the cheapest large gains are signal-processing fixes:
  - correct the aspect ratio
  - smooth keypoints over time
  - detect contacts from foot speed and height instead of a single lowest frame
  - take frames at the video's real frame rate

  Phase 2 adds these as the "improved 2D" baseline, so 3D lifting and ST-GCN are compared
  against a fair baseline rather than a broken one.
- **3D lifting (MotionBERT)** is judged on knee angle in oblique, front and back views.
- **ST-GCN** is judged on contact timing and foot-strike type, trained on clips from
  development runners with force-plate labels, and tested on the locked cohort.
- The app's output format (`RunningAnalysis`) stays the same, so the UI, drills and AI coach
  keep working unchanged and simply receive a more accurate result.

## Limits

- **The noise levels are assumptions**, not measured MediaPipe or RTMPose errors, because
  the dataset has no video. Results are therefore shown across a range (none, typical,
  hard). The "none" rows show the best any 2D method could do with these keypoints.
- **Motion capture covers only the pelvis and legs.** Trunk, arms and head are not scored.
  The synthetic upper body exists only so the app's code can run.
- **The runners are on a treadmill, filmed by a camera that keeps them centred.** Overground
  running, clothing, lighting and motion blur are not simulated.
- **The virtual heel and toe points assume a rigid foot,** so the toe dips below the floor at
  push-off. Measures taken at foot contact are not affected.
