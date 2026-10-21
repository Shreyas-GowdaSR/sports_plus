# Running biomechanics ML project

## Research question

Can lower-limb joint kinematics and running speed predict the published vertical ground-reaction-force signal over a normalized running gait cycle for a runner not seen during training?

This is a measurable supervised-learning task supported by real synchronized biomechanics data. It replaces the prototype's synthetic 3D-pose training with a subject-independent benchmark. It is a research module, not yet a validated phone-video estimator: the public data contains motion-capture-derived joint angles and force-plate measurements, not ordinary phone video or MediaPipe landmarks.

## Dataset

The downloader fetches the compact processed tables and metadata from Fukuchi, Fukuchi, and Duarte (2017), *A public data set of running biomechanics and the effects of running speed on lower extremity kinematics and kinetics*, Figshare DOI [10.6084/m9.figshare.4543435.v5](https://doi.org/10.6084/m9.figshare.4543435.v5). The current Figshare record provides processed data for 39 subjects at 2.5, 3.5, and 4.5 m/s. The source paper reports that GRF is normalized by body mass, so the target is the published vertical GRF component `GRFy` in N/kg. License: CC BY 4.0. The downloader records source URLs and checks the publisher-provided MD5 for each downloaded file.

Raw files are stored under `storage/datasets/fukuchi2017/` and are not included in source control. Cite the dataset and retain its attribution when reusing derived results.

## Reproduce

From the repository root:

```powershell
python -m pip install -r research/requirements.txt
python research/download_dataset.py
python research/validate_models.py
python research/compare_hgb_weighting.py
```

The training script builds one sample per subject, speed, side, and normalized gait-cycle point. Inputs are five neighboring samples (±2 points) of hip, knee, and ankle angles, speed, normalized gait phase, and side. Target is the matching published vertical GRF-Y value in N/kg. Moment, power, and other force columns are excluded from inputs to prevent target leakage. Rows without a measured force value are omitted, so evaluation covers observed force-contact samples, not a full stance/swing classifier. A conservative QC screen excludes target magnitudes above 50 N/kg; excluded rows and trial counts are recorded in the evaluation JSON because the downloaded archive contains a few inconsistent force values.

`validate_models.py` reserves a fixed eight-runner test cohort before selection. Ten candidates, including Ridge, ExtraTrees, RandomForest, gradient-boosting variants, an MLP, and participant-balanced HGB, are compared using four-fold `GroupKFold` inside the remaining 31-runner development cohort. Selection minimizes mean MAE across validation participants. The participant-balanced HGB gives every development participant equal total sample weight during fitting, matching the participant-level selection objective more closely. The selected model and baselines are evaluated on the locked test cohort. A predeclared secondary ablation repeats grouped validation and locked evaluation while removing temporal context, speed/phase context, or individual joint groups. These ablations do not alter the primary model selection. The script saves the test report, a development-only model tied to that report, and a separate full-data refit for subsequent experiments under `storage/results/grf_model/`. The full-data refit is not the tested artifact.

The earlier `train_grf_model.py` script reproduces the initial ExtraTrees/Ridge cross-validation benchmark; use `validate_models.py` for the current locked-test experiment.

## What makes the evaluation defensible

- Splits are by participant, not by frames or gait cycles. The fixed test subjects are frozen in the script and listed in the saved report.
- Temporal windows are constructed on original table row positions before invalid force targets are masked, so quality-control exclusions do not compress time and create false neighbors.
- The reported target is vertical GRF in N/kg, as specified by the source paper. It is not a clinical ground-contact-time measurement. Target magnitudes above 50 N/kg are treated as source-table inconsistencies and excluded; this rule is explicit and counted in the saved report.
- The model predicts from laboratory-derived kinematic angles. It does not establish that monocular phone video can recover the same signal.
- This dataset is small at the participant level. Cross-validation estimates generalization to similar runners and lab protocols, not arbitrary populations, surfaces, cameras, or injury status.
- No score is described as “perfect”; report the measured held-out metrics and limitations.

## Next research steps

1. Recheck processed-table variable definitions and units against the source article before extending the dataset.
2. Add a separately sourced, appropriately licensed video-to-kinematics dataset or collect synchronized phone video and motion-capture trials under ethics approval.
3. Freeze a subject-level test cohort before any model selection, add uncertainty estimates, and compare against domain-appropriate baselines.
4. Obtain independent data for external validation before connecting any research estimator to an inference endpoint. Do not display force-plate estimates from the current MediaPipe pipeline as validated measurements.

