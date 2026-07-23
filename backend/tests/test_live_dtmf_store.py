from app.live_dtmf_store import LiveDtmfEvent, read_dtmf_events, save_dtmf_event


def test_live_dtmf_store_orders_generations_and_updates_idempotently() -> None:
    save_dtmf_event(LiveDtmfEvent("demo-call", 2, 2, "#", "active", 2_000))
    save_dtmf_event(LiveDtmfEvent("demo-call", 2, 1, "4", "active", 1_000))
    save_dtmf_event(LiveDtmfEvent("demo-call", 1, 1, "9", "intake", 500))
    save_dtmf_event(LiveDtmfEvent("demo-call", 2, 1, "5", "active", 1_100))

    events = read_dtmf_events("demo-call", 2)

    assert [(event.seq, event.digit, event.captured_at_ms) for event in events] == [
        (1, "5", 1_100),
        (2, "#", 2_000),
    ]


def test_live_dtmf_store_rejects_invalid_digit() -> None:
    try:
        save_dtmf_event(LiveDtmfEvent("demo-call", 1, 1, "A", "active", 1))
    except ValueError as exc:
        assert "single DTMF" in str(exc)
    else:  # pragma: no cover - makes a missing guard explicit
        raise AssertionError("invalid DTMF digit was accepted")
