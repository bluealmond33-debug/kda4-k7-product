#!/usr/bin/env python3
"""Stream one Windows input device to the K7 distributed audio WebSocket.

The sender captures 16 kHz mono signed 16-bit PCM.  Every block is wrapped in
the versioned K7A1 envelope negotiated by ``/ws/audio/{call_id}``.  The server
owns the call lifecycle: this process sends only while its role's audio gate is
open, and drops queued audio whenever a gate closes or a new call generation
starts.  That prevents audio from a completed call leaking into a redial.
"""

from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import os
import re
import signal
import struct
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from uuid import uuid4


SAMPLE_RATE = 16_000
CHANNELS = 1
SAMPLE_WIDTH_BYTES = 2
DTYPE = "int16"
DEFAULT_BLOCK_MS = 100
CALL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SENDER_ID_PATTERN = CALL_ID_PATTERN
FRAME_MAGIC = b"K7A1"
FRAME_HEADER = struct.Struct(">4sIQQ")
FRAME_HEADER_BYTES = FRAME_HEADER.size


class SenderConfigurationError(ValueError):
    """Raised for an actionable local sender configuration problem."""


class SenderProtocolError(RuntimeError):
    """Raised when the server and sender do not share the K7A1 contract."""


@dataclass(frozen=True)
class InputDevice:
    index: int
    name: str
    max_input_channels: int
    default_samplerate: float
    hostapi: str = ""


@dataclass(frozen=True)
class AudioBlock:
    pcm: bytes
    captured_at_ms: int


@dataclass(frozen=True)
class SenderConfig:
    server_url: str
    call_id: str
    speaker: str
    device: InputDevice
    block_ms: int
    reconnect_initial: float
    reconnect_max: float
    # One random identity per process/config, retained across every reconnect.
    # The server uses it to replace only this sender's stale half-open socket;
    # a genuinely different process remains a duplicate and is rejected.
    sender_id: str = field(default_factory=lambda: uuid4().hex)

    @property
    def block_frames(self) -> int:
        return block_frames(self.block_ms)

    @property
    def websocket_url(self) -> str:
        return build_audio_websocket_url(
            self.server_url,
            self.call_id,
            self.speaker,
            self.sender_id,
        )


def validate_call_id(call_id: str | None) -> str:
    clean = (call_id or "").strip()
    if not clean:
        raise SenderConfigurationError(
            "call-id is required. Use the Call ID printed by "
            "start-distributed-server.cmd, pass --call-id, or set K7_CALL_ID."
        )
    if not CALL_ID_PATTERN.fullmatch(clean):
        raise SenderConfigurationError(
            "call-id must be 1-64 safe characters: letters, digits, dot, "
            "underscore, or hyphen"
        )
    return clean


def validate_sender_id(sender_id: str | None) -> str:
    clean = (sender_id or "").strip()
    if not SENDER_ID_PATTERN.fullmatch(clean):
        raise SenderConfigurationError(
            "sender-id must be 1-64 safe characters: letters, digits, dot, "
            "underscore, or hyphen"
        )
    return clean


def block_frames(block_ms: int) -> int:
    if not 20 <= block_ms <= 500:
        raise SenderConfigurationError("block-ms must be between 20 and 500")
    frames = SAMPLE_RATE * block_ms
    if frames % 1000:
        raise SenderConfigurationError(
            "block-ms must produce a whole frame count at 16 kHz"
        )
    return frames // 1000


def build_audio_frame(
    *, generation: int, audio_seq: int, captured_at_ms: int, pcm: bytes
) -> bytes:
    """Pack one canonical K7A1 message (24-byte big-endian header + PCM)."""

    if not 0 <= generation <= 0xFFFFFFFF:
        raise SenderProtocolError("generation is outside uint32 range")
    if not 0 <= audio_seq <= 0xFFFFFFFFFFFFFFFF:
        raise SenderProtocolError("audio_seq is outside uint64 range")
    if not 0 <= captured_at_ms <= 0xFFFFFFFFFFFFFFFF:
        raise SenderProtocolError("captured_at_ms is outside uint64 range")
    if not pcm or len(pcm) % SAMPLE_WIDTH_BYTES:
        raise SenderProtocolError("PCM16 payload must be non-empty and even-sized")
    return FRAME_HEADER.pack(
        FRAME_MAGIC,
        generation,
        audio_seq,
        captured_at_ms,
    ) + pcm


