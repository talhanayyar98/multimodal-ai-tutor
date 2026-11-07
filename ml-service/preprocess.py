"""Feature preprocessing shared by training (train.py) and inference (main.py).

The raw 13 features live on very different scales (eye openness 0–1, mouse
travel in hundreds of pixels), so before the LSTM sees them:
  1. pixel / count features get log1p (they are heavy-tailed), then
  2. every feature is standardized with the training set's mean and std.
The fitted mean/std are saved next to the model weights (scaler.json), and
inference must apply exactly the same transform.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from model import FEATURE_DIM

# Must match FEATURE_ORDER in frontend/lib/features.ts.
FEATURE_NAMES: tuple[str, ...] = (
    "facePresence",
    "avgEyeOpenness",
    "blinkRate",
    "gazeDispersion",
    "gazeLeftX",
    "gazeLeftY",
    "gazeRightX",
    "gazeRightY",
    "headMovement",
    "mouseTravel",
    "mouseSpeedMean",
    "clickCount",
    "idleRatio",
)
assert len(FEATURE_NAMES) == FEATURE_DIM

LOG1P_FEATURES: tuple[str, ...] = ("mouseTravel", "mouseSpeedMean", "clickCount")
_LOG1P_IDX = [FEATURE_NAMES.index(name) for name in LOG1P_FEATURES]


def log_features(x: np.ndarray) -> np.ndarray:
    """log1p on the pixel/count columns of a (..., FEATURE_DIM) array (returns a copy)."""
    out = np.array(x, dtype=np.float32, copy=True)
    out[..., _LOG1P_IDX] = np.log1p(np.clip(out[..., _LOG1P_IDX], 0, None))
    return out


@dataclass
class Scaler:
    mean: np.ndarray  # (FEATURE_DIM,)
    std: np.ndarray  # (FEATURE_DIM,)

    @classmethod
    def fit(cls, x: np.ndarray) -> "Scaler":
        flat = log_features(x).reshape(-1, FEATURE_DIM)
        std = flat.std(axis=0)
        std[std < 1e-6] = 1.0  # a constant feature stays at 0 instead of dividing by ~0
        return cls(mean=flat.mean(axis=0), std=std)

    def transform(self, x: np.ndarray) -> np.ndarray:
        return ((log_features(x) - self.mean) / self.std).astype(np.float32)

    def save(self, path: Path, **extra: object) -> None:
        data = {
            "feature_names": list(FEATURE_NAMES),
            "log1p_features": list(LOG1P_FEATURES),
            "mean": [float(v) for v in self.mean],
            "std": [float(v) for v in self.std],
            **extra,
        }
        path.write_text(json.dumps(data, indent=2) + "\n")

    @classmethod
    def load(cls, path: Path) -> "Scaler":
        data = json.loads(Path(path).read_text())
        if data.get("feature_names") != list(FEATURE_NAMES):
            raise ValueError(f"{path}: feature order differs from preprocess.FEATURE_NAMES")
        if data.get("log1p_features") != list(LOG1P_FEATURES):
            raise ValueError(f"{path}: log1p features differ from preprocess.LOG1P_FEATURES")
        return cls(mean=np.array(data["mean"], dtype=np.float32), std=np.array(data["std"], dtype=np.float32))
