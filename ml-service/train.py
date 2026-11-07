"""Train the cognitive-state LSTM on /collect check-ins.

One training example = one check-in answer (the label) plus the 12 signal
windows — one minute, 12 × 13 features — that ended before the pop-up
appeared, so answering the pop-up never leaks into its own input.

  1. Load the participants' sessions, signal windows and check-ins from MongoDB.
  2. Build the examples ("neutral" answers are dropped: the model has 4 states).
  3. Evaluate with 5-fold cross-validation split by PARTICIPANT (the model is
     always tested on people it never saw), against simple baselines.
  4. Train the final model on everyone and save it to runs/<time>-<data>/:
     model.pt (weights), scaler.json (preprocessing), metrics.json,
     report.md and dataset.npz (the exact examples, for reproducibility).

Usage, from ml-service/:
  .venv/bin/python train.py --data synthetic   # generated T-participants: pipeline test only
  .venv/bin/python train.py                    # real participants (P-codes) — the default
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from pymongo import MongoClient
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.model_selection import GroupShuffleSplit, StratifiedGroupKFold
from torch import nn

from model import FEATURE_DIM, STATES, CognitiveStateLSTM
from preprocess import Scaler

SEQ_LEN = 12  # = MAX_RECENT_WINDOWS in backend/src/store.ts: one minute of 5-s windows
MAX_GAP_MS = 10_000  # the newest window must end at most 10 s before the pop-up
MAX_SPAN_MS = 75_000  # the 12 windows must be (nearly) back to back
LABELS = list(range(len(STATES)))
ROOT = Path(__file__).resolve().parent

# ---------- data ----------


def mongo_uri(cli_value: str | None) -> str:
    """--mongo-uri, else $MONGODB_URI, else backend/.env, else the local default."""
    if cli_value:
        return cli_value
    if os.environ.get("MONGODB_URI"):
        return os.environ["MONGODB_URI"]
    env_file = ROOT.parent / "backend" / ".env"
    if env_file.exists():
        match = re.search(r"^MONGODB_URI=(.+)$", env_file.read_text(), re.MULTILINE)
        if match:
            return match.group(1).strip()
    return "mongodb://127.0.0.1:27017/adaptive-tutor"


def load_examples(uri: str, data: str) -> tuple[dict[str, np.ndarray], dict[str, object]]:
    db = MongoClient(uri, serverSelectionTimeoutMS=3000).get_default_database()
    if data == "synthetic":
        who = {"synthetic": True}
    else:  # real participants only: no generated data, no researcher test runs
        who = {"synthetic": {"$ne": True}, "isTest": {"$ne": True}}
    participants = [p["participantId"] for p in db.participants.find(who, {"participantId": 1})]
    session_owner = {
        s["sessionId"]: s["participantId"]
        for s in db.sessions.find({"participantId": {"$in": participants}, "mode": "pilot"})
    }

    windows: dict[str, list[tuple[float, list[float]]]] = defaultdict(list)
    for w in db.signalbatches.find(
        {"sessionId": {"$in": list(session_owner)}}, {"sessionId": 1, "windowEnd": 1, "vector": 1}
    ):
        if isinstance(w.get("windowEnd"), (int, float)) and len(w.get("vector") or []) == FEATURE_DIM:
            windows[w["sessionId"]].append((w["windowEnd"], w["vector"]))
    for rows in windows.values():
        rows.sort(key=lambda row: row[0])
    window_ends = {sid: [end for end, _ in rows] for sid, rows in windows.items()}

    X, y, groups, blocks = [], [], [], []
    skipped: Counter[str] = Counter()
    for report in db.selfreports.find({"sessionId": {"$in": list(session_owner)}}):
        state = report["state"]
        if state not in STATES:
            skipped[f"'{state}' answer (not a model state)"] += 1
            continue
        sid = report["sessionId"]
        prompted = report["promptedAt"]
        n_before = bisect_right(window_ends.get(sid, []), prompted)  # windows ending before the pop-up
        if n_before < SEQ_LEN:
            skipped["fewer than 12 windows before it"] += 1
            continue
        seq = windows[sid][n_before - SEQ_LEN : n_before]
        if prompted - seq[-1][0] > MAX_GAP_MS or seq[-1][0] - seq[0][0] > MAX_SPAN_MS:
            skipped["gap in the signal windows"] += 1
            continue
        X.append([vector for _, vector in seq])
        y.append(STATES.index(state))
        groups.append(session_owner[sid])
        blocks.append(report.get("blockId") or "between-parts")

    arrays = {
        "X": np.array(X, dtype=np.float32).reshape(-1, SEQ_LEN, FEATURE_DIM),
        "y": np.array(y, dtype=np.int64),
        "groups": np.array(groups),
        "blocks": np.array(blocks),
    }
    info = {
        "participants_found": len(participants),
        "participants_used": len(set(groups)),
        "examples": len(y),
        "labels": {state: int((arrays["y"] == i).sum()) for i, state in enumerate(STATES)},
        "skipped": dict(skipped),
    }
    return arrays, info


# ---------- models ----------


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def macro_f1(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(f1_score(y_true, y_pred, labels=LABELS, average="macro", zero_division=0))


def predict_lstm(model: nn.Module, X: np.ndarray) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        return model(torch.from_numpy(X)).argmax(dim=1).numpy()


def train_lstm(
    X_fit: np.ndarray,
    y_fit: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    seed: int,
    max_epochs: int = 80,
    patience: int = 10,
) -> tuple[CognitiveStateLSTM, dict[str, float]]:
    """Adam + class-weighted cross-entropy; keeps the epoch with the best validation macro-F1."""
    seed_everything(seed)
    rng = np.random.default_rng(seed)
    model = CognitiveStateLSTM()
    counts = np.bincount(y_fit, minlength=len(STATES)).astype(np.float32)
    class_weights = torch.tensor(len(y_fit) / (len(STATES) * np.maximum(counts, 1)), dtype=torch.float32)
    loss_fn = nn.CrossEntropyLoss(weight=class_weights)  # rare states count as much as common ones
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)
    X_t, y_t = torch.from_numpy(X_fit), torch.from_numpy(y_fit)

    best_f1, best_epoch, best_state, stale = -1.0, 0, None, 0
    for epoch in range(1, max_epochs + 1):
        model.train()
        order = rng.permutation(len(y_fit))
        for start in range(0, len(order), 64):
            batch = torch.from_numpy(order[start : start + 64])
            xb = X_t[batch]
            # Sometimes show only the last 4–11 windows: in the app the first
            # minute of a session has fewer than 12 windows.
            if rng.random() < 0.3:
                xb = xb[:, -int(rng.integers(4, SEQ_LEN)) :]
            loss = loss_fn(model(xb), y_t[batch])
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

        if len(y_val) == 0:  # too few people for a validation split: fixed number of epochs
            best_epoch, best_state = epoch, None
            continue
        val_f1 = macro_f1(y_val, predict_lstm(model, X_val))
        if val_f1 > best_f1 + 1e-4:
            best_f1, best_epoch, stale = val_f1, epoch, 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            stale += 1
            if stale >= patience:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    return model, {"best_epoch": best_epoch, "val_macro_f1": round(best_f1, 4)}


def window_stats(X: np.ndarray) -> np.ndarray:
    """Per-feature mean and std over the minute: input for the logistic-regression baseline."""
    return np.concatenate([X.mean(axis=1), X.std(axis=1)], axis=1)


def split_fit_val(groups: np.ndarray, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Hold out ~15% of the training PEOPLE for early stopping."""
    idx = np.arange(len(groups))
    if len(set(groups)) < 4:
        return idx, idx[:0]
    fit, val = next(GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=seed).split(idx, groups=groups))
    return fit, val


