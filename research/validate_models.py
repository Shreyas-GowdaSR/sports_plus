"""Locked participant test, development-only model search, and final evaluation."""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import (
    ExtraTreesRegressor,
    GradientBoostingRegressor,
    HistGradientBoostingRegressor,
    RandomForestRegressor,
)
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from train_grf_model import OUTPUT_DIR, build_samples


# Frozen before inspecting any test scores. Never move a subject between sets
# after viewing these results; create a new versioned experiment if needed.
TEST_SUBJECTS = {"009", "015", "018", "021", "022", "026", "028", "031"}
RANDOM_STATE = 42


def candidates() -> dict[str, object]:
    return {
        "phase_speed_ridge": make_pipeline(
            StandardScaler(), Ridge(alpha=10.0),
        ),
        "kinematic_ridge": make_pipeline(
            StandardScaler(), Ridge(alpha=10.0),
        ),
        "extra_trees_leaf1": ExtraTreesRegressor(
            n_estimators=200, min_samples_leaf=1, max_features=0.8,
            n_jobs=2, random_state=RANDOM_STATE,
        ),
        "extra_trees_leaf2": ExtraTreesRegressor(
            n_estimators=200, min_samples_leaf=2, max_features=0.8,
            n_jobs=2, random_state=RANDOM_STATE,
        ),
        "random_forest_leaf2": RandomForestRegressor(
            n_estimators=200, min_samples_leaf=2, max_features=0.8,
            n_jobs=2, random_state=RANDOM_STATE,
        ),
        "hist_gradient_boosting": HistGradientBoostingRegressor(
            learning_rate=0.05, max_iter=200, max_leaf_nodes=15,
            l2_regularization=1.0, random_state=RANDOM_STATE,
        ),
        "hist_gradient_boosting_wide": HistGradientBoostingRegressor(
            learning_rate=0.05, max_iter=200, max_leaf_nodes=31,
            l2_regularization=1.0, random_state=RANDOM_STATE,
        ),
        "hist_gradient_boosting_subject_balanced": HistGradientBoostingRegressor(
            learning_rate=0.05, max_iter=200, max_leaf_nodes=31,
            l2_regularization=1.0, random_state=RANDOM_STATE,
        ),
        "gradient_boosting": GradientBoostingRegressor(
            n_estimators=150, learning_rate=0.05, max_depth=2,
            min_samples_leaf=5, loss="huber", random_state=RANDOM_STATE,
        ),
        "mlp_128_64": make_pipeline(
            StandardScaler(),
            MLPRegressor(
                hidden_layer_sizes=(128, 64), activation="relu", alpha=0.01,
                learning_rate_init=0.001, max_iter=300, early_stopping=True,
                validation_fraction=0.15, n_iter_no_change=20,
                random_state=RANDOM_STATE,
            ),
        ),
    }


def fit_candidate(model, name: str, x_train, y_train, train_groups):
    """Optionally equalize total training weight for each participant."""
    if name == "hist_gradient_boosting_subject_balanced":
        unique, counts = np.unique(train_groups, return_counts=True)
        count_by_subject = dict(zip(unique, counts))
        weights = np.asarray([1.0 / count_by_subject[group] for group in train_groups])
        weights *= len(weights) / weights.sum()
        return model.fit(x_train, y_train, sample_weight=weights)
    return model.fit(x_train, y_train)


def score(y: np.ndarray, pred: np.ndarray, groups: np.ndarray) -> dict:
    subject_mae = [mean_absolute_error(y[groups == subject], pred[groups == subject])
                   for subject in sorted(np.unique(groups))]
    return {
        "pooled_mae_n_per_kg": float(mean_absolute_error(y, pred)),
        "pooled_rmse_n_per_kg": float(np.sqrt(mean_squared_error(y, pred))),
        "pooled_r2": float(r2_score(y, pred)),
        "mean_subject_mae_n_per_kg": float(np.mean(subject_mae)),
        "median_subject_mae_n_per_kg": float(np.median(subject_mae)),
        "subject_mae": {str(s): float(mean_absolute_error(y[groups == s], pred[groups == s]))
                        for s in sorted(np.unique(groups))},
    }


def _feature_subset(X, name: str):
    if name == "phase_speed_ridge":
        return X[["speed_m_s", "gait_phase", "side_is_left"]]
    context = ["speed_m_s", "gait_phase", "side_is_left"]
    angle_columns = [column for column in X.columns if "Ang" in column]
    if name == "ablation_center_only":
        return X[[column for column in angle_columns if column.endswith("lag+0")] + context]
    if name == "ablation_angles_only":
        return X[angle_columns]
    if name.startswith("ablation_without_"):
        joint = name.removeprefix("ablation_without_")
        return X[[column for column in X.columns if not column.startswith(f"{joint}Ang")]]
    if name.startswith("ablation_only_"):
        joint = name.removeprefix("ablation_only_")
        return X[[column for column in X.columns if column.startswith(f"{joint}Ang")] + context]
    return X