def build_audio_websocket_url(
    server_url: str,
    call_id: str,
    speaker: str,
    sender_id: str | None = None,
) -> str:
    """Build the binary PCM endpoint from an HTTP(S) or WS(S) server base."""

    raw_server = server_url.strip().rstrip("/")
    if not raw_server:
        raise SenderConfigurationError("server URL is empty")
    if "://" not in raw_server:
        raw_server = f"ws://{raw_server}"
    parsed = urlsplit(raw_server)
    scheme_map = {"http": "ws", "https": "wss", "ws": "ws", "wss": "wss"}
    scheme = scheme_map.get(parsed.scheme.casefold())
    if scheme is None:
        raise SenderConfigurationError(
            "server URL must use http, https, ws, or wss"
        )
    if not parsed.netloc:
        raise SenderConfigurationError("server URL must include a host")
    if parsed.query or parsed.fragment:
        raise SenderConfigurationError(
            "server URL must be a base URL without query or fragment"
        )
    clean_call_id = validate_call_id(call_id)
    if speaker not in {"customer", "agent"}:
        raise SenderConfigurationError("speaker must be customer or agent")

    base_path = parsed.path.rstrip("/")
    endpoint = f"{base_path}/ws/audio/{quote(clean_call_id, safe='')}"
    query_values = {"speaker": speaker}
    if sender_id is not None:
        query_values["sender_id"] = validate_sender_id(sender_id)
    query = urlencode(query_values)
    return urlunsplit((scheme, parsed.netloc, endpoint, query, ""))


def _normalize_device_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def select_input_device(
    devices: Sequence[InputDevice],
    *,
    speaker: str,
    selector: str | None,
    default_input_index: int | None,
) -> InputDevice:
    """Select an input using an index/name or the role-specific default."""

    inputs = [device for device in devices if device.max_input_channels > 0]
    if not inputs:
        raise SenderConfigurationError("Windows reports no audio input devices")

    requested = (selector or "").strip()
    if requested:
        if re.fullmatch(r"\d+", requested):
            index = int(requested)
            match = next((device for device in inputs if device.index == index), None)
            if match is None:
                raise SenderConfigurationError(
                    f"input device index {index} does not exist; use --list-devices"
                )
            return match

        folded = requested.casefold()
        exact = [device for device in inputs if device.name.casefold() == folded]
        if len(exact) == 1:
            return exact[0]
        partial = [device for device in inputs if folded in device.name.casefold()]
        if len(partial) == 1:
            return partial[0]
        if not partial:
            raise SenderConfigurationError(
                f"no input device matches {requested!r}; use --list-devices"
            )
        choices = ", ".join(f"{item.index}:{item.name}" for item in partial)
        raise SenderConfigurationError(
            f"device name {requested!r} is ambiguous ({choices}); use its numeric index"
        )

    if speaker == "customer":
        wo_mic = [
            device
            for device in inputs
            if "womic" in _normalize_device_name(device.name)
        ]
        if not wo_mic:
            raise SenderConfigurationError(
                "WO Mic input was not found for the customer role. Connect WO Mic "
                "Client, or pass --device after checking --list-devices."
            )
        if default_input_index is not None:
            default_match = next(
                (device for device in wo_mic if device.index == default_input_index),
                None,
            )
            if default_match is not None:
                return default_match
        return min(wo_mic, key=lambda device: device.index)

    if speaker == "agent":
        default_match = next(
            (device for device in inputs if device.index == default_input_index),
            None,
        )
        if default_match is None:
            raise SenderConfigurationError(
                "Windows has no default input for the agent role; pass --device"
            )
        return default_match

    raise SenderConfigurationError("speaker must be customer or agent")


