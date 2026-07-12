"""Placeholder LSTM for cognitive-state classification.

The architecture (input/output shapes) is final; the weights are untrained.
To swap in the real model, save its state dict with `torch.save(model.state_dict(), path)`
and point the MODEL_WEIGHTS environment variable at that file.
"""

from __future__ import annotations

import os

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


def load_model(weights_path: str | None = None) -> CognitiveStateLSTM:
    torch.manual_seed(0)  # deterministic placeholder predictions across restarts
    model = CognitiveStateLSTM()
    if weights_path:
        if not os.path.exists(weights_path):
            raise FileNotFoundError(f"MODEL_WEIGHTS points to a missing file: {weights_path}")
        model.load_state_dict(torch.load(weights_path, map_location="cpu"))
        print(f"[model] loaded trained weights from {weights_path}")
    else:
        print("[model] MODEL_WEIGHTS not set — using untrained placeholder weights")
    model.eval()
    return model