# ---------- evaluation ----------


def cross_validate(d: dict[str, np.ndarray], seed: int, folds: int) -> dict[str, object]:
    X, y, groups, blocks = d["X"], d["y"], d["groups"], d["blocks"]
    n_folds = min(folds, len(set(groups)))
    splitter = StratifiedGroupKFold(n_splits=n_folds, shuffle=True, random_state=seed)
    names = ["majority", "block", "logreg", "lstm"]
    pooled = {name: np.zeros_like(y) for name in names}
    per_fold: dict[str, list[float]] = {name: [] for name in names}
    lstm_epochs = []

    for k, (train, test) in enumerate(splitter.split(X, y, groups)):
        fit_rel, val_rel = split_fit_val(groups[train], seed + k)
        fit, val = train[fit_rel], train[val_rel]
        scaler = Scaler.fit(X[fit])
        Xs = scaler.transform(X)

        majority = Counter(y[train].tolist()).most_common(1)[0][0]
        by_block = {b: Counter(y[train][blocks[train] == b].tolist()).most_common(1)[0][0] for b in set(blocks[train])}
        logreg = LogisticRegression(max_iter=3000, class_weight="balanced").fit(window_stats(Xs[train]), y[train])
        model, info = train_lstm(Xs[fit], y[fit], Xs[val], y[val], seed=seed + k)
        lstm_epochs.append(info["best_epoch"])

        preds = {
            "majority": np.full(len(test), majority),
            "block": np.array([by_block.get(b, majority) for b in blocks[test]]),
            "logreg": logreg.predict(window_stats(Xs[test])),
            "lstm": predict_lstm(model, Xs[test]),
        }
        for name in names:
            pooled[name][test] = preds[name]
            per_fold[name].append(macro_f1(y[test], preds[name]))
        print(f"  fold {k + 1}/{n_folds}: LSTM macro-F1 {per_fold['lstm'][-1]:.3f} (stopped at epoch {info['best_epoch']})")

    results = {}
    for name in names:
        results[name] = {
            "macro_f1_mean": round(float(np.mean(per_fold[name])), 4),
            "macro_f1_sd": round(float(np.std(per_fold[name])), 4),
            "accuracy": round(float(accuracy_score(y, pooled[name])), 4),
        }
    precision, recall, f1, support = precision_recall_fscore_support(
        y, pooled["lstm"], labels=LABELS, zero_division=0
    )
    return {
        "folds": n_folds,
        "models": results,
        "lstm_confusion": confusion_matrix(y, pooled["lstm"], labels=LABELS).tolist(),
        "lstm_per_class": {
            state: {"precision": round(float(precision[i]), 3), "recall": round(float(recall[i]), 3), "f1": round(float(f1[i]), 3), "n": int(support[i])}
            for i, state in enumerate(STATES)
        },
        "lstm_best_epochs": lstm_epochs,
    }


