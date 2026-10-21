# Locked test evaluation

Dataset: Fukuchi et al. running biomechanics tables, Figshare version 5, CC BY 4.0. The source reports lower-extremity kinematics and kinetics normalized over 101 gait-cycle points; GRF is normalized by participant mass. See the [dataset](https://doi.org/10.6084/m9.figshare.4543435.v5) and [source paper](https://doi.org/10.7717/peerj.3298).

## Locked test protocol

- Fixed test cohort: participants 009, 015, 018, 021, 022, 026, 028, and 031 (8 people). Model selection used the other 31 participants only.
- 7,360 usable measured-force samples after data-quality screening; 5,692 development samples and 1,668 locked-test samples.
- Candidate model selection used four-fold `GroupKFold` on development participants. The locked test cohort was not used to select the architecture.
- Inputs: hip, knee, and ankle angles across five gait-cycle points (±2), speed, normalized gait phase, and side.
- Target: vertical GRF-Y, N/kg.
- Excluded from input: force, moment, and power values.
- 404 finite target rows with absolute magnitude above 50 N/kg were screened out as source-table inconsistencies. See `storage/results/grf_model/evaluation.json` for trial and sample counts.
- Ten candidate configurations were compared, including linear Ridge, ExtraTrees, RandomForest, gradient-boosting trees, a two-hidden-layer MLP, and participant-balanced HGB. The balanced HGB had the lowest mean participant-level validation MAE and was selected before evaluating the locked cohort.
- Target error rows above 50 N/kg are excluded by a predeclared quality-control screen. This removed 404 rows in 4 trials; the rule and counts are recorded in the JSON report.

## Development cohort model comparison

Selection used mean participant MAE across the four grouped validation folds (N/kg):

| Candidate | Mean development participant MAE |
|---|---:|
| Phase + speed Ridge | 7.15 |
| Kinematic Ridge | 2.070 |
| ExtraTrees, leaf 1 | 1.433 |
| ExtraTrees, leaf 2 | 1.437 |
| RandomForest, leaf 2 | 1.374 |
| Histogram Gradient Boosting, 15 leaves | 1.358 |
| Histogram Gradient Boosting, 31 leaves, unweighted | 1.323 |
| **Histogram Gradient Boosting, 31 leaves, participant-balanced** | **1.286** |
| GradientBoosting | 1.674 |
| MLP (128, 64) | 2.059 |

## Proposed-model parameter analysis

The selected estimator is `HistGradientBoostingRegressor` (scikit-learn), configured with `learning_rate=0.05`, `max_iter=200`, `max_leaf_nodes=31`, and `l2_regularization=1.0`. It receives 48 predictors: 45 joint-angle values (hip/knee/ankle × X/Y/Z × five gait-cycle positions), plus running speed, normalized gait phase, and side. Training weights give each development participant equal total weight, matching the participant-level model-selection objective. The target is measured vertical GRF-Y in N/kg. It uses two future and two past gait-cycle points, so it is an offline estimator. Random state is 42. This is a tabular boosted-tree model; it is not a CNN, LSTM, xLSTM, or video model.

The table reports the actually evaluated settings. Settings were not exhaustively optimized, so the winning configuration is only best among these candidates under the specified split and selection metric.

| Candidate | Key configuration | Development mean participant MAE (N/kg) |
|---|---|---:|
| Phase/speed Ridge | StandardScaler; alpha=10; speed, phase, side only | 7.154 |
| Kinematic Ridge | StandardScaler; alpha=10; all 48 inputs | 2.070 |
| ExtraTrees | 200 trees; max_features=0.8; min leaf=1 or 2 | 1.433 / 1.437 |
| Random Forest | 200 trees; max_features=0.8; min leaf=2 | 1.374 |
| Histogram Gradient Boosting | 200 iterations; learning rate=0.05; 15 leaves; L2=1 | 1.358 |
| Histogram Gradient Boosting (unweighted) | 200 iterations; learning rate=0.05; 31 leaves; L2=1 | 1.323 |
| **Histogram Gradient Boosting (participant-balanced)** | **Same HGB settings; each participant receives equal total training weight** | **1.286** |
| Gradient Boosting | 150 estimators; learning rate=0.05; depth=2; min leaf=5; Huber loss | 1.674 |
| MLP | hidden layers=(128,64); ReLU; alpha=0.01; learning rate=0.001; early stopping | 2.059 |

On the locked cohort, the selected participant-balanced HGB achieved pooled MAE 1.263 N/kg, RMSE 1.732 N/kg, and R² 0.958. Relative to kinematic Ridge on the same cohort, pooled MAE fell **39.0%** (2.071 to 1.263 N/kg), RMSE fell **34.1%**, and R² increased from 0.903 to 0.958. These are within-study comparisons, not a direct comparison with published papers.

### Paired participant-weighting comparison

Both HGB variants used the same features, hyperparameters, development participants, and locked cohort. The unweighted model had mean participant MAE 1.227 N/kg; participant-balanced HGB had 1.234 N/kg. The paired test difference (balanced minus unweighted) was +0.006 N/kg, with a participant-bootstrap 95% interval of −0.049 to +0.066 N/kg. Thus weighting improved development-fold MAE but did **not** show a test-cohort improvement; the test difference is small and uncertain. Full metrics are in `storage/results/grf_model/weighting_comparison.json`.

### Joint and temporal-context ablations

All ablations used the selected HGB training strategy and were declared before scoring the locked cohort. The MAEs below are descriptive; eight test participants do not support confident ranking of close variants.

| Input variant | Features | Development grouped-CV participant MAE | Locked pooled MAE | Locked R² |
|---|---:|---:|---:|---:|
| Full joint/temporal/context set | 48 | 1.286 | 1.263 | 0.958 |
| Center gait point only + speed/phase/side | 12 | 1.261 | 1.253 | 0.958 |
| All angle points, without speed/phase/side | 45 | 2.066 | 2.132 | 0.883 |
| Remove hip angles | 33 | 1.250 | 1.318 | 0.953 |
| Remove knee angles | 33 | 1.242 | 1.248 | 0.960 |
| Remove ankle angles | 33 | 1.350 | 1.286 | 0.956 |
| Hip angles only + context | 18 | 1.326 | 1.360 | 0.952 |
| Knee angles only + context | 18 | 1.333 | 1.201 | 0.962 |
| Ankle angles only + context | 18 | 1.180 | 1.268 | 0.958 |

The reduced center-point model uses 75% fewer inputs and had nearly the same locked MAE as the full-context model. The ankle-only variant had the lowest grouped-CV MAE, while its locked MAE was also close to the full model. These findings suggest the ±2 temporal points and every joint group are not necessary for this particular processed dataset; they do not prove feature irrelevance or generalize beyond it. Do not pick a variant based on the locked-test scores. Treat reduced-input models as candidates for a fresh external validation.

## Position against published work and novelty boundary

| Work | Data and input | Model/results reported | What is comparable, and what is not |
|---|---|---|---|
| Fukuchi et al. (2017), source dataset | 39 runners; processed running kinematics and kinetics at 2.5, 3.5, and 4.5 m/s | Dataset paper, not a competing ML architecture | Same source data. It establishes the data provenance; it does not provide the participant-held-out HGB comparison here. |
| CNN-xLSTM running vGRF study (2025) | 12 healthy male runners; wearable-sensor joint angles from hip/knee/ankle, three planes; stance phase, five speeds | CNN-xLSTM reported R²=0.909±0.064, MAPE=2.18±0.09, relative RMSE=0.061±0.008; also compared CNN-sLSTM, CNN-mLSTM, CNN-LSTM | Same broad task, but different cohort, sensor, phase coverage, protocol, split, and metrics. Its values cannot establish that our 0.958 R² is better. It analyzes joint and plane contributions; our ablation now analyzes joint groups and temporal context, but not individual anatomical planes. |
| Tedesco et al. (2025), *Gait & Posture* | Fukuchi public dataset, 28 recreational runners; three speeds; marker-derived acceleration profiles and treadmill GRF | Compares 1D-CNN, LSTM, and CNN-LSTM; describes subject-wise 60/20/20 partition and LOSO-CV; abstract says performance was comparable to simpler ANN work | Closest prior work and same dataset family. Its stated inputs/model protocol differ from this project's processed joint-angle features and HGB model. The abstract does not expose enough aligned quantitative detail for a score ranking. Our 39-subject preprocessing/QC and 8-person fixed test are not equivalent to its 28-subject subset or its evaluation protocol. |
| This project (current experiment) | Fukuchi processed joint angles; 39 runners total; fixed 31-development/8-test participant split; observed samples after QC | Participant-balanced HGB: MAE 1.263 N/kg, RMSE 1.732 N/kg, R² 0.958; kinematic Ridge: 2.071, 2.629, 0.903 | Demonstrates an internally better result than our own linear baselines under this protocol. It does not demonstrate superiority over published deep-learning methods or the 2025 benchmark using the same dataset family. |

**Defensible project contribution:** a reproducible participant-held-out HGB benchmark with participant-balanced training and joint/temporal feature ablations. The ablation suggests the model can use fewer inputs with similar error, while the paired comparison shows no clear test benefit from participant weighting. This is an empirical contribution, not a new neural architecture or a claim of first GRF estimation. A claim of superiority over published methods requires an aligned head-to-head protocol; independent-site validation is still needed.

Published references: [Fukuchi et al. (2017)](https://doi.org/10.7717/peerj.3298); [CNN-xLSTM study (2025)](https://doi.org/10.3390/s25041249); [Tedesco et al. (2025), *Gait & Posture*](https://doi.org/10.1016/j.gaitpost.2025.07.260). The latter is a short, peer-reviewed conference paper (pp. 242–244); its available text describes the protocol but does not provide machine-readable numerical table values, so do not make a quantitative head-to-head claim without transcribing and aligning those values and protocols.

## Locked test performance

| Model | Pooled MAE (N/kg) | Pooled RMSE (N/kg) | Pooled R² | Mean participant MAE (N/kg) |
|---|---:|---:|---:|---:|
| Phase + speed Ridge baseline | 7.06 | 8.03 | 0.090 | 7.03 |
| Kinematic Ridge baseline | 2.071 | 2.629 | 0.903 | 2.062 |
| Histogram Gradient Boosting (selected, participant-balanced) | **1.263** | **1.732** | **0.958** | **1.234** |

The bootstrap 95% interval for mean participant MAE is 1.02–1.53 N/kg, resampling the eight test participants. Test errors varied: participant 022 had the highest MAE (2.19 N/kg); the other seven ranged from 0.87 to 1.28 N/kg. See `storage/results/grf_model/holdout_evaluation.json` for per-runner scores, development-fold comparisons, and ablations.

## Interpretation limits

These curves are processed laboratory data and are averaged over trials. The model uses both past and future neighboring points, so it is an offline estimator, not a real-time causal model. The locked cohort is small, from the same dataset and protocol, and does not provide external-site validation. The dataset does not contain consumer phone video; these results do not validate the frontend MediaPipe pipeline. Do not present these estimates as medical measurements or injury predictions. “Best” here means best among the evaluated candidates under this split and MAE selection objective; it is not a universal best architecture.

