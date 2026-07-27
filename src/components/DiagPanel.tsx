import { useEffect, useState } from "react";
import { css } from "../lib/css";
import type { CallFlowVM } from "../hooks/useCallFlow";
import { micDiag } from "../lib/mic";

/**
 * 시연 현장 진단 패널 — 실제 백엔드 통화에서만 나오는 문제를 눈으로 잡기 위한 도구.
 *
 * 왜 필요한가: F2(마이크가 안 꺼짐)·F4(상담사 메모 안 됨)는 **로컬 데모로 재현되지 않는다.**
 * 재현이 안 되면 고칠 수도 없고, 고쳤는지 확인할 수도 없다. 그래서 판단에 필요한 값을
 * 통화 중에 실시간으로 띄운다 — 시연이 끝난 뒤 "그때 뭐였더라"를 없애는 게 목적이다.
 *
 * 여는 법: 주소에 `?diag=1` 을 붙이거나, 아무 화면에서 **Ctrl+Shift+D**.
 * 기본은 꺼져 있다 — 고객·심사위원 앞에서는 보이지 않아야 한다.
 *
 * 값은 100ms마다 새로 읽는다(폴링). 진단 도구라 정확한 최신값이 렌더 최적화보다 중요하다.
 */

const FONT = "'Avenir Next','Pretendard',sans-serif";

/** 판정 색 — 좋음/주의/나쁨. 진단 도구라 여기선 색을 신호로 쓴다. */
const OK = "#3ddc84";
const WARN = "#ffcc4d";
const BAD = "#ff6b6b";
const DIM = "#8a90a0";

function Row({ k, v, tone = "" }: { k: string; v: string | number; tone?: string }) {
  return (
    <div style={css("display:flex;gap:8px;align-items:baseline;padding:1.5px 0")}>
      <span style={css("flex:none;width:104px;color:" + DIM)}>{k}</span>
      <span style={css("flex:1;min-width:0;word-break:break-all;color:" + (tone || "#e8eaed"))}>{v}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={css("border-top:1px solid rgba(255,255,255,.12);padding:7px 0 5px")}>
      <div style={css("color:#fff;font-weight:700;letter-spacing:.4px;margin-bottom:4px")}>{title}</div>
      {children}
    </div>
  );
}

export default function DiagPanel({ vm }: { vm: CallFlowVM }) {
  const [open, setOpen] = useState(
    () => typeof location !== "undefined" && new URLSearchParams(location.search).get("diag") === "1"
  );
  const [, tick] = useState(0);

  // Ctrl+Shift+D 로 여닫는다 — 시연 중 주소를 다시 칠 필요 없이 즉시 켜고 끈다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => tick((n) => n + 1), 100);
    return () => window.clearInterval(id);
  }, [open]);

  if (!open) return null;

  const m = micDiag();
  const d = vm.diagSnapshot();

  // 마이크 판정 — 이게 F2의 핵심이다.
  // refCount 0인데 트랙이 살아 있으면 release 누락(= 마이크가 안 꺼진 상태).
  const leaked = m.refCount === 0 && m.hasTrack;
  const micTone = leaked ? BAD : m.live ? OK : m.secure ? DIM : WARN;
  const micVerdict = leaked
    ? "누수 — refCount 0인데 트랙 살아 있음"
    : m.live
    ? "정상 동작 중"
    : !m.supported
    ? "브라우저 미지원"
    : !m.secure
    ? "비보안 컨텍스트 — http라 차단됨"
    : m.lastError
    ? m.lastError
    : "미사용";

  return (
    <div
      style={css(
        "position:fixed;right:12px;bottom:12px;z-index:9999;width:330px;max-height:82vh;overflow:auto;" +
          "background:rgba(16,18,22,.94);backdrop-filter:blur(8px);border-radius:10px;padding:11px 13px;" +
          "font:500 11px/1.5 " + FONT + ";color:#e8eaed;box-shadow:0 12px 40px rgba(0,0,0,.55)"
      )}
    >
      <div style={css("display:flex;align-items:center;gap:8px;padding-bottom:6px")}>
        <span style={css("font-weight:700;color:#fff;letter-spacing:.5px")}>DIAG</span>
        <span style={css("color:" + DIM)}>Ctrl+Shift+D</span>
        <div style={css("flex:1")} />
        <span onClick={() => setOpen(false)} style={css("cursor:pointer;color:" + DIM)}>✕</span>
      </div>

      <Section title="MIC (F2)">
        <Row k="판정" v={micVerdict} tone={micTone} />
        <Row k="refCount" v={m.refCount} tone={leaked ? BAD : DIM} />
        <Row k="live" v={String(m.live)} tone={m.live ? OK : DIM} />
        <Row k="track" v={m.trackState} tone={m.trackState === "live" ? OK : DIM} />
        <Row k="audioCtx" v={m.ctxState} />
        <Row k="level" v={"▁".repeat(1) + "█".repeat(Math.round(m.level * 18))} tone={OK} />
        <Row k="secure" v={String(m.secure)} tone={m.secure ? OK : BAD} />
      </Section>

      <Section title="MEMO (F4)">
        <Row k="개수" v={d.memoCount} tone={d.memoCount > 0 ? OK : DIM} />
        <Row k="마지막" v={d.lastMemo || "—"} />
      </Section>

      <Section title="후처리 게이트 (F3)">
        <Row k="열릴까" v={d.wrapGate.willOpen ? "YES" : "NO"} tone={d.wrapGate.willOpen ? OK : WARN} />
        <Row k="상담사연결" v={String(d.wrapGate.agentConnected)} tone={d.wrapGate.agentConnected ? OK : DIM} />
        <Row k="대화성립" v={String(d.wrapGate.hadConversation)} tone={d.wrapGate.hadConversation ? OK : DIM} />
        <Row k="상담사발화" v={String(d.hasAgent)} />
        <Row k="고객발화" v={String(d.hasCustomer)} />
      </Section>

      <Section title="분류">
        <Row
          k="업무코드"
          v={d.businessCode ?? "미분류 (routing=null)"}
          tone={d.businessCode ? OK : BAD}
        />
        <Row k="업무명" v={d.businessName ?? "—"} />
        <Row k="부서" v={d.department} />
        <Row k="확신도" v={d.confidence != null ? String(d.confidence) : "—"} />
      </Section>

      <Section title="통화">
        <Row k="phase" v={d.phase} />
        <Row k="시간" v={d.clock} />
        <Row k="실연동" v={String(d.liveCall)} tone={d.liveCall ? OK : DIM} />
        <Row k="STT 확정" v={d.transcriptFinals} />
        <Row k="화자라벨" v={d.labeledChunks + " / " + d.transcriptFinals} tone={d.labeledChunks ? OK : WARN} />
      </Section>
    </div>
  );
}