def _default_input_index(sounddevice: Any) -> int | None:
    value = sounddevice.default.device
    if not isinstance(value, (str, bytes, int, float)):
        try:
            value = value[0]
        except (IndexError, KeyError, TypeError):
            pass
    try:
        index = int(value)
    except (TypeError, ValueError):
        index = -1
    if index >= 0:
        return index
    try:
        default_input = sounddevice.query_devices(kind="input")
        fallback_index = int(default_input.get("index", -1))
        return fallback_index if fallback_index >= 0 else None
    except (AttributeError, TypeError, ValueError):
        return None


def query_input_devices(sounddevice: Any) -> list[InputDevice]:
    raw_devices = sounddevice.query_devices()
    try:
        hostapis = sounddevice.query_hostapis()
    except Exception:
        hostapis = []
    devices: list[InputDevice] = []
    for index, raw in enumerate(raw_devices):
        hostapi_name = ""
        try:
            hostapi_name = str(hostapis[int(raw.get("hostapi", -1))]["name"])
        except (IndexError, KeyError, TypeError, ValueError):
            pass
        devices.append(
            InputDevice(
                index=index,
                name=str(raw.get("name", f"device-{index}")),
                max_input_channels=int(raw.get("max_input_channels", 0)),
                default_samplerate=float(raw.get("default_samplerate", 0.0)),
                hostapi=hostapi_name,
            )
        )
    return devices


def print_input_devices(
    devices: Iterable[InputDevice], default_input_index: int | None
) -> None:
    print("Windows audio input devices:")
    found = False
    for device in devices:
        if device.max_input_channels <= 0:
            continue
        found = True
        marker = "*" if device.index == default_input_index else " "
        rate = int(device.default_samplerate) if device.default_samplerate else 0
        host = f" | {device.hostapi}" if device.hostapi else ""
        print(
            f"{marker} {device.index:>3} | {device.name} | "
            f"inputs={device.max_input_channels} | default={rate} Hz{host}"
        )
    if not found:
        print("  (none)")
    print("* = Windows default input")


def _load_sounddevice() -> Any:
    try:
        import sounddevice  # type: ignore
    except ImportError as exc:
        raise SenderConfigurationError(
            "sounddevice is not installed. Run: python -m pip install sounddevice"
        ) from exc
    return sounddevice


def _load_websockets() -> Any:
    try:
        import websockets  # type: ignore
    except ImportError as exc:
        raise SenderConfigurationError(
            "websockets is not installed. Run: python -m pip install websockets"
        ) from exc
    return websockets


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Send a Windows microphone as K7A1-framed 16 kHz mono int16 PCM."
        ),
        epilog=(
            "Capture-only: this feeds central STT. It does not play or relay "
            "call audio between physically remote customer and agent devices."
        ),
    )
    parser.add_argument(
        "--speaker",
        choices=("customer", "agent"),
        default=os.getenv("K7_AUDIO_SPEAKER"),
        help="audio role; customer defaults to WO Mic, agent to Windows default mic",
    )
    parser.add_argument(
        "--server",
        default=os.getenv("K7_AUDIO_SERVER_URL", "http://127.0.0.1:8000"),
        help="K7 server base URL, for example http://192.168.0.10:8000",
    )
    parser.add_argument(
        "--call-id",
        default=os.getenv("K7_CALL_ID"),
        help="registered call/session id shared by both senders and both UIs",
    )
    parser.add_argument(
        "--device",
        help="input device numeric index, exact name, or unique name fragment",
    )
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="list real Windows input devices and exit (no Call ID required)",
    )
    parser.add_argument(
        "--block-ms",
        type=int,
        default=DEFAULT_BLOCK_MS,
        help=f"PCM block duration (default: {DEFAULT_BLOCK_MS} ms)",
    )
    parser.add_argument(
        "--reconnect-initial",
        type=float,
        default=1.0,
        help="first reconnect delay in seconds",
    )
    parser.add_argument(
        "--reconnect-max",
        type=float,
        default=10.0,
        help="maximum reconnect delay in seconds",
    )
    return parser.parse_args(argv)


