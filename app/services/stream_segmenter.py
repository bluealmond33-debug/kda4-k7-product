"""실시간 스트리밍 STT용 발화 세그먼터 (순수 파이썬 RMS 에너지 VAD).

webrtcvad/silero 같은 네이티브 VAD는 C 확장(.pyd/.dll)이라 이 랩탑 Windows Smart App
Control이 av(PyAV)처럼 로드 시점에 차단할 위험이 있다. 그래서 numpy만 쓰는 RMS 에너지
기반으로 발화(문장) 경계를 잡는다. 입력은 16kHz mono Int16 PCM 바이트 스트림.
"""
from __future__ import annotations

import numpy as np


class UtteranceSegmenter:
    def __init__(
        self,
        sample_rate: int = 16000,
        frame_ms: int = 20,
        rms_threshold: float = 220.0,
        start_frames: int = 3,
        end_silence_ms: int = 700,
        min_utterance_ms: int = 300,
        max_utterance_ms: int = 15000,
    ) -> None:
        self.frame_bytes = (sample_rate * frame_ms // 1000) * 2  # int16 = 2 byte
        self.rms_threshold = rms_threshold
        self.start_frames = start_frames
        self.end_silence_frames = max(1, end_silence_ms // frame_ms)
        self.min_voiced_frames = max(1, min_utterance_ms // frame_ms)
        self.max_utterance_frames = max(1, max_utterance_ms // frame_ms)

        self._buf = b""                 # 프레임 정렬용 잔여 바이트
        self._speaking = False
        self._voiced_run = 0            # IDLE에서 연속 voiced 프레임 수(시작 트리거용)
        self._silence_run = 0           # SPEAKING에서 연속 silence 프레임 수(종료용)
        self._voiced_in_cur = 0         # 현재 발화의 voiced 프레임 총수(blip 필터용)
        self._pre: list[bytes] = []     # 시작 트리거 전 최근 프레임(프리롤)
        self._cur: list[bytes] = []     # 현재 발화 프레임들

    @staticmethod
    def _is_voiced(frame: bytes, threshold: float) -> bool:
        samples = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
        if samples.size == 0:
            return False
        rms = float(np.sqrt(np.mean(samples * samples)))
        return rms >= threshold

    def accept_audio(self, pcm: bytes) -> list[bytes]:
        self._buf += pcm
        finished: list[bytes] = []
        while len(self._buf) >= self.frame_bytes:
            frame = self._buf[: self.frame_bytes]
            self._buf = self._buf[self.frame_bytes :]
            utt = self._process_frame(frame)
            if utt is not None:
                finished.append(utt)
        return finished

    def _process_frame(self, frame: bytes) -> bytes | None:
        voiced = self._is_voiced(frame, self.rms_threshold)
        if not self._speaking:
            self._pre.append(frame)
            if len(self._pre) > self.start_frames:
                self._pre.pop(0)
            if voiced:
                self._voiced_run += 1
                if self._voiced_run >= self.start_frames:
                    self._speaking = True
                    self._cur = list(self._pre)
                    self._voiced_in_cur = self.start_frames
                    self._pre = []
                    self._voiced_run = 0
                    self._silence_run = 0
            else:
                self._voiced_run = 0
            return None

        # speaking
        self._cur.append(frame)
        if voiced:
            self._voiced_in_cur += 1
            self._silence_run = 0
        else:
            self._silence_run += 1
        if self._silence_run >= self.end_silence_frames or len(self._cur) >= self.max_utterance_frames:
            return self._finalize()
        return None

    def _finalize(self) -> bytes | None:
        frames = self._cur
        voiced = self._voiced_in_cur
        self._speaking = False
        self._cur = []
        self._pre = []
        self._voiced_run = 0
        self._silence_run = 0
        self._voiced_in_cur = 0
        if voiced < self.min_voiced_frames:
            return None
        return b"".join(frames)

    def flush(self) -> list[bytes]:
        if self._speaking:
            utt = self._finalize()
            return [utt] if utt is not None else []
        return []
