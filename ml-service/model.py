"""LSTM for cognitive-state classification.

The architecture is shared by training (train.py) and the service. Trained
weights are always loaded together with their preprocessing (predictor.py);
untrained_model() is the stand-in used before any model is trained.
"""

from __future__ import annotations

import torch
from torch import nn

# Must match FEATURE_ORDER in frontend/lib/features.ts (and the backend's FEATURE_DIM).
FEATURE_DIM = 13
HIDDEN_SIZE = 64
NUM_LAYERS = 1
STATES = ["engaged", "confused", "bored", "frustrated"]


class CognitiveStateLSTM(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=FEATURE_DIM,
            hidden_size=HIDDEN_SIZE,
            num_layers=NUM_LAYERS,
            batch_first=True,
        )
        self.head = nn.Linear(HIDDEN_SIZE, len(STATES))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, FEATURE_DIM) -> logits: (batch, len(STATES))
        out, _ = self.lstm(x)
        return self.head(out[:, -1, :])


def untrained_model() -> CognitiveStateLSTM:
    """Fixed random weights (seed 0): runs end to end, but its states are not meaningful."""
    torch.manual_seed(0)  # deterministic placeholder predictions across restarts
    model = CognitiveStateLSTM()
    print("[model] MODEL_RUN not set — using the untrained placeholder (its states are not meaningful)")
    model.eval()
    return model