def make_config(
    args: argparse.Namespace,
    devices: Sequence[InputDevice],
    default_input_index: int | None,
) -> SenderConfig:
    if not args.speaker:
        raise SenderConfigurationError("--speaker is required (customer or agent)")
    if args.reconnect_initial <= 0 or args.reconnect_max <= 0:
        raise SenderConfigurationError("reconnect delays must be greater than zero")
    if args.reconnect_initial > args.reconnect_max:
        raise SenderConfigurationError(
            "reconnect-initial cannot exceed reconnect-max"
        )
    block_frames(args.block_ms)
    call_id = validate_call_id(args.call_id)
    device = select_input_device(
        devices,
        speaker=args.speaker,
        selector=args.device,
        default_input_index=default_input_index,
    )
    config = SenderConfig(
        server_url=args.server,
        call_id=call_id,
        speaker=args.speaker,
        device=device,
        block_ms=args.block_ms,
        reconnect_initial=args.reconnect_initial,
        reconnect_max=args.reconnect_max,
    )
    # Validate URL eagerly so a device stream is never opened for bad config.
    _ = config.websocket_url
    return config


class AudioBlockQueue:
    """A bounded, callback-safe queue that drops oldest real-time audio."""

    def __init__(self, loop: asyncio.AbstractEventLoop, max_blocks: int) -> None:
        self.loop = loop
        self.queue: asyncio.Queue[AudioBlock] = asyncio.Queue(maxsize=max_blocks)
        self.dropped_blocks = 0

    def push_from_audio_thread(self, block: AudioBlock) -> None:
        self.loop.call_soon_threadsafe(self._push, block)

    def _push(self, block: AudioBlock) -> None:
        if self.queue.full():
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            self.dropped_blocks += 1
        self.queue.put_nowait(block)

    def discard_backlog(self) -> int:
        discarded = 0
        while True:
            try:
                self.queue.get_nowait()
                discarded += 1
            except asyncio.QueueEmpty:
                return discarded


def _message_generation(message: dict[str, Any]) -> int:
    value = message.get("generation")
    if isinstance(value, bool) or not isinstance(value, int):
        raise SenderProtocolError("server generation must be an integer")
    if not 0 <= value <= 0xFFFFFFFF:
        raise SenderProtocolError("server generation is outside uint32 range")
    return value


