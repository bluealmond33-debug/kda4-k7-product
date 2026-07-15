import type { TranscriptChunk } from "./types";
import { useReal } from "./config";

/** Scripted caller intake used by the mock STT session (the demo utterance). */
export const DEMO_UTTERANCE: string[] = [
  "여보세요, 제가 방금 이체를 잘못했어요.",
  "오늘 오전에 지인한테 30만원을 보내려다가 계좌를 잘못 눌렀나 봐요.",
  "이거 돌려받을 수 있나요? 너무 당황스러워서요.",
  "거래한 시간이랑 계좌번호 확인해서 반환 절차 좀 안내해 주세요.",
];

export interface SttSession {
  stop(): void;
}

export interface SttHandlers {
  /** Called for each (final) transcript fragment. */
  onChunk(chunk: TranscriptChunk): void;
  /** Called when the scripted utterance is exhausted (mock only). */
  onDone?(): void;
}

/**
 * Start a speech-to-text session.
 *
 * mock (default): replays DEMO_UTTERANCE on a timer — no mic access.
 * real: wire the browser SpeechRecognition API or stream mic audio to
 *       the backend at VITE_API_BASE_URL. Mic is simulation-only for the
 *       demo, so the mock path is what the demo uses.
 *
 * @param lineGapMs  gap between scripted lines (mock only).
 */
export function startSttSession(
  handlers: SttHandlers,
  lineGapMs = 2400
): SttSession {
  if (useReal.stt) {
    // Placeholder for the real integration. Implement browser STT or a
    // WebSocket/stream to the backend here and forward fragments via onChunk.
    // Falls back to mock so the UI keeps working until this is built.
  }

  const t0 = Date.now();
  const timers: number[] = [];
  DEMO_UTTERANCE.forEach((line, i) => {
    timers.push(
      window.setTimeout(() => {
        handlers.onChunk({ text: line, at: Date.now() - t0, isFinal: true });
        if (i === DEMO_UTTERANCE.length - 1) handlers.onDone?.();
      }, lineGapMs * (i + 1))
    );
  });

  return {
    stop() {
      timers.forEach((id) => clearTimeout(id));
    },
  };
}
