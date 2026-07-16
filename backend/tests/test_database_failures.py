import json
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest

from app.config import Settings
from app.contracts import MvpCallResponse
from app.database import (
    DatabaseUnavailable,
    get_call,
    initialize_database,
    save_call,
)


ROOT = Path(__file__).resolve().parents[2]


def _response() -> MvpCallResponse:
    payload = json.loads(
        (ROOT / "database/contracts/examples/mvp_call_response.example.json").read_text(
            encoding="utf-8"
        )
    )
    return MvpCallResponse.model_validate(payload)


def _fail_connect(*_args, **_kwargs):
    raise psycopg.OperationalError("test database is offline")


@pytest.mark.parametrize(
    ("operation", "message"),
    [
        (lambda settings: initialize_database(settings), "schema initialization"),
        (lambda settings: save_call(settings, _response(), {}), "call save"),
        (lambda settings: get_call(settings, uuid4()), "call lookup"),
    ],
)
def test_database_driver_errors_become_safe_service_errors(
    monkeypatch: pytest.MonkeyPatch, operation, message: str
) -> None:
    monkeypatch.setattr("app.database.psycopg.connect", _fail_connect)
    settings = Settings(database_url="postgresql://test.invalid/k7")

    with pytest.raises(DatabaseUnavailable, match=message):
        operation(settings)
