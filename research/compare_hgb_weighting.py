"""Paired locked-cohort comparison of ordinary and participant-balanced HGB."""

from __future__ import annotations

import json

import numpy as np
from sklearn.base import clone
from sklearn.metrics import mean_absolute_error

from train_grf_model import OUTPUT_DIR, build_samples
from validate_models import TEST_SUBJECTS, _feature_subset, candidates, fit_candidate, score


def main() -> None:
    X, y, groups, _, _ = build_samples()
    test_mask = np.isin(groups, list(TEST_SUBJECTS))
    if set(np.unique(groups[test_mask])) != TEST_SUBJECTS:
        raise RuntimeError("Locked test participants do not match the expected cohort.")

    X_dev, y_dev, g_dev = X.loc[~test_mask].reset_index(drop=True), y[~test_mask], groups[~test_mask]
    X_test, y_test, g_test = X.loc[test_mask].reset_index(drop=True), y[test_mask], groups[test_mask]
    prototypes = candidates()
    reports = {}
    subject_mae = {}

    for name in ("hist_gradient_boosting_wide", "hist_gradient_boosting_subject_balanced"):
        model = clone(prototypes[name])
        fit_candidate(model, name, _feature_subset(X_dev, name), y_dev, g_dev)
        predictions = model.predict(_feature_subset(X_test, name))
        reports[name] = score(y_test, predictions, g_test)
        subject_mae[name] = {
            subject: float(mean_absolute_error(y_test[g_test == subject], predictions[g_test == subject]))
            for subject in sorted(TEST_SUBJECTS)
        }

    differences = np.asarray([
        subject_mae["hist_gradient_boosting_subject_balanced"][subject]
        - subject_mae["hist_gradient_boosting_wide"][subject]
        for subject in sorted(TEST_SUBJECTS)
    ])
    rng = np.random.default_rng(42)
    draws = rng.choice(differences, size=(20000, len(differences)), replace=True).mean(axis=1)
    report = {
        "purpose": "Paired comparison of predeclared training-weighting strategies; not used to choose the model.",
        "locked_test_subjects": sorted(TEST_SUBJECTS),
        "development_subject_count": int(len(np.unique(g_dev))),
        "locked_test_sample_count": int(len(y_test)),
        "configuration": {
            "estimator": "HistGradientBoostingRegressor",
            "learning_rate": 0.05,
            "max_iter": 200,
            "max_leaf_nodes": 31,
            "l2_regularization": 1.0,
            "random_state": 42,
        },
        "locked_test": reports,
        "subject_mae": subject_mae,
        "paired_mean_subject_mae_difference_n_per_kg": float(differences.mean()),
        "paired_difference_bootstrap_95pct_ci_n_per_kg": [
            float(np.quantile(draws, 0.025)), float(np.quantile(draws, 0.975)),
        ],
        "difference_sign": "balanced minus unweighted; negative favors participant-balanced training",
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "weighting_comparison.json"
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Saved paired comparison to {output_path}")


if __name__ == "__main__":
    main()
