"""Build report.html for a training run: an interactive picture of how the
model was trained and tested (data, who trains / validates / tests in each
fold, training curves, scores against baselines, single check-ins).

train.py calls this at the end of every run. To rebuild a run's page:
  .venv/bin/python visualize.py runs/<time>-<data>

The page is one self-contained file that opens offline: the run's numbers are
embedded as JSON into report_template.html.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from model import STATES
from preprocess import FEATURE_NAMES, Scaler

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "report_template.html"
PLACEHOLDER = "__REPORT_DATA__"
EXAMPLES_PER_GROUP = 3  # check-ins shown per (reported state × right / wrong prediction)


def pick_examples(y: np.ndarray, pred: np.ndarray, seed: int = 0) -> list[int]:
    """A few right and a few wrong test predictions for every reported state."""
    rng = np.random.default_rng(seed)
    picked: list[int] = []
    for state in range(len(STATES)):
        for right in (True, False):
            idx = np.flatnonzero((y == state) & ((pred == y) == right))
            n = min(EXAMPLES_PER_GROUP, len(idx))
            if n:
                picked.extend(sorted(rng.choice(idx, size=n, replace=False).tolist()))
    return picked


def rounded(a: np.ndarray, digits: int) -> list:
    return np.asarray(a, dtype=np.float64).round(digits).tolist()


def build_payload(run_dir: Path) -> dict[str, object]:
    metrics = json.loads((run_dir / "metrics.json").read_text())
    cv = metrics["cross_validation"]
    if "fold_details" not in cv or not (run_dir / "cv_predictions.npz").exists():
        raise SystemExit(f"{run_dir.name} was trained before report.html existed: run train.py again to get one")
    data = np.load(run_dir / "dataset.npz")
    predictions = np.load(run_dir / "cv_predictions.npz")
    X, y, groups, blocks = data["X"], data["y"], data["groups"], data["blocks"]
    probs, test_fold, pred = predictions["lstm_probs"], predictions["test_fold"], predictions["pred_lstm"]
    # For colouring only: each window compared with the average training window.
    Z = Scaler.load(run_dir / "scaler.json").transform(X)

    participants = [
        {"id": pid, "examples": int((groups == pid).sum()), "test_fold": int(test_fold[groups == pid][0])}
        for pid in sorted(set(groups.tolist()))
    ]
    examples = [
        {
            "n": i + 1,
            "participant": str(groups[i]),
            "block": str(blocks[i]),
            "fold": int(test_fold[i]),
            "said": STATES[int(y[i])],
            "predicted": STATES[int(pred[i])],
            "probs": rounded(probs[i], 4),
            "raw": rounded(X[i], 3),
            "z": rounded(Z[i], 2),
        }
        for i in pick_examples(y, pred)
    ]
    return {
        "run": run_dir.name,
        "data": metrics["data"],
        "seed": metrics["seed"],
        "settings": metrics["settings"],
        "states": STATES,
        "features": list(FEATURE_NAMES),
        "dataset": metrics["dataset"],
        "participants": participants,
        "cv": {key: cv[key] for key in ("folds", "models", "lstm_confusion", "lstm_per_class", "fold_details")},
        "final": metrics["final"],
        "examples": examples,
    }


def write_html(run_dir: Path) -> Path:
    payload = json.dumps(build_payload(run_dir), separators=(",", ":")).replace("</", "<\\/")
    template = TEMPLATE.read_text()
    if template.count(PLACEHOLDER) != 1:
        raise RuntimeError(f"{TEMPLATE.name} must contain {PLACEHOLDER} exactly once")
    out = run_dir / "report.html"
    out.write_text(template.replace(PLACEHOLDER, payload))
    return out


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: .venv/bin/python visualize.py runs/<time>-<data>")
    run = Path(sys.argv[1]).expanduser()
    if not run.is_absolute() and not run.exists():
        run = ROOT / run
    print(write_html(run.resolve()))
