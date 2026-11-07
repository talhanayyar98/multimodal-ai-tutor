"""The model the service runs: a trained run from train.py, or the untrained placeholder.

A trained run is a directory (runs/<time>-<data>/) holding model.pt and
scaler.json. The service only ever loads the two together, so a trained model
can never see unscaled features. Select it with MODEL_RUN, in the environment
or in ml-service/.env (relative paths are inside ml-service/):

  MODEL_RUN=runs/20261107-182554-synthetic

Anything that doesn't match this code — missing files, a different feature
order, states or layer shapes — stops the service at startup instead of
serving wrong predictions.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

from model import STATES, CognitiveStateLSTM, untrained_model
from preprocess import Scaler

ROOT = Path(__file__).resolve().parent


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip("'\"")
    return values


def configured_run() -> Path | None:
    """MODEL_RUN from the environment, else from ml-service/.env; None = untrained placeholder."""
    if os.environ.get("MODEL_WEIGHTS"):
        raise RuntimeError(
            "MODEL_WEIGHTS is no longer used: set MODEL_RUN to a training run directory "
            "(e.g. runs/20261107-182554-synthetic), which holds model.pt and scaler.json"
        )
    value = os.environ.get("MODEL_RUN") or read_env_file(ROOT / ".env").get("MODEL_RUN")
    if not value:
        return None
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT / path


@dataclass(frozen=True)
class ModelInfo:
    name: str  # the run directory's name, or "untrained"
    data: str | None  # "synthetic" or "real" (what it was trained on); None if untrained
    trained: bool


class Predictor:
    def __init__(self, run_dir: Path | None) -> None:
        if run_dir is None:
            self.model = untrained_model()
            self.scaler: Scaler | None = None
            self.seq_len: int | None = None
            self.info = ModelInfo(name="untrained", data=None, trained=False)
            return

        weights, scaler_path = run_dir / "model.pt", run_dir / "scaler.json"
        missing = [p.name for p in (weights, scaler_path) if not p.exists()]
        if missing:
            raise FileNotFoundError(f"MODEL_RUN={run_dir}: missing {', '.join(missing)}")
        meta = json.loads(scaler_path.read_text())
        if meta.get("states") != STATES:
            raise ValueError(f"{scaler_path}: states {meta.get('states')} differ from model.STATES {STATES}")
        self.scaler = Scaler.load(scaler_path)  # also checks feature order and log1p columns
        self.seq_len = int(meta["seq_len"])
        model = CognitiveStateLSTM()
        # strict=True (the default): every layer shape must match the architecture.
        model.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
        model.eval()
        self.model = model
        self.info = ModelInfo(name=run_dir.name, data=meta.get("data"), trained=True)
        print(f"[model] loaded trained run {run_dir.name} ({self.info.data} data)")

    def predict(self, features: list[list[float]]) -> tuple[str, dict[str, float]]:
        """features: (n_windows, FEATURE_DIM), oldest first. Returns (state, probabilities)."""
        x = np.asarray(features, dtype=np.float32)
        if self.scaler is not None and self.seq_len is not None:
            # Same preprocessing as training, on at most the last seq_len windows.
            x = self.scaler.transform(x[-self.seq_len :])
        with torch.no_grad():
            logits = self.model(torch.from_numpy(x).unsqueeze(0))
            probs = torch.softmax(logits, dim=-1).squeeze(0)
        top = int(probs.argmax().item())
        return STATES[top], {state: round(float(p), 4) for state, p in zip(STATES, probs.tolist())}