# ---------- report ----------

MODEL_NAMES = {
    "majority": "Always guess the most common state",
    "block": "Guess from which part of the session it is",
    "logreg": "Logistic regression on the minute's averages",
    "lstm": "LSTM (sequence of 12 windows)",
}


def write_report(path: Path, data: str, info: dict, cv: dict, final: dict) -> str:
    lines = [f"# Training report: {data} data, {datetime.now():%Y-%m-%d %H:%M}", ""]
    if data == "synthetic":
        lines += [
            "> **Synthetic data.** These numbers describe the mock-data generator, not real",
            "> learners. Use this run only to check that the pipeline works.",
            "",
        ]
    labels = ", ".join(f"{s} {n}" for s, n in info["labels"].items())
    skipped = ", ".join(f"{reason}: {n}" for reason, n in info["skipped"].items()) or "none"
    lines += [
        "## Data",
        "",
        f"- {info['participants_used']} participants, {info['examples']} examples "
        f"(each: the {SEQ_LEN} windows × {FEATURE_DIM} features before one check-in)",
        f"- Labels: {labels}",
        f"- Check-ins left out: {skipped}",
        "",
        f"## Cross-validation ({cv['folds']} folds, split by participant)",
        "",
        "Every model is tested on people it never saw during training. Macro-F1",
        "averages the F1 score of the four states, so each state counts equally.",
        "",
        "| Model | Macro-F1 (mean ± sd) | Accuracy |",
        "|---|---|---|",
    ]
    for key, label in MODEL_NAMES.items():
        r = cv["models"][key]
        lines.append(f"| {label} | {r['macro_f1_mean']:.3f} ± {r['macro_f1_sd']:.3f} | {r['accuracy']:.1%} |")
    lines += [
        "",
        "### LSTM confusion matrix (all folds)",
        "",
        "Rows: what the person reported. Columns: what the model predicted.",
        "",
        "| reported \\ predicted | " + " | ".join(STATES) + " |",
        "|---|" + "---|" * len(STATES),
    ]
    for state, row in zip(STATES, cv["lstm_confusion"]):
        lines.append(f"| **{state}** | " + " | ".join(str(v) for v in row) + " |")
    lines += ["", "### LSTM per state", "", "| State | Precision | Recall | F1 | n |", "|---|---|---|---|---|"]
    for state, r in cv["lstm_per_class"].items():
        lines.append(f"| {state} | {r['precision']:.2f} | {r['recall']:.2f} | {r['f1']:.2f} | {r['n']} |")
    lines += [
        "",
        "## Final model",
        "",
        f"Trained on {final['fit_participants']} participants, with {final['val_participants']} held out "
        f"for early stopping (best epoch {final['best_epoch']}, validation macro-F1 {final['val_macro_f1']:.3f}).",
        "Files: `model.pt` (weights), `scaler.json` (preprocessing), `metrics.json`, `dataset.npz`.",
        "",
    ]
    text = "\n".join(lines)
    path.write_text(text)
    return text


