"""Durable local store for live-call DTMF events.

The active MVP PostgreSQL contract intentionally remains the original three
tables and requires UUID call ids.  LAN live calls use human-readable call ids,
so their keypad journal lives in a small sidecar SQLite database instead of
weakening that contract.  The file stays on the on-premises server and is not
served by a public endpoint.
"""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LiveDtmfEvent:
    call_id: str
    generation: int
    seq: int
    digit: str
    phase: str
    captured_at_ms: int


def _database_path() -> Path:
    configured = os.getenv("K7_LIVE_STATE_DB", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    local_app_data = os.getenv("LOCALAPPDATA", "").strip()
    root = Path(local_app_data) if local_app_data else Path.cwd() / ".k7-live"
    return root / "K7" / "live-state.sqlite3"


def _connect() -> sqlite3.Connection:
    path = _database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=5000")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS live_dtmf_events (
            call_id TEXT NOT NULL,
            generation INTEGER NOT NULL CHECK (generation >= 1),
            seq INTEGER NOT NULL CHECK (seq >= 1),
            digit TEXT NOT NULL CHECK (digit IN ('0','1','2','3','4','5','6','7','8','9','*','#')),
            phase TEXT NOT NULL CHECK (phase IN ('intake','waiting_for_agent','active')),
            captured_at_ms INTEGER NOT NULL CHECK (captured_at_ms >= 1),
            PRIMARY KEY (call_id, generation, seq)
        )
        """
    )
    return connection


def save_dtmf_event(event: LiveDtmfEvent) -> None:
    """Idempotently persist one accepted keypad event."""

    if event.digit not in "0123456789*#" or len(event.digit) != 1:
        raise ValueError("digit must be a single DTMF character")
    if event.phase not in {"intake", "waiting_for_agent", "active"}:
        raise ValueError("invalid DTMF phase")
    connection = _connect()
    try:
        connection.execute(
            """
            INSERT INTO live_dtmf_events (
                call_id, generation, seq, digit, phase, captured_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (call_id, generation, seq) DO UPDATE SET
                digit = excluded.digit,
                phase = excluded.phase,
                captured_at_ms = excluded.captured_at_ms
            """,
            (
                event.call_id,
                event.generation,
                event.seq,
                event.digit,
                event.phase,
                event.captured_at_ms,
            ),
        )
        connection.commit()
    finally:
        connection.close()


def read_dtmf_events(call_id: str, generation: int) -> list[LiveDtmfEvent]:
    """Internal/test accessor; raw keypad values are not exposed over HTTP."""

    connection = _connect()
    try:
        rows = connection.execute(
            """
            SELECT call_id, generation, seq, digit, phase, captured_at_ms
            FROM live_dtmf_events
            WHERE call_id = ? AND generation = ?
            ORDER BY seq
            """,
            (call_id, generation),
        ).fetchall()
    finally:
        connection.close()
    return [LiveDtmfEvent(*row) for row in rows]