class AudioGate:
    """Connection-local lifecycle gate and K7A1 sequence allocator."""

    def __init__(self, config: SenderConfig, blocks: AudioBlockQueue) -> None:
        self.config = config
        self.blocks = blocks
        self.generation: int | None = None
        self.allowed = False
        self.ready = False
        self.reason = "waiting_for_server"
        self.next_audio_seq = 1

    def _set_generation(self, generation: int) -> None:
        if self.generation == generation:
            return
        previous = self.generation
        self.generation = generation
        self.next_audio_seq = 1
        discarded = self.blocks.discard_backlog()
        if previous is not None:
            print(
                f"Call generation changed {previous} -> {generation}; "
                f"discarded {discarded} queued block(s).",
                flush=True,
            )

    def apply_ready(self, message: dict[str, Any]) -> None:
        if message.get("call_id") != self.config.call_id:
            raise SenderProtocolError("ready call_id does not match the requested call")
        if message.get("speaker") != self.config.speaker:
            raise SenderProtocolError("ready speaker does not match this sender role")
        if message.get("sender_id") != self.config.sender_id:
            raise SenderProtocolError("ready sender_id does not match this sender process")
        if message.get("sample_rate") != SAMPLE_RATE:
            raise SenderProtocolError("server sample_rate is not 16000")
        if message.get("format") != "pcm_s16le":
            raise SenderProtocolError("server audio format is not pcm_s16le")
        frame_format = message.get("frame_format")
        if not isinstance(frame_format, dict):
            raise SenderProtocolError("server did not advertise K7A1 frame_format")
        expected = {
            "magic": "K7A1",
            "header_bytes": FRAME_HEADER_BYTES,
            "endianness": "big",
            "generation": "uint32",
            "audio_seq": "uint64",
            "captured_at_ms": "uint64",
        }
        for key, value in expected.items():
            if frame_format.get(key) != value:
                raise SenderProtocolError(
                    f"incompatible K7A1 frame_format: {key}={frame_format.get(key)!r}"
                )
        self._set_generation(_message_generation(message))
        next_audio_seq = message.get("next_audio_seq")
        if (
            isinstance(next_audio_seq, bool)
            or not isinstance(next_audio_seq, int)
            or not 1 <= next_audio_seq <= 0xFFFFFFFFFFFFFFFF
        ):
            raise SenderProtocolError("server next_audio_seq must be a positive uint64")
        # On a same-process reconnect the server remembers the last accepted
        # K7A1 sequence. Resume from its authoritative value instead of
        # restarting at one and replaying an already accepted source packet.
        self.next_audio_seq = next_audio_seq
        self.ready = True
        self.allowed = False
        self.reason = "waiting_for_audio_gate"
        self.blocks.discard_backlog()

    def apply_gate(self, message: dict[str, Any]) -> None:
        if message.get("call_id") != self.config.call_id:
            raise SenderProtocolError("audio_gate call_id does not match this sender")
        generation = _message_generation(message)
        generation_changed = generation != self.generation
        was_allowed = self.allowed
        self._set_generation(generation)
        allowed = message.get("allowed")
        if not isinstance(allowed, bool):
            raise SenderProtocolError("audio_gate allowed must be boolean")
        self.allowed = allowed
        self.reason = str(message.get("reason") or "unspecified")
        if generation_changed or not allowed:
            discarded = self.blocks.discard_backlog()
        else:
            discarded = 0
        if was_allowed != allowed or generation_changed:
            state = "OPEN" if allowed else "CLOSED"
            suffix = f"; discarded {discarded} queued block(s)" if discarded else ""
            print(
                f"Audio gate {state}: generation={generation}, "
                f"reason={self.reason}{suffix}",
                flush=True,
            )

    def apply_rejection(self, message: dict[str, Any]) -> None:
        generation = _message_generation(message)
        if generation != self.generation:
            self._set_generation(generation)
            self.allowed = False
            self.reason = "frame_rejected_generation_changed"
        code = str(message.get("code") or "unknown")
        reason = str(message.get("reason") or "no reason supplied")
        print(
            f"Server rejected an audio frame [{code}]: {reason}",
            file=sys.stderr,
            flush=True,
        )

    def frame_for(self, block: AudioBlock) -> bytes | None:
        if not self.ready or not self.allowed or self.generation is None:
            return None
        audio_seq = self.next_audio_seq
        self.next_audio_seq += 1
        return build_audio_frame(
            generation=self.generation,
            audio_seq=audio_seq,
            captured_at_ms=block.captured_at_ms,
            pcm=block.pcm,
        )


async def _receive_server_messages(socket: Any, gate: AudioGate) -> None:
    async for raw in socket:
        if not isinstance(raw, str):
            raise SenderProtocolError("server sent an unexpected binary control message")
        try:
            message = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SenderProtocolError("server sent invalid JSON control data") from exc
        if not isinstance(message, dict):
            raise SenderProtocolError("server control data must be a JSON object")
        message_type = message.get("type")
        if message_type == "ready":
            gate.apply_ready(message)
        elif message_type == "audio_gate":
            gate.apply_gate(message)
        elif message_type == "frame_rejected":
            gate.apply_rejection(message)
        elif message_type == "error":
            detail = message.get("message") or message.get("reason") or "unknown error"
            raise SenderProtocolError(f"server audio error: {detail}")
    raise ConnectionError("server closed the audio control stream")


