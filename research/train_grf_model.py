"""Train subject-independent baselines for gait-cycle vertical GRF prediction."""

from __future__ import annotations

import json
import re
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "storage" / "datasets" / "fukuchi2017"
OUTPUT_DIR = ROOT / "storage" / "results" / "grf_model"
SIDES = ("R", "L")
JOINTS = ("hip", "knee", "ankle")
AXES = ("X", "Y", "Z")
LAGS = (-2, -1, 0, 1, 2)
SPEED_SUFFIXES = {"25": 2.5, "35": 3.5, "45": 4.5}


def build_samples() -> tuple[pd.DataFrame, np.ndarray, np.ndarray, list[str], dict]:
    rows: list[np.ndarray] = []
    targets: list[float] = []
    groups: list[str] = []
    qc = {"source_trials": 0, "force_rows_outside_50_N_per_kg": 0, "usable_source_trials": 0}
    feature_names = [
        f"{joint}Ang{axis}_lag{lag:+d}"
        for joint in JOINTS for axis in AXES for lag in LAGS
    ] + ["speed_m_s", "gait_phase", "side_is_left"]

    files = sorted(DATA_DIR.glob("RBDS*processed.txt"))
    if not files:
        raise FileNotFoundError(f"No processed tables found in {DATA_DIR}. Run research/download_dataset.py first.")

    subjects_used: set[str] = set()
    for file in files:
        match = re.fullmatch(r"RBDS(\d{3})processed\.txt", file.name)
        if not match:
            continue
        subject = match.group(1)
        table = pd.read_csv(file, sep="\t")
        if "PercGcycle" not in table.columns:
            print(f"skip {file.name}: missing PercGcycle")
            continue
        for suffix, speed in SPEED_SUFFIXES.items():
            for side in SIDES:
                required = [f"{side}{joint}Ang{axis}{suffix}" for joint in JOINTS for axis in AXES]
                # The source table's vertical GRF component is Y, not Z.
                # The source paper reports GRF normalized by body mass (N/kg).
                target_column = f"{side}grfY{suffix}"
                if target_column not in table or not all(column in table for column in required):
                    continue
                qc["source_trials"] += 1
                frame = table[required + [target_column, "PercGcycle"]].apply(pd.to_numeric, errors="coerce")
                numeric = frame.to_numpy(dtype=np.float64)
                force_values = frame[target_column].to_numpy(dtype=np.float64)
                plausible_force = np.abs(force_values) <= 50.0
                predictor_values = frame[required + ["PercGcycle"]].to_numpy(dtype=np.float64)
                predictor_valid = np.isfinite(predictor_values).all(axis=1)
                target_valid = np.isfinite(force_values) & plausible_force
                qc["force_rows_outside_50_N_per_kg"] += int(
                    np.sum(predictor_valid & np.isfinite(force_values) & ~plausible_force)
                )
                if int(np.sum(predictor_valid & target_valid)) < 10:
                    continue
                angles = predictor_values[:, :-1].astype(np.float32)
                phase = (predictor_values[:, -1] / 100.0).astype(np.float32)
                valid_trial_samples = 0
                # Build windows on original table row positions. Invalid target rows
                # are masked only after feature construction so windows never bridge
                # a removed force sample and pretend separated gait points are adjacent.
                for i in range(len(predictor_values)):
                    if not target_valid[i] or not predictor_valid[i]:
                        continue
                    neighbor_indices = [min(max(i + lag, 0), len(predictor_values) - 1) for lag in LAGS]
                    if not all(predictor_valid[j] for j in neighbor_indices):
                        continue
                    x: list[float] = []
                    for j in range(len(required)):
                        for lag in LAGS:
                            neighbor = min(max(i + lag, 0), len(predictor_values) - 1)
                            x.append(float(angles[neighbor, j]))
                    x.extend((speed, float(phase[i]), float(side == "L")))
                    rows.append(np.asarray(x, dtype=np.float32))
                    targets.append(float(force_values[i]))
                    groups.append(subject)
                    valid_trial_samples += 1
                if valid_trial_samples:
                    qc["usable_source_trials"] += 1
                subjects_used.add(subject)

    if len(subjects_used) < 5:
        raise RuntimeError(f"Only {len(subjects_used)} usable subjects found; at least 5 are needed for grouped CV.")
    X = np.stack(rows)
    y = np.asarray(targets, dtype=np.float32)
    group_array = np.asarray(groups)
    qc["subjects"] = len(subjects_used)
    qc["samples_after_qc"] = len(y)
    return pd.DataFrame(X, columns=feature_names), y, group_array, feature_names, qc


def metric_report(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "r2": float(r2_score(y_true, y_pred)),
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    X, y, groups, feature_names, qc = build_samples()
    n_groups = len(np.unique(groups))
    cv = GroupKFold(n_splits=min(5, n_groups))
    models = {
        "ridge_baseline": make_pipeline(StandardScaler(), Ridge(alpha=10.0)),
        "extra_trees": ExtraTreesRegressor(
            n_estimators=300, min_samples_leaf=2, max_features=0.8,
            n_jobs=-1, random_state=42,
        ),
    }

    reports: dict[str, dict[str, float]] = {}
    for name, model in models.items():
        predictions = cross_val_predict(model, X, y, groups=groups, cv=cv, n_jobs=1)
        reports[name] = metric_report(y, predictions)
        print(f"{name}: {reports[name]}")

    # Declare the nonlinear model as primary before evaluation; Ridge is the
    # reference baseline. Do not choose the reported model by its CV test score.
    winner = "extra_trees"
    final_model = models[winner].fit(X, y)
    joblib.dump({
        "model": final_model,
        "feature_names": feature_names,
        "target": "published vertical GRF (GRFy), normalized by participant body mass (N/kg)",
        "input_domain": "laboratory-derived joint angles, gait phase, side, and speed",
        "selected_by": "pre-specified primary model; Ridge is the reference baseline",
        "random_state": 42,
    }, OUTPUT_DIR / "model.joblib")

    summary = {
        "task": "predict vertical ground-reaction force from lower-limb kinematics",
        "source": "Fukuchi et al. 2017, Figshare DOI 10.6084/m9.figshare.4543435.v5",
        "license": "CC BY 4.0",
        "split": f"{min(5, n_groups)}-fold GroupKFold; participant IDs are the groups",
        "subjects": n_groups,
        "samples": int(len(y)),
        "target_summary_n_per_kg": {
            "min": float(np.min(y)), "median": float(np.median(y)), "max": float(np.max(y)),
        },
        "data_quality": qc,
        "features": feature_names,
        "target_units": "N/kg (the source paper states GRF was normalized by participant body mass)",
        "models_oof": reports,
        "primary_model": winner,
        "model_selection": "pre-specified ExtraTrees primary; Ridge baseline reported for comparison",
        "caveat": "The model was evaluated on laboratory-derived angles. It is not validated on monocular video or MediaPipe outputs.",
    }
    (OUTPUT_DIR / "evaluation.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k not in {"features"}}, indent=2))
    print(f"Saved model and evaluation to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

