import sys
import hashlib
from pathlib import Path

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture(autouse=True)
def isolated_live_state_db(request, monkeypatch: pytest.MonkeyPatch):
    """Never let live DTMF tests write to the operator's application data."""

    root = BACKEND_ROOT / ".pytest-live-state"
    root.mkdir(exist_ok=True)
    key = hashlib.sha256(request.node.nodeid.encode("utf-8")).hexdigest()[:20]
    path = root / f"{key}.sqlite3"
    monkeypatch.setenv("K7_LIVE_STATE_DB", str(path))
    yield
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        candidate.unlink(missing_ok=True)