async def _wait_or_stop(stop_event: asyncio.Event, seconds: float) -> bool:
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=seconds)
        return True
    except TimeoutError:
        return False


async def _next_block_or_receiver(
    blocks: AudioBlockQueue,
    stop_event: asyncio.Event,
    receiver: asyncio.Task[None],
) -> AudioBlock | None:
    block_task = asyncio.create_task(blocks.queue.get())
    stop_task = asyncio.create_task(stop_event.wait())
    done, _ = await asyncio.wait(
        {block_task, stop_task, receiver}, return_when=asyncio.FIRST_COMPLETED
    )
    if receiver in done:
        for task in (block_task, stop_task):
            task.cancel()
        await asyncio.gather(block_task, stop_task, return_exceptions=True)
        await receiver
        raise ConnectionError("server audio receiver stopped unexpectedly")
    if stop_task in done and stop_task.result():
        block_task.cancel()
        await asyncio.gather(block_task, return_exceptions=True)
        return None
    stop_task.cancel()
    await asyncio.gather(stop_task, return_exceptions=True)
    return block_task.result()


def _connect_kwargs(websockets: Any) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "compression": None,
        "open_timeout": 10,
        "close_timeout": 5,
        "ping_interval": 20,
        "ping_timeout": 20,
        "max_size": 1_048_576,
    }
    try:
        if "proxy" in inspect.signature(websockets.connect).parameters:
            # A LAN audio stream must not follow a corporate/system HTTP proxy.
            kwargs["proxy"] = None
    except (TypeError, ValueError):
        pass
    return kwargs


def _policy_rejection(exc: Exception) -> str | None:
    code = getattr(exc, "code", None)
    reason = getattr(exc, "reason", "")
    if code == 1008:
        return (
            f"server rejected this sender (WebSocket 1008): {reason or 'policy error'}. "
            "Check the Call ID and close any duplicate sender for the same role."
        )
    # ASGI servers can surface a policy close issued before websocket.accept()
    # as an HTTP 403 handshake denial.  Keep this actionable even when the
    # transport cannot preserve the server's close reason.
    status_code = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    if status_code is None and response is not None:
        status_code = getattr(response, "status_code", None)
    if status_code == 403:
        return (
            "server rejected the audio WebSocket (HTTP 403). Check that the "
            "Call ID was registered by start-distributed-server.cmd and that "
            "no duplicate sender is using this role."
        )
    return None


async def stream_with_reconnect(
    config: SenderConfig,
    blocks: AudioBlockQueue,
    stop_event: asyncio.Event,
    websockets: Any,
) -> None:
    retry = config.reconnect_initial
    last_drop_report = 0
    while not stop_event.is_set():
        discarded = blocks.discard_backlog()
        if discarded:
            print(
                f"Discarded {discarded} buffered block(s) before reconnect.",
                flush=True,
            )
        try:
            async with websockets.connect(
                config.websocket_url,
                **_connect_kwargs(websockets),
            ) as socket:
                gate = AudioGate(config, blocks)
                receiver = asyncio.create_task(_receive_server_messages(socket, gate))
                print(
                    f"Connected: {config.websocket_url} ({config.speaker}); "
                    "waiting for the server audio gate.",
                    flush=True,
                )
                retry = config.reconnect_initial
                try:
                    while not stop_event.is_set():
                        block = await _next_block_or_receiver(
                            blocks, stop_event, receiver
                        )
                        if block is None:
                            break
                        frame = gate.frame_for(block)
                        if frame is None:
                            continue
                        await socket.send(frame)
                        if blocks.dropped_blocks - last_drop_report >= 10:
                            last_drop_report = blocks.dropped_blocks
                            print(
                                f"Warning: {last_drop_report} audio block(s) dropped "
                                "because the network sender fell behind.",
                                file=sys.stderr,
                                flush=True,
                            )
                finally:
                    receiver.cancel()
                    await asyncio.gather(receiver, return_exceptions=True)
        except asyncio.CancelledError:
            raise
        except SenderProtocolError:
            raise
        except Exception as exc:
            if stop_event.is_set():
                break
            policy_error = _policy_rejection(exc)
            if policy_error:
                raise SenderConfigurationError(policy_error) from exc
            print(
                f"Audio WebSocket disconnected ({type(exc).__name__}: {exc}). "
                f"Retrying in {retry:.1f}s...",
                file=sys.stderr,
                flush=True,
            )
            if await _wait_or_stop(stop_event, retry):
                break
            retry = min(config.reconnect_max, retry * 2)