FEATURE_ABLATIONS = {
    "full_context_and_temporal_angles": "All angle axes/joints at five gait points plus speed, phase, side",
    "ablation_center_only": "Only same-point angles plus speed, phase, side",
    "ablation_angles_only": "All angles and temporal context; no speed, phase, or side",
    "ablation_without_hip": "Remove every hip-angle input from the full feature set",
    "ablation_without_knee": "Remove every knee-angle input from the full feature set",
    "ablation_without_ankle": "Remove every ankle-angle input from the full feature set",
    "ablation_only_hip": "Hip angles only plus speed, phase, side",
    "ablation_only_knee": "Knee angles only plus speed, phase, side",
    "ablation_only_ankle": "Ankle angles only plus speed, phase, side",
}


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    X, y, groups, feature_names, qc = build_samples()
    test_mask = np.isin(groups, list(TEST_SUBJECTS))
    if set(np.unique(groups[test_mask])) != TEST_SUBJECTS:
        missing = sorted(TEST_SUBJECTS - set(np.unique(groups)))
        raise RuntimeError(f"Locked test cohort does not match this dataset; missing={missing}")
    if np.any(test_mask) and len(np.unique(groups[~test_mask])) < 12:
        raise RuntimeError("Insufficient development subjects after applying the locked cohort.")

    X_dev, y_dev, g_dev = X.loc[~test_mask].reset_index(drop=True), y[~test_mask], groups[~test_mask]
    X_test, y_test, g_test = X.loc[test_mask].reset_index(drop=True), y[test_mask], groups[test_mask]
    inner_cv = GroupKFold(n_splits=4)
    model_specs = candidates()
    dev_scores = {}

    for name, prototype in model_specs.items():
        fold_subject_mae = []
        for fold, (train_idx, val_idx) in enumerate(inner_cv.split(X_dev, y_dev, g_dev), start=1):
            x_train = _feature_subset(X_dev.iloc[train_idx], name)
            x_val = _feature_subset(X_dev.iloc[val_idx], name)
            model = prototype
            # A fresh estimator per fold; no state is carried across CV folds.
            from sklearn.base import clone
            model = clone(prototype)
            fit_candidate(model, name, x_train, y_dev[train_idx], g_dev[train_idx])
            pred = model.predict(x_val)
            fold_metrics = score(y_dev[val_idx], pred, g_dev[val_idx])
            fold_subject_mae.append(fold_metrics["mean_subject_mae_n_per_kg"])
        dev_scores[name] = {
            "mean_grouped_cv_subject_mae_n_per_kg": float(np.mean(fold_subject_mae)),
            "fold_subject_mae_n_per_kg": [float(v) for v in fold_subject_mae],
        }
        print(f"development {name}: {dev_scores[name]['mean_grouped_cv_subject_mae_n_per_kg']:.3f} N/kg", flush=True)

    selected_name = min(dev_scores, key=lambda key: dev_scores[key]["mean_grouped_cv_subject_mae_n_per_kg"])

    # Evaluate the selected candidate and pre-declared baselines on the locked
    # participant cohort. The test cohort is not used for model selection.
    test_names = list(dict.fromkeys([selected_name, "kinematic_ridge", "phase_speed_ridge"]))
    holdout_scores = {}
    for name in test_names:
        model = model_specs[name]
        fit_candidate(model, name, _feature_subset(X_dev, name), y_dev, g_dev)
        pred = model.predict(_feature_subset(X_test, name))
        holdout_scores[name] = score(y_test, pred, g_test)
        print(f"locked test {name}: {holdout_scores[name]['pooled_mae_n_per_kg']:.3f} N/kg MAE", flush=True)
        if name == selected_name:
            joblib.dump({
                "model": model,
                "feature_names": list(_feature_subset(X_dev, name).columns),
                "target": "vertical GRFy, N/kg",
                "trained_subjects": sorted(set(g_dev)),
                "locked_test_subjects": sorted(TEST_SUBJECTS),
                "model_name": selected_name,
                "training_scope": "development subjects only; held-out test participants excluded",
            }, OUTPUT_DIR / "holdout_model.joblib")

    primary_result = holdout_scores[selected_name]
    test_subject_mae = np.asarray(list(primary_result["subject_mae"].values()), dtype=float)
    rng = np.random.default_rng(RANDOM_STATE)
    bootstrap_means = np.mean(
        rng.choice(test_subject_mae, size=(20000, len(test_subject_mae)), replace=True), axis=1
    )
    primary_result["mean_subject_mae_bootstrap_95pct_ci_n_per_kg"] = [
        float(np.quantile(bootstrap_means, 0.025)), float(np.quantile(bootstrap_means, 0.975)),
    ]

    # Predeclared feature ablations answer whether the added temporal context,
    # speed/phase context, and joint groups contribute under the same subject
    # folds. This is a secondary explanatory experiment; it does not replace
    # or retune the selected primary model using the locked cohort.
    ablation_report = {}
    full_hgb = model_specs[selected_name]
    for ablation_name, description in FEATURE_ABLATIONS.items():
        dev_fold_scores = []
        for train_idx, val_idx in inner_cv.split(X_dev, y_dev, g_dev):
            from sklearn.base import clone
            model = clone(full_hgb)
            x_train = _feature_subset(X_dev.iloc[train_idx], ablation_name)
            x_val = _feature_subset(X_dev.iloc[val_idx], ablation_name)
            fit_candidate(model, selected_name, x_train, y_dev[train_idx], g_dev[train_idx])
            fold_pred = model.predict(x_val)
            dev_fold_scores.append(score(y_dev[val_idx], fold_pred, g_dev[val_idx])["mean_subject_mae_n_per_kg"])
        x_dev_ablation = _feature_subset(X_dev, ablation_name)
        x_test_ablation = _feature_subset(X_test, ablation_name)
        ablation_model = clone(full_hgb)
        fit_candidate(ablation_model, selected_name, x_dev_ablation, y_dev, g_dev)
        ablation_pred = ablation_model.predict(x_test_ablation)
        ablation_report[ablation_name] = {
            "description": description,
            "feature_count": int(x_dev_ablation.shape[1]),
            "development_cv_mean_subject_mae_n_per_kg": float(np.mean(dev_fold_scores)),
            "development_cv_fold_subject_mae_n_per_kg": [float(value) for value in dev_fold_scores],
            "locked_test": score(y_test, ablation_pred, g_test),
        }

    report = {
        "experiment": "locked subject-level test with development-only model selection",
        "source": "Fukuchi et al. 2017, Figshare DOI 10.6084/m9.figshare.4543435.v5",
        "license": "CC BY 4.0",
        "target": "vertical ground-reaction force GRFy (N/kg)",
        "features": feature_names,
        "quality_control": qc,
        "locked_test_subjects": sorted(TEST_SUBJECTS),
        "development_subjects": sorted(set(groups[~test_mask])),
        "development_samples": int(len(y_dev)),
        "locked_test_samples": int(len(y_test)),
        "model_selection_metric": "mean per-subject MAE, averaged over 4-fold GroupKFold within development cohort",
        "development_cv": dev_scores,
        "selected_model": selected_name,
        "selected_model_parameters": model_specs[selected_name].get_params(deep=False),
        "selected_model_training": (
            "Each development participant has equal total sample weight."
            if selected_name == "hist_gradient_boosting_subject_balanced"
            else "Unweighted sample-level fitting."
        ),
        "locked_test": holdout_scores,
        "feature_ablation": {
            "purpose": "Secondary, predeclared feature contribution analysis; not used to tune the primary model.",
            "primary_model": selected_name,
            "primary_configuration": "HistGradientBoostingRegressor; learning_rate=0.05; max_iter=200; max_leaf_nodes=31; l2_regularization=1.0",
            "participant_balanced_training": selected_name == "hist_gradient_boosting_subject_balanced",
            "results": ablation_report,
        },
        "caveats": [
            "Only eight participants are in the locked test cohort, so uncertainty is substantial.",
            "Data are processed, trial-averaged laboratory kinematics; this is not a video model.",
            "Features include two future gait-cycle samples, so this is an offline estimator, not causal real-time inference.",
            "The participant bootstrap interval reflects only the small held-out cohort and is not an external-site interval.",
        ],
    }
    (OUTPUT_DIR / "holdout_evaluation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    # Produce a separately named full-data model only after recording the
    # locked test result. It is for later experiments, not the tested artifact.
    full_model = model_specs[selected_name]
    fit_candidate(full_model, selected_name, _feature_subset(X, selected_name), y, groups)
    joblib.dump({
        "model": full_model,
        "feature_names": list(_feature_subset(X, selected_name).columns),
        "target": "vertical GRFy, N/kg",
        "trained_subjects": sorted(set(groups)),
        "model_name": selected_name,
        "training_scope": "all participants; do not use this artifact to claim locked-test performance",
    }, OUTPUT_DIR / "full_data_model.joblib")
    print(f"Selected {selected_name}. Holdout report: {OUTPUT_DIR / 'holdout_evaluation.json'}", flush=True)


if __name__ == "__main__":
    main()

