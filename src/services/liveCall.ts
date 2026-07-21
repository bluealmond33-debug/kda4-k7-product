// 실시간 통화 — 고객 마이크를 캡처해 WebSocket으로 백엔드에 PCM 스트리밍하고(customer),
// 동시에 상담사 소켓(agent)으로 전사를 받아 콜백한다. 전부 로컬(온프레미스): 마이크·WS·STT
// 모두 이 랩탑/LAN 안에서 완결하며 외부 인터넷을 쓰지 않는다.

import { API_BASE_URL } from "./config";

const env = import.meta.env;

function wsBase(): string {
  const explicit = String(env.VITE_WS_BASE_URL ?? "").replace(/\/$/, "");
  if (explicit) return explicit;
  if (API_BASE_URL) return API_BASE_URL.replace(/^http/, "ws"); // http→ws, https→wss
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:8000`;
}

export interface LiveTranscript {
  seq: number;
  text: string;
  at: number;
}

export interface LiveHandle {
  stop: () => void;
}

export interface LiveHandlers {
  onTranscript?: (t: LiveTranscript) => void;
  onError?: (message: string) => void;
  /** 마이크 입력 레벨(RMS, 대략 0~0.3). 녹음 중 UI 피드백용, 초당 ~4회 호출. */
  onLevel?: (level: number) => void;
}

/** 통화 시작 — 마이크 권한을 얻고 PCM 스트리밍 + 전사 수신을 건다. 마이크 실패 시 reject. */
export async function startLiveCall(callId: string, handlers: LiveHandlers = {}): Promise<LiveHandle> {
  const base = wsBase();
  const id = encodeURIComponent(callId);

  // 마이크 먼저 확보 — 거부/불가면 여기서 throw 되어 호출부가 폴백할 수 있다.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });

  // 상담사 수신 소켓
  const agent = new WebSocket(`${base}/ws/call/${id}?role=agent`);
  agent.onmessage = (ev) => {
    let m: unknown;
    try {
      m = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    const msg = m as { type?: string; seq?: number; text?: string; at?: number };
    if (msg.type === "transcript" && handlers.onTranscript) {
      handlers.onTranscript({ seq: msg.seq ?? 0, text: msg.text ?? "", at: msg.at ?? Date.now() });
    }
  };
  agent.onerror = () => handlers.onError?.("전사 수신 소켓 오류");

  // 고객 송신 소켓 + 오디오 파이프라인
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 16000 });
  if (ctx.state === "suspended") await ctx.resume();
  const cust = new WebSocket(`${base}/ws/call/${id}?role=customer`);
  cust.binaryType = "arraybuffer";

  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  source.connect(proc);
  proc.connect(ctx.destination); // 출력에 아무것도 안 써서 무음 — 에코 없음

  proc.onaudioprocess = (e: AudioProcessingEvent) => {
    const f32 = e.inputBuffer.getChannelData(0);
    if (handlers.onLevel) {
      let sum = 0;
      for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
      handlers.onLevel(Math.sqrt(sum / f32.length));
    }
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    if (cust.readyState === 1) cust.send(i16.buffer);
  };

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      proc.onaudioprocess = null;
      proc.disconnect();
    } catch {
      /* noop */
    }
    try {
      source.disconnect();
    } catch {
      /* noop */
    }
    try {
      void ctx.close();
    } catch {
      /* noop */
    }
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* noop */
    }
    try {
      cust.close();
    } catch {
      /* noop */
    }
    try {
      agent.close();
    } catch {
      /* noop */
    }
  };

  return { stop };
}
