"""Shared test doubles for perception tests — no model weights involved."""

from __future__ import annotations


class ScriptedDetector:
    """Returns one pre-scripted detection list per `detect()` call,
    ignoring the actual image — a stand-in for a real YOLO model."""

    def __init__(self, sequence):
        self._sequence = list(sequence)
        self._index = 0

    def detect(self, image):
        if self._index >= len(self._sequence):
            return []
        result = self._sequence[self._index]
        self._index += 1
        return result
