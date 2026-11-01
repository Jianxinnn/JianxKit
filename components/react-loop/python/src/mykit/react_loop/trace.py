"""Adapted from BioMolHarness baseline/agent/trace.py."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol


class Trace(Protocol):
    def write(self, event_type: str, payload: dict[str, Any]) -> None:
        ...


class NullTrace:
    def write(self, event_type: str, payload: dict[str, Any]) -> None:
        pass


class JsonlTraceWriter:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._handle = None

    def __enter__(self) -> "JsonlTraceWriter":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._handle = self.path.open("w", encoding="utf-8")
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self._handle is not None:
            self._handle.close()
            self._handle = None

    def write(self, event_type: str, payload: dict[str, Any]) -> None:
        if self._handle is None:
            raise RuntimeError("trace writer is not open")
        self._handle.write(
            json.dumps(
                {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "event_type": event_type,
                    "payload": payload,
                },
                sort_keys=True,
                default=str,
            )
            + "\n"
        )
        self._handle.flush()