# ---------- main ----------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", choices=["real", "synthetic"], default="real")
    parser.add_argument("--mongo-uri")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--out", type=Path, default=ROOT / "runs")
    args = parser.parse_args()
    seed_everything(args.seed)
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))

    uri = mongo_uri(args.mongo_uri)
    print(f"[train] loading {args.data} participants from {uri.split('@')[-1]}")
    data, info = load_examples(uri, args.data)
    print(f"[train] {info['participants_used']} participants, {info['examples']} examples, labels {info['labels']}")
    if info["skipped"]:
        print(f"[train] left out: {info['skipped']}")
    if info["participants_used"] < 3 or min(info["labels"].values()) == 0:
        hint = " (no real participants yet — try --data synthetic to test the pipeline)" if args.data == "real" else ""
        raise SystemExit(f"[train] not enough data to train: need ≥3 participants and every state present{hint}")

    print(f"[train] cross-validating ({args.folds} folds, by participant)…")
    cv = cross_validate(data, args.seed, args.folds)

    print("[train] training the final model on all participants…")
    fit, val = split_fit_val(data["groups"], args.seed)
    scaler = Scaler.fit(data["X"][fit])
    Xs = scaler.transform(data["X"])
    model, final_info = train_lstm(Xs[fit], data["y"][fit], Xs[val], data["y"][val], seed=args.seed)

    run_dir = args.out / f"{datetime.now():%Y%m%d-%H%M%S}-{args.data}"
    run_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), run_dir / "model.pt")
    scaler.save(run_dir / "scaler.json", seq_len=SEQ_LEN, states=STATES, data=args.data)
    np.savez_compressed(run_dir / "dataset.npz", **data)
    final = {
        **final_info,
        "fit_participants": len(set(data["groups"][fit])),
        "val_participants": len(set(data["groups"][val])),
    }
    (run_dir / "metrics.json").write_text(
        json.dumps({"data": args.data, "seed": args.seed, "dataset": info, "cross_validation": cv, "final": final}, indent=2)
        + "\n"
    )
    report = write_report(run_dir / "report.md", args.data, info, cv, final)
    print("\n" + report)
    print(f"[train] saved to {run_dir.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
