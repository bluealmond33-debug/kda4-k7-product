import { API_BASE_URL } from "./config";

const env = import.meta.env;

function wsBase(): string {
  const explicit = String(env.VITE_WS_BASE_URL ?? "").replace(/\/$/, "");
  if (explicit) return explicit;
  if (API_BASE_URL) return API_BASE_URL.replace(/^http/, "ws");
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:8000`;
}

export type LiveSpeaker = "customer" | "agent";

export interface LiveTranscript {
  seq: number;
  text: string;
  at: number;
  speaker: LiveSpeaker;
  generation?: number;
  audioSeq?: number;
  /** false면 문장이 아직 안 끝난 인터림 미리보기(0.5초 간격) — 같은 seq로 또 온다.
   *  생략되거나 true면 확정(문장 끝 무음 감지 또는 세션 종료 flush) — 인터림을 모르는
   *  다른 생성 경로(대화 시뮬레이션 등)와 하위호환되게 기본은 "확정"으로 둔다. */
  isFinal?: boolean;
  /** 이 발화에서 백엔드(pii_guard, 11개 항목)가 마스킹한 개인정보 건수 — 화면 배지용 */
  piiMasked?: number;
  // WavLM 음성분노 신호(ws/call.py의 _emit_transcript가 발화마다 실어 보냄) — 감정온도
  // 실시간 미리보기(useCallFlow의 liveRecordingAnger)용. 폴백 중이면 서버가 아예 필드를
  // 안 보내므로 undefined일 수 있다.
  angerDetected?: boolean;
  angerProbability?: number;
}

export interface LiveHandle {
  stop(): void;
  waitForSeq(seq: number, timeoutMs?: number): Promise<boolean>;
}

export interface LiveHandlers {
  onTranscript?(transcript: LiveTranscript): void;
  onError?(message: string): void;
  onWarning?(message: string, status: string): void;
  onLevel?(level: number, speaker: LiveSpeaker): void;
  onCaptureStatus?(active: boolean, device: string | undefined, speaker: LiveSpeaker): void;
}

/**
 * Observe the server-owned transcript stream. Audio itself is sent by the two
 * Windows edge senders; the browser never asks for microphone permission.
 */
export async function startLiveCall(
  callId: string,
  handlers: LiveHandlers = {}
): Promise<LiveHandle> {
  const id = encodeURIComponent(callId);
  let socket: WebSocket | null = null;
  let retryTimer = 0;
  let stopped = false;
  let lastSeq = 0;
  let transcriptGeneration = 0;
  const seqWaiters = new Set<{
    target: number;
    timer: number;
    resolve(value: boolean): void;
  }>();

  const settleSeqWaiters = () => {
    for (const waiter of seqWaiters) {
      if (lastSeq < waiter.target) continue;
      window.clearTimeout(waiter.timer);
      seqWaiters.delete(waiter);
      waiter.resolve(true);
    }
  };

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(`${wsBase()}/ws/call/${id}?role=agent`);
    socket.onmessage = (event) => {
      let message: {
        type?: string;
        seq?: number;
        audio_seq?: number;
        generation?: number;
        text?: string;
        at?: number;
        speaker?: unknown;
        isFinal?: boolean;
        pii_masked?: number;
        anger_detected?: boolean;
        anger_probability?: number | null;
        level?: number;
        status?: string;
        device?: string;
        message?: string;
      };
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const speaker: LiveSpeaker = message.speaker === "agent" ? "agent" : "customer";
      if (message.type === "transcript") {
        const generation = Math.max(0, Number(message.generation) || 0);
        if (generation > 0 && transcriptGeneration > 0 && generation < transcriptGeneration) {
          return;
        }
        if (generation > transcriptGeneration) {
          transcriptGeneration = generation;
          lastSeq = 0;
          for (const waiter of seqWaiters) {
            window.clearTimeout(waiter.timer);
            waiter.resolve(false);
          }
          seqWaiters.clear();
        }
        const audioSeq = Math.max(0, Number(message.audio_seq) || 0);
        const seq = Math.max(0, Number(message.seq ?? audioSeq) || 0);
        // 인터림(isFinal=false)은 같은 문장이 끝날 때까지 같은 seq로 여러 번 온다 — 엄격히
        // '<'로만 걸러야 그 반복(및 뒤이은 확정)이 살아남는다. '<='였다면 두 번째 틱부터
        // 전부 막혀 인터림이 한 번밖에 안 보였다.
        if (seq > 0 && seq < lastSeq) return;
        lastSeq = Math.max(lastSeq, seq);
        const piiMasked = Math.max(0, Number(message.pii_masked) || 0);
        handlers.onTranscript?.({
          seq,
          text: message.text ?? "",
          at: Number(message.at) || Date.now(),
          speaker,
          isFinal: message.isFinal !== false,
          ...(generation > 0 ? { generation } : {}),
          ...(audioSeq > 0 ? { audioSeq } : {}),
          ...(piiMasked > 0 ? { piiMasked } : {}),
          ...(typeof message.anger_detected === "boolean"
            ? { angerDetected: message.anger_detected }
            : {}),
          ...(typeof message.anger_probability === "number"
            ? { angerProbability: message.anger_probability }
            : {}),
        });
        settleSeqWaiters();
      }
      if (message.type === "level") handlers.onLevel?.(message.level ?? 0, speaker);
      if (message.type === "capture_status") {
        handlers.onCaptureStatus?.(
          message.status === "recording",
          message.device,
          speaker
        );
      }
      if (message.type === "stt_overload") {
        handlers.onWarning?.(
          message.message ?? "STT 처리 지연이 발생했습니다. 마지막 녹취를 확인해 주세요.",
          message.status ?? "backlogged"
        );
      }
      if (message.type === "error") handlers.onError?.(message.message ?? "로컬 STT 오류");
    };
    socket.onerror = () => handlers.onError?.("로컬 STT 수신 채널에 연결할 수 없습니다.");
    socket.onclose = () => {
      if (!stopped) retryTimer = window.setTimeout(connect, 1200);
    };
  };

  connect();

  return {
    waitForSeq(seq, timeoutMs = 30_000) {
      const target = Math.max(0, seq);
      if (target === 0 || lastSeq >= target) return Promise.resolve(true);
      if (stopped) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const waiter = { target, timer: 0, resolve };
        waiter.timer = window.setTimeout(() => {
          seqWaiters.delete(waiter);
          resolve(false);
        }, timeoutMs);
        seqWaiters.add(waiter);
      });
    },
    stop() {
      stopped = true;
      window.clearTimeout(retryTimer);
      socket?.close();
      for (const waiter of seqWaiters) {
        window.clearTimeout(waiter.timer);
        waiter.resolve(false);
      }
      seqWaiters.clear();
    },
  };
}