async def run_sender(config: SenderConfig, sounddevice: Any, websockets: Any) -> None:
    try:
        sounddevice.check_input_settings(
            device=config.device.index,
            channels=CHANNELS,
            dtype=DTYPE,
            samplerate=SAMPLE_RATE,
        )
    except Exception as exc:
        raise SenderConfigurationError(
            f"{config.device.index}:{config.device.name} cannot capture "
            f"{SAMPLE_RATE} Hz mono int16 PCM: {exc}"
        ) from exc

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()
    max_blocks = max(10, 5_000 // config.block_ms)
    blocks = AudioBlockQueue(loop, max_blocks=max_blocks)
    last_status_at = 0.0

    def report_status(status: str) -> None:
        nonlocal last_status_at
        now = time.monotonic()
        if now - last_status_at >= 1.0:
            last_status_at = now
            print(f"Audio device status: {status}", file=sys.stderr, flush=True)

    def audio_callback(indata: Any, frames: int, time_info: Any, status: Any) -> None:
        del frames, time_info
        if status:
            loop.call_soon_threadsafe(report_status, str(status))
        blocks.push_from_audio_thread(
            AudioBlock(
                pcm=bytes(indata),
                captured_at_ms=time.time_ns() // 1_000_000,
            )
        )

    previous_handlers: dict[int, Any] = {}

    def request_stop(signum: int, frame: Any) -> None:
        del signum, frame
        loop.call_soon_threadsafe(stop_event.set)

    signals = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):
        signals.append(signal.SIGBREAK)
    for sig in signals:
        try:
            previous_handlers[sig] = signal.getsignal(sig)
            signal.signal(sig, request_stop)
        except (OSError, RuntimeError, ValueError):
            pass

    print(
        f"Input: {config.device.index}:{config.device.name} | "
        f"{SAMPLE_RATE} Hz mono int16 | block={config.block_ms} ms",
        flush=True,
    )
    print(
        "Mode: K7A1 capture to central STT only "
        "(no remote call-audio playback/relay).",
        flush=True,
    )
    print("Press Ctrl+C to stop and close the stream cleanly.", flush=True)
    try:
        with sounddevice.RawInputStream(
            samplerate=SAMPLE_RATE,
            blocksize=config.block_frames,
            device=config.device.index,
            channels=CHANNELS,
            dtype=DTYPE,
            callback=audio_callback,
        ):
            await stream_with_reconnect(config, blocks, stop_event, websockets)
    finally:
        stop_event.set()
        for sig, previous in previous_handlers.items():
            try:
                signal.signal(sig, previous)
            except (OSError, RuntimeError, ValueError):
                pass
        print("Audio sender stopped.", flush=True)


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        if not args.list_devices:
            # Report a missing/unsafe Call ID before importing or opening any
            # audio dependency.
            validate_call_id(args.call_id)
        sounddevice = _load_sounddevice()
        devices = query_input_devices(sounddevice)
        default_input = _default_input_index(sounddevice)
        if args.list_devices:
            print_input_devices(devices, default_input)
            return 0
        config = make_config(args, devices, default_input)
        websockets = _load_websockets()
        asyncio.run(run_sender(config, sounddevice, websockets))
        return 0
    except KeyboardInterrupt:
        print("Audio sender stopped.", flush=True)
        return 130
    except SenderConfigurationError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    except SenderProtocolError as exc:
        print(f"Protocol error: {exc}", file=sys.stderr)
        return 3
    except Exception as exc:
        print(f"Audio sender failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
