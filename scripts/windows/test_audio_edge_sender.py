from __future__ import annotations

import argparse
import asyncio
import struct
import unittest

from audio_edge_sender import (
    AudioBlock,
    AudioBlockQueue,
    AudioGate,
    FRAME_HEADER_BYTES,
    InputDevice,
    SenderConfig,
    SenderConfigurationError,
    block_frames,
    build_audio_frame,
    build_audio_websocket_url,
    make_config,
    _policy_rejection,
    select_input_device,
    validate_call_id,
    validate_sender_id,
)


DEVICES = [
    InputDevice(2, "Microphone Array (Realtek Audio)", 2, 48_000, "WASAPI"),
    InputDevice(7, "Microphone (WO Mic Device)", 1, 48_000, "WASAPI"),
    InputDevice(9, "USB Headset Microphone", 1, 48_000, "WASAPI"),
    InputDevice(10, "Speakers", 0, 48_000, "WASAPI"),
]


def _config(call_id: str = "call-7", speaker: str = "customer") -> SenderConfig:
    return SenderConfig(
        server_url="http://192.168.137.1:8000",
        call_id=call_id,
        speaker=speaker,
        device=DEVICES[1 if speaker == "customer" else 0],
        block_ms=100,
        reconnect_initial=1.0,
        reconnect_max=10.0,
        sender_id="sender-test-1",
    )


def _ready(
    generation: int = 7,
    speaker: str = "customer",
    next_audio_seq: int = 1,
) -> dict:
    return {
        "type": "ready",
        "call_id": "call-7",
        "speaker": speaker,
        "sender_id": "sender-test-1",
        "generation": generation,
        "next_audio_seq": next_audio_seq,
        "sample_rate": 16_000,
        "format": "pcm_s16le",
        "frame_format": {
            "magic": "K7A1",
            "header_bytes": 24,
            "endianness": "big",
            "generation": "uint32",
            "audio_seq": "uint64",
            "captured_at_ms": "uint64",
        },
        "legacy_raw_supported": True,
    }


class AudioEdgeSenderUnitTests(unittest.TestCase):
    def test_http_server_becomes_customer_websocket(self) -> None:
        self.assertEqual(
            build_audio_websocket_url(
                "http://192.168.137.1:8000", "call-7", "customer"
            ),
            "ws://192.168.137.1:8000/ws/audio/call-7?speaker=customer",
        )

    def test_https_base_path_becomes_secure_agent_websocket(self) -> None:
        self.assertEqual(
            build_audio_websocket_url(
                "https://k7.example/internal/", "case-7", "agent"
            ),
            "wss://k7.example/internal/ws/audio/case-7?speaker=agent",
        )

    def test_server_without_scheme_defaults_to_ws(self) -> None:
        self.assertEqual(
            build_audio_websocket_url("10.0.0.8:8000", "call-7", "agent"),
            "ws://10.0.0.8:8000/ws/audio/call-7?speaker=agent",
        )

    def test_server_query_is_rejected(self) -> None:
        with self.assertRaises(SenderConfigurationError):
            build_audio_websocket_url(
                "http://127.0.0.1:8000?token=unsafe", "call-7", "customer"
            )

    def test_call_id_is_mandatory_and_safe(self) -> None:
        for value in (None, "", "demo id", "/call", "x" * 65):
            with self.subTest(value=value):
                with self.assertRaises(SenderConfigurationError):
                    validate_call_id(value)
        self.assertEqual(validate_call_id("case_7.redial-2"), "case_7.redial-2")

    def test_sender_identity_is_safe_and_stable_in_config_url(self) -> None:
        config = _config()
        self.assertEqual(validate_sender_id("edge.sender_7-2"), "edge.sender_7-2")
        for value in (None, "", "sender id", "/sender", "x" * 65):
            with self.subTest(value=value):
                with self.assertRaises(SenderConfigurationError):
                    validate_sender_id(value)
        self.assertEqual(config.websocket_url, config.websocket_url)
        self.assertTrue(
            config.websocket_url.endswith(
                "?speaker=customer&sender_id=sender-test-1"
            )
        )

    def test_make_config_does_not_invent_demo_call_id(self) -> None:
        args = argparse.Namespace(
            speaker="customer",
            server="http://127.0.0.1:8000",
            call_id=None,
            device=None,
            block_ms=100,
            reconnect_initial=1.0,
            reconnect_max=10.0,
        )
        with self.assertRaisesRegex(SenderConfigurationError, "call-id is required"):
            make_config(args, DEVICES, 2)

    def test_customer_defaults_to_wo_mic(self) -> None:
        selected = select_input_device(
            DEVICES,
            speaker="customer",
            selector=None,
            default_input_index=2,
        )
        self.assertEqual(selected.index, 7)

    def test_agent_defaults_to_windows_default_input(self) -> None:
        selected = select_input_device(
            DEVICES,
            speaker="agent",
            selector=None,
            default_input_index=2,
        )
        self.assertEqual(selected.index, 2)

    def test_explicit_index_or_unique_name_fragment_selects_device(self) -> None:
        by_index = select_input_device(
            DEVICES,
            speaker="agent",
            selector="9",
            default_input_index=2,
        )
        by_name = select_input_device(
            DEVICES,
            speaker="agent",
            selector="USB Headset",
            default_input_index=2,
        )
        self.assertEqual(by_index, by_name)

    def test_missing_wo_mic_is_actionable(self) -> None:
        with self.assertRaisesRegex(SenderConfigurationError, "WO Mic"):
            select_input_device(
                [DEVICES[0], DEVICES[2]],
                speaker="customer",
                selector=None,
                default_input_index=2,
            )

    def test_block_size_is_exactly_16_khz(self) -> None:
        self.assertEqual(block_frames(100), 1600)
        self.assertEqual(block_frames(20), 320)
        with self.assertRaises(SenderConfigurationError):
            block_frames(10)

    def test_k7a1_canonical_big_endian_frame_vector(self) -> None:
        # Shared with backend/tests/test_edge_audio_ingest.py.
        frame = build_audio_frame(
            generation=1,
            audio_seq=1,
            captured_at_ms=1_720_000_000_123,
            pcm=b"\x84\x03",
        )
        self.assertEqual(FRAME_HEADER_BYTES, 24)
        self.assertEqual(
            frame.hex(),
            "4b3741310000000100000000000000010000019077fd307b8403",
        )
        self.assertEqual(
            struct.unpack(">4sIQQ", frame[:24]),
            (b"K7A1", 1, 1, 1_720_000_000_123),
        )

    def test_duplicate_or_bad_call_policy_errors_are_actionable(self) -> None:
        class Closed1008(Exception):
            code = 1008
            reason = "audio sender already connected"

        class Response:
            status_code = 403

        class Rejected403(Exception):
            response = Response()

        self.assertIn("duplicate sender", _policy_rejection(Closed1008()))
        self.assertIn("Call ID", _policy_rejection(Rejected403()))


class AudioGateUnitTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.blocks = AudioBlockQueue(asyncio.get_running_loop(), max_blocks=8)
        self.gate = AudioGate(_config(), self.blocks)

    async def test_gate_stays_closed_after_ready_then_frames_when_open(self) -> None:
        self.gate.apply_ready(_ready())
        block = AudioBlock(b"\x01\x00", 1234)
        self.assertIsNone(self.gate.frame_for(block))
        self.gate.apply_gate(
            {
                "type": "audio_gate",
                "call_id": "call-7",
                "generation": 7,
                "active": True,
                "allowed": True,
                "customer_allowed": True,
                "agent_allowed": False,
                "reason": "customer_intake",
            }
        )
        first = self.gate.frame_for(block)
        second = self.gate.frame_for(block)
        self.assertEqual(struct.unpack(">4sIQQ", first[:24])[2], 1)
        self.assertEqual(struct.unpack(">4sIQQ", second[:24])[2], 2)

    async def test_same_process_reconnect_resumes_server_sequence(self) -> None:
        self.gate.apply_ready(_ready(next_audio_seq=17))
        self.gate.apply_gate(
            {
                "type": "audio_gate",
                "call_id": "call-7",
                "generation": 7,
                "active": True,
                "allowed": True,
                "reason": "connected",
            }
        )
        frame = self.gate.frame_for(AudioBlock(b"\x01\x00", 1234))
        self.assertEqual(struct.unpack(">4sIQQ", frame[:24])[2], 17)

    async def test_gate_close_discards_backlog(self) -> None:
        self.gate.apply_ready(_ready())
        self.gate.apply_gate(
            {
                "type": "audio_gate",
                "call_id": "call-7",
                "generation": 7,
                "active": True,
                "allowed": True,
                "reason": "connected",
            }
        )
        self.blocks._push(AudioBlock(b"\x01\x00", 1))
        self.blocks._push(AudioBlock(b"\x02\x00", 2))
        self.gate.apply_gate(
            {
                "type": "audio_gate",
                "call_id": "call-7",
                "generation": 7,
                "active": False,
                "allowed": False,
                "reason": "call_ended",
            }
        )
        self.assertTrue(self.blocks.queue.empty())
        self.assertIsNone(self.gate.frame_for(AudioBlock(b"\x03\x00", 3)))

    async def test_generation_change_discards_backlog_and_resets_sequence(self) -> None:
        self.gate.apply_ready(_ready(generation=7))
        self.gate.apply_gate(
            {
                "type": "audio_gate",
                "call_id": "call-7",
                "generation": 7,
                "active": True,
                "allowed": True,
                "reason": "connected",
            }
        )
        self.gate.frame_for(AudioBlock(b"\x01\x00", 1))
        self.blocks._push(AudioBlock(b"\x02\x00", 2))
        self.gate.apply_gate(
            {
                "type": "audio_gate",
                "call_id": "call-7",
                "generation": 8,
                "active": True,
                "allowed": True,
                "reason": "redial",
            }
        )
        frame = self.gate.frame_for(AudioBlock(b"\x03\x00", 3))
        _, generation, audio_seq, _ = struct.unpack(">4sIQQ", frame[:24])
        self.assertEqual((generation, audio_seq), (8, 1))
        self.assertTrue(self.blocks.queue.empty())


if __name__ == "__main__":
    unittest.main()
