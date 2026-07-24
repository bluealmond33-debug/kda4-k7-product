import { useEffect, useRef, useState } from "react";
import { css } from "../../lib/css";
import { highlight } from "../../lib/highlight";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import Spinner from "../Spinner";
import BrandLogo from "../BrandLogo";
import { AGENT } from "../../data/demoContent";
import { SGE_META } from "../../services/sge";
import DesktopShell from "./DesktopShell";

/* 데모 기준일 2026.07.21 — ago(상대 시점)를 함께 표기해 최근 항목이 '오늘 상담'으로 오해되지 않게 한다 */
const HISTORY = [
  { date: "2026.07.02", ago: "3주 전", label: "카드 › 분실신고" },
  { date: "2026.05.18", ago: "2개월 전", label: "수신 › 이체한도 상향" },
  { date: "2026.03.09", ago: "4개월 전", label: "전자금융 › OTP 재발급" },
  { date: "2026.02.14", ago: "5개월 전", label: "대출 › 상환일정 문의" },
];

// 규정 검색 필터 옵션 — 엑셀 컬럼필터 감각. 부서 코드는 backend taxonomy(DEP/LON/…)와 동일.
// DB rag_documents.doc_type 실제 값(정확 매칭이라 문자열이 정확해야 함).
const REG_DOC_TYPES = ["상품설명서", "요약 상품설명서", "핵심설명서", "설명서", "약관", "내부 업무지침 (합성 데모)"];
const REG_DEPT_OPTS: { label: string; code: string }[] = [
  { label: "수신·예적금", code: "DEP" },
  { label: "여신·대출", code: "LON" },
  { label: "카드·결제", code: "CRD" },
  { label: "외환·수출입", code: "FX" },
  { label: "전자금융·디지털", code: "EFN" },
  { label: "연금·신탁·투자", code: "INV" },
  { label: "사고·신고", code: "SG" },
  { label: "제도·민원·기타", code: "ETC" },
];
const REG_EFF_OPTS: { label: string; from: string }[] = [
  { label: "2025년~", from: "2025-01-01" },
  { label: "2024년~", from: "2024-01-01" },
  { label: "2023년~", from: "2023-01-01" },
];

const ACCOUNTS = [
  { kind: "입출금", name: "키움 주거래 통장", no: "***-**-4821", opened: "2019.03.11" },
  { kind: "적금", name: "키움 자유적금", no: "***-**-7745", opened: "2022.06.01" },
  { kind: "체크카드", name: "키움 체크카드", no: "****-****-**-2231", opened: "2019.03.11" },
  { kind: "대출", name: "신용대출", no: "***-**-9902", opened: "2024.01.20" },
];

/** 마크다운 표 문자열 → 행 배열(셀 배열). 구분선(---) 행 제외, 파이프 제거. */
function parseMdTable(raw: string): string[][] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => c === "" || /^-+$/.test(c)));
}
/** 미리보기용 — 파이프를 공백으로 바꾸고 연속 공백 축약(상담사가 읽기 편하게). */
function stripPipes(s: string): string {
  return s.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
}

/** 1a — 통화 중. 좌: 상담사·고객(본인인증 1d)·이력 / 중: 요약·스크립트·메모 / 우: 규정. */
export default function ActiveCall({ vm }: { vm: CallFlowVM }) {
  const [showHistory, setShowHistory] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [transferMenu, setTransferMenu] = useState(false); // 이관 부서 선택 드롭다운
  const [scriptOpen, setScriptOpen] = useState(false); // 단계별 스크립트 아코디언 — 기본 접힘(초보 상담사용, 필요할 때만 펼침)
  // 메모 인라인 수정 — editIdx 행이 input으로 바뀐다
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const memoInputRef = useRef<HTMLInputElement | null>(null);
  // 메모 목록 — 새 메모가 입력창 바로 위(맨 아래)에 붙도록 추가 시 바닥으로 자동 스크롤
  const memoListRef = useRef<HTMLDivElement | null>(null);
  const [memoFocused, setMemoFocused] = useState(false);
  const [authFocused, setAuthFocused] = useState(false);

  // 광원 상태머신 v3 — 기본은 아무 카드도 들리지 않는다(진입 직후 스크립트에 그림자가 떠 있던 v2 교정).
  // 초점은 '작업 중'일 때만: 메모 입력 > 규정집 확장 > 본인확인 입력 포커스.
  // 마우스 관심은 .card:hover(--sh-hover)가 맡는다 — 호버 = 관심 후보, focus = 작업 중.
  const focus: "customer" | "memo" | "reg" | "none" =
    memoFocused || editIdx !== null ? "memo"
    : vm.regExpanded ? "reg"
    : authFocused ? "customer"
    : "none";

  useEffect(() => {
    const el = memoListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [vm.memoItems.length]);

  // 확장 상태는 regExpanded(명시적)로만 제어한다 — 검색어 유무와 분리.
  // (검색어에 묶으면 첫 글자에 접힘→확장으로 input이 remount되며 한글 조합이 깨지고, 다 지우면 접혔다)
  const regWide = vm.regExpanded || !!vm.regDoc || vm.regDocLoading;

  // 아코디언 outside-click 닫힘 — 왼쪽 컬럼 밖을 클릭하면 펼친 카드가 접힌다
  const leftColRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showHistory && !showAccounts) return;
    const onDown = (e: MouseEvent) => {
      if (leftColRef.current && !leftColRef.current.contains(e.target as Node)) {
        setShowHistory(false);
        setShowAccounts(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showHistory, showAccounts]);

  // 키보드 단축키 — 입력 중에는 무시(Esc 제외). M 음소거 / H 보류 / R 규정집 / N 메모
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        setEndConfirm(false);
        setEditIdx(null);
        if (typing) el.blur();
        return;
      }
      if (typing) return;
      if (vm.showWrap) return; // 종료 후 배경 화면에선 통화 단축키 비활성
      const k = e.key.toLowerCase();
      // 실제 연동 모드의 음소거·보류는 아직 엣지 송신기/통화 음원 제어 계약이 없다.
      // 화면 상태만 바뀌어 고객 음성이 제어된 것처럼 보이지 않도록 데모 모드에서만 허용한다.
      if (k === "m" && !vm.isExplicitLiveCall) setMuted((v) => !v);
      else if (k === "h" && !vm.isExplicitLiveCall) setHeld((v) => !v);
      else if (k === "r") (vm.regCollapsed ? vm.openManual : vm.closeReg)();
      else if (k === "n") {
        e.preventDefault();
        memoInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vm]);

  const copyWrapSummary = async () => {
    try {
      await navigator.clipboard.writeText(vm.wrapSummaryDefault);
      setSummaryCopied(true);
      window.setTimeout(() => setSummaryCopied(false), 1600);
    } catch {
      setSummaryCopied(false);
    }
  };
  return (
    <DesktopShell flex>
      {vm.liveTranscriptLines.length > 0 && !vm.showWrap && (
        <div
          style={css(
            "position:absolute;left:120px;right:120px;bottom:42px;z-index:20;display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.96);border:1px solid var(--blue-400);border-radius:9999px;padding:9px 15px;box-shadow:var(--sh-modal);pointer-events:none"
          )}
        >
          <span style={css("display:flex;align-items:center;gap:6px;color:var(--blue-900);font-size:11.5px;font-weight:700;white-space:nowrap")}>
            <span style={css("width:8px;height:8px;border-radius:50%;background:var(--green-700);animation:recBlink 1.1s infinite")} />
            실시간 STT
          </span>
          <span style={css("display:flex;flex:1;min-width:0;gap:12px;overflow:hidden")}>
            {vm.liveTranscriptLines.slice(-2).map((line, index) => {
              const isAgent = line.speaker === "agent";
              return (
                <span
                  key={`${line.generation ?? 0}-${line.seq}-${line.speaker}-${line.at}`}
                  style={css(
                    "display:flex;gap:6px;min-width:0;flex:1;" +
                      (index > 0 ? "border-left:1px solid var(--gray-300);padding-left:12px" : "")
                  )}
                >
                  <b style={css("flex:none;font-size:11.5px;color:" + (isAgent ? "var(--green-900)" : "var(--blue-700)"))}>
                    {isAgent ? "상담원" : "고객"}
                  </b>
                  <span style={css("min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--gray-1000)")}>
                    {line.text}
                  </span>
                </span>
              );
            })}
          </span>
        </div>
      )}
      {/* 상단 알약 */}
      <div style={css("height:74px;flex:none;position:relative;z-index:5")}>
        {/* 알약 폭 = 콘텐츠 폭(빈 공간 없음). 이관 패널은 grid 0fr→1fr 트릭으로 알약이 부드럽게 길어진다 */}
        <div className="pill" style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);animation:fadeIn .7s ease-out .35s both")}>
          {vm.showWrap ? (
            /* 통화 종료 — 온에어 소등, 배경으로 남은 화면임을 알약이 말해준다 */
            <span style={css("display:flex;align-items:center;gap:7px;font:600 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-800)")} title="통화 종료 — 온에어 소등">
              <span className="onairdot off" />
              <span className="mi" style={css("font-size:14px;color:var(--green-700)")}>check_circle</span> 녹취 완료
            </span>
          ) : (
            <span style={css("display:flex;align-items:center;gap:7px;font:600 12px 'Avenir Next','Pretendard',sans-serif;color:var(--red-900)")} title="온에어 — 통화·녹취 중">
              <span className="onairdot" /> 녹취 중
            </span>
          )}
          {vm.isUrgent && (
            <span style={css("font:700 11px 'Avenir Next','Pretendard',sans-serif;color:#fff;background:var(--red-800);border-radius:9999px;padding:3px 9px")}>긴급</span>
          )}
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;align-items:center;gap:6px")}>
            <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>auto_awesome</span>
            {/* 라벨-값 분리: 라벨은 500, 값은 600 14px — 흘끗 보기에 값만 뜨도록 */}
            <span style={css("font:500 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>AI 배정</span>
            <span style={css("font:600 14px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.prepRoutingTitle}</span>
          </span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;align-items:center;gap:7px")} title="고객 감정온도">
            <span style={css("font:500 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>감정온도</span>
            <span className="lampdots">
              <i className={"g" + (vm.prepEmotionBars === 1 ? " lit" : "")} />
              <i className={"a" + (vm.prepEmotionBars === 2 ? " lit" : "")} />
              <i className={"r" + (vm.prepEmotionBars >= 3 ? " lit" : "")} />
            </span>
            <span style={css("font:600 14px 'Avenir Next','Pretendard',sans-serif;color:" + vm.prepEmotionFg)}>{vm.prepEmotionLabel}</span>
          </span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;align-items:center;gap:5px")}>
            <span className="mi" style={css("font-size:15px;color:" + vm.prepRiskFg)}>gpp_maybe</span>
            <span style={css("font:500 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>사고 징후</span>
            <span style={css("font:600 14px 'Avenir Next','Pretendard',sans-serif;color:" + vm.prepRiskFg)}>{vm.prepRiskLabel}</span>
          </span>
          <span style={css("font:500 15px 'Geist Mono','IBM Plex Mono',monospace")}>{vm.clockStr}</span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          {/* 이관 예약 상태 — 조작 버튼은 아래 통화 컨트롤(음소거 왼쪽 cbtn)로 옮겼고, 여기선 상태만 */}
          {vm.transferReserved && (
            <span style={css("display:flex;align-items:center;gap:5px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-900);background:var(--gray-100);border-radius:9999px;padding:3px 5px 3px 9px;white-space:nowrap")}>
              <span className="mi" style={css("font-size:13px")}>sync_alt</span> 이관 예약 · 종료 시 {vm.transferTarget ?? vm.suggestedDept}로
              <span onClick={vm.toggleTransferReserve} title="이관 예약 취소" style={css("cursor:pointer;display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:9999px;background:var(--gray-200)")}>
                <span className="mi" style={css("font-size:12px;color:var(--gray-600)")}>close</span>
              </span>
            </span>
          )}
          {held && (
            <span style={css("display:flex;align-items:center;gap:4px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--amber-900);background:var(--gray-100);border-radius:9999px;padding:3px 9px;white-space:nowrap")}>
              <span className="mi" style={css("font-size:13px")}>pause</span> 보류 중 · 고객에게 대기 안내
            </span>
          )}
          {vm.showWrap ? (
            /* 종료 후 — 통화 컨트롤 대신 후처리 보조 도구 */
            <span style={css("display:flex;gap:5px")}>
              <span
                className="cbtn"
                aria-disabled={vm.isExplicitLiveCall}
                title={vm.isExplicitLiveCall ? "녹음 파일 저장·재생은 아직 연결되지 않았습니다" : "녹취 다시 듣기"}
                style={vm.isExplicitLiveCall ? { cursor: "not-allowed", opacity: 0.42 } : undefined}
              ><span className="mi" style={css("font-size:19px")}>play_arrow</span></span>
              <span className="cbtn" title={summaryCopied ? "복사됨" : "통화 요약 복사"} onClick={copyWrapSummary}>
                <span className="mi" style={css("font-size:19px")}>{summaryCopied ? "check" : "content_copy"}</span>
              </span>
            </span>
          ) : (
          <span style={css("display:flex;gap:5px")}>
            {/* 이관 — 음소거 왼쪽. 예전처럼 통화 컨트롤과 같은 원형 버튼(cbtn). 클릭 시 부서 드롭다운 */}
            <span style={css("position:relative;display:inline-flex")}>
              <span
                className="cbtn"
                title="다른 부서로 이관 — 종료 시 예약"
                onClick={() => setTransferMenu((v) => !v)}
                style={vm.transferReserved ? { background: "var(--blue-700)", color: "#fff", borderColor: "var(--blue-700)" } : transferMenu ? { background: "var(--gray-100)" } : undefined}
              >
                <span className="mi" style={css("font-size:19px")}>sync_alt</span>
              </span>
              {transferMenu && (
                <>
                  <span onClick={() => setTransferMenu(false)} style={css("position:fixed;inset:0;z-index:40")} />
                  <div style={css("position:absolute;left:0;top:calc(100% + 6px);z-index:41;width:252px;background:var(--onair-surface);border-radius:10px;box-shadow:var(--sh-modal);overflow:hidden")}>
                    <div style={css("padding:9px 13px 7px;font:700 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);border-bottom:1px solid var(--gray-200)")}>이관 부서 선택 · 종료 시 예약</div>
                    {vm.transferReserved && (
                      <div onClick={() => { vm.toggleTransferReserve(); setTransferMenu(false); }} className="memorow" style={css("display:flex;align-items:center;gap:6px;padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--gray-100);color:var(--red-800)")}>
                        <span className="mi" style={css("font-size:15px")}>close</span>
                        <span style={css("font:600 12px 'Avenir Next','Pretendard',sans-serif")}>이관 예약 취소 · {vm.transferTarget ?? vm.suggestedDept}</span>
                      </div>
                    )}
                    <div onClick={() => { vm.reserveTransfer(); setTransferMenu(false); }} className="memorow" style={css("display:flex;align-items:center;gap:6px;padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--gray-100)")}>
                      <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>auto_awesome</span>
                      <span style={css("font:600 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>AI 추천 — {vm.suggestedDept}</span>
                    </div>
                    {vm.transferDepts.map((d) => (
                      <div key={d.name} onClick={() => { vm.reserveTransfer(d.name); setTransferMenu(false); }} className="memorow" style={css("display:flex;flex-direction:column;gap:1px;padding:8px 13px;cursor:pointer")}>
                        <span style={css("display:flex;align-items:center;gap:6px;font:600 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{d.name}<span style={css("font:400 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-500)")}>{d.state}</span></span>
                        <span style={css("font:400 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>{d.desc}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </span>
            <span
              className="cbtn"
              aria-disabled={vm.isExplicitLiveCall}
              title={vm.isExplicitLiveCall ? "음소거는 엣지 송신기 제어 연결 후 사용할 수 있습니다" : (muted ? "음소거 해제" : "음소거") + " · 단축키 M"}
              onClick={vm.isExplicitLiveCall ? undefined : () => setMuted((v) => !v)}
              style={vm.isExplicitLiveCall ? { cursor: "not-allowed", opacity: 0.42 } : muted ? { background: "var(--gray-1000)", color: "#fff", borderColor: "var(--gray-1000)" } : undefined}
            >
              <span className="mi" style={css("font-size:19px")}>{muted ? "mic_off" : "mic"}</span>
            </span>
            <span
              className="cbtn"
              aria-disabled={vm.isExplicitLiveCall}
              title={vm.isExplicitLiveCall ? "보류·대기 음원은 통화 오디오 제어 연결 후 사용할 수 있습니다" : (held ? "보류 해제" : "보류 — 고객에게 대기 멘트") + " · 단축키 H"}
              onClick={vm.isExplicitLiveCall ? undefined : () => setHeld((v) => !v)}
              style={vm.isExplicitLiveCall ? { cursor: "not-allowed", opacity: 0.42 } : held ? { background: "var(--amber-700)", color: "#fff", borderColor: "var(--amber-700)" } : undefined}
            >
              <span className="mi" style={css("font-size:19px")}>{held ? "play_arrow" : "pause"}</span>
            </span>
          </span>
          )}
          {!vm.showWrap && (
          <span data-tour="call-end" style={css("position:relative")}>
            <span
              title="통화 종료"
              onClick={() => setEndConfirm((v) => !v)}
              style={css("width:38px;height:38px;border-radius:9999px;background:var(--red-800);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer")}
            >
              <span className="mi" style={css("font-size:20px")}>call_end</span>
            </span>
            {/* 오클릭 방지 — 종료는 한 번 더 묻는다 */}
            {endConfirm && (
              <div style={css("position:absolute;top:48px;right:0;width:220px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);padding:13px 14px;z-index:40;animation:dockDown .15s cubic-bezier(0.2,0.8,0.2,1)")}>
                <div style={css("font:700 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:9px")}>통화를 종료할까요?</div>
                <div style={css("display:flex;gap:6px")}>
                  <span onClick={vm.endCall} style={css("flex:1;text-align:center;padding:7px 0;border-radius:9999px;background:var(--red-800);color:#fff;font:700 12px 'Avenir Next','Pretendard',sans-serif;cursor:pointer")}>종료</span>
                  <span onClick={() => setEndConfirm(false)} style={css("flex:1;text-align:center;padding:7px 0;border-radius:9999px;background:var(--gray-100);color:var(--gray-900);font:600 12px 'Avenir Next','Pretendard',sans-serif;cursor:pointer")}>계속 통화</span>
                </div>
              </div>
            )}
          </span>
          )}
        </div>
      </div>

      <div style={css("flex:1;display:flex;gap:16px;min-height:0;padding:16px 16px " + (vm.showWrap ? "16px" : "42px") + " 16px")}>
        {/* ── 좌 컬럼 ── (안착 morph — 왼쪽 가장자리에서 스르륵 등장) */}
        <div ref={leftColRef} data-tour="call-left" style={css("width:320px;flex:none;display:flex;flex-direction:column;gap:14px;min-height:0;overflow-y:auto;overflow-x:hidden;animation:consoleInL .52s cubic-bezier(.2,.8,.2,1) .44s both")}>
          <div className="card" style={css("padding:13px 15px;display:flex;align-items:center;gap:12px" + (vm.verified ? ";opacity:.93" : ""))}>
            <span className="av" style={css("width:42px;height:42px")}><span className="mi" style={css("font-size:22px")}>headset_mic</span></span>
            <div style={css("flex:1;min-width:0")}>
              <div style={css("display:flex;align-items:center;gap:6px")}>
                <span style={css("font-weight:700;font-size:15px")}>{AGENT.role} {AGENT.name}</span>
                <span style={css("width:7px;height:7px;border-radius:9999px;background:var(--gray-500);animation:recBlink 1.1s infinite")} />
                <span style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>통화 중</span>
              </div>
              <div style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-top:1px")}>{AGENT.dept} · {AGENT.tenure} · {AGENT.id}</div>
            </div>
            <div style={css("text-align:right;flex:none;padding-left:10px;border-left:1px solid var(--gray-200)")}>
              <div style={css("font:700 16px 'Geist Mono','IBM Plex Mono',monospace;color:var(--blue-700)")}>12</div>
              <div className="lbl">오늘 후처리</div>
            </div>
          </div>

          {/* 고객 카드 + 본인인증 (1d) — 본인확인 전에는 광원이 여기에 있다 */}
          {/* 인증 전에는 인증 폼 높이(≈418px) 고정으로 흔들림 방지, 인증 후에는 내용만큼 */}
          <div className="card" style={css("padding:16px" + (vm.verified ? "" : ";min-height:418px") + (focus === "customer" ? ";box-shadow:var(--sh-focus)" : ""))}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;margin-bottom:12px")}>
              <span className="sechd">고객</span>
              {/* 개인정보 안내 배지 — 경고가 아니라 중립 정보라 회색 톤 + 자물쇠 아이콘으로 */}
              <span style={css("display:inline-flex;align-items:center;gap:4px;font:500 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);background:var(--gray-100);border:1px solid var(--gray-200);border-radius:9999px;padding:3px 10px")}>
                <span className="mi" style={css("font-size:12px")}>lock</span>고객 동의 시 열람
              </span>
            </div>
            <div style={css("display:flex;align-items:center;gap:12px")}>
              <span className="av" style={css("width:46px;height:46px")}><span className="mi" style={css("font-size:26px")}>person</span></span>
              <div>
                <div style={css("font-weight:700;font-size:18px;line-height:1.2")}>{vm.customerName}</div>
                <div style={css("font:400 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-top:2px")}>
                  {vm.customerType} · 발신 <span style={css("font-family:'Geist Mono','IBM Plex Mono',monospace")}>{vm.customerPhone}</span>
                </div>
              </div>
            </div>

            {vm.arsDigits && (
              <div style={css("margin-top:12px;display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--blue-400);background:var(--blue-50,#eef4ff);border-radius:8px")}>
                <span className="mi" style={css("font-size:18px;color:var(--blue-700)")}>dialpad</span>
                <div style={css("flex:1;min-width:0")}>
                  <div style={css("display:flex;align-items:center;gap:6px") }>
                    <span style={css("font:700 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-900)")}>고객 키패드 입력 수신</span>
                    <span style={css("font:500 10px 'Avenir Next','Pretendard',sans-serif;color:" + (vm.dtmfPersisted ? "var(--green-700)" : "var(--red-800)"))}>
                      {vm.dtmfPersisted ? "서버 저장됨" : "저장 확인 필요"}
                    </span>
                  </div>
                  <div style={css("font:600 13px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-1000);margin-top:2px;letter-spacing:2px")}>{vm.dtmfMasked}</div>
                </div>
                {!vm.verified && (
                  <span
                    onClick={vm.canApplyDtmfToAuth ? vm.applyDtmfToAuth : undefined}
                    style={css("flex:none;border-radius:9999px;padding:6px 9px;background:var(--onair-surface);border:1px solid var(--blue-400);font:700 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-700);cursor:" + (vm.canApplyDtmfToAuth ? "pointer" : "not-allowed"))}
                  >
                    대조값에 적용
                  </span>
                )}
              </div>
            )}

            {vm.verified ? (
              <div style={css("margin-top:13px;background:var(--gray-100);border-radius:8px;overflow:hidden")}>
                <div style={css("display:flex;align-items:center;gap:9px;padding:10px 12px;border-bottom:1px solid var(--gray-300)")}>
                  <span style={css("width:22px;height:22px;border-radius:9999px;background:var(--green-900);color:#fff;display:flex;align-items:center;justify-content:center")}>
                    <span className="mi" style={css("font-size:15px")}>check</span>
                  </span>
                  <div style={css("flex:1")}>
                    <span style={css("font:700 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--green-900)")}>본인인증 완료</span>
                    <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--green-600);margin-left:6px")}>{vm.authTime}</span>
                  </div>
                  <span onClick={vm.resetAuth} style={css("display:flex;align-items:center;gap:2px;font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);cursor:pointer")}>
                    재인증 <span className="mi" style={css("font-size:15px")}>restart_alt</span>
                  </span>
                </div>
                <div style={css("padding:10px 12px;font:400 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>
                  {vm.authMethodLabel} · 일치 <span style={css("color:var(--gray-600)")}>(입력 자동 대조)</span>
                </div>
              </div>
            ) : (
              <div style={css("margin-top:13px;background:var(--gray-100);border:1px solid var(--gray-300);border-radius:8px;padding:12px")}>
                {/* 대기 상태 — 틴트 없이 중립(잉크·그레이). 점으로 '진행 필요' 신호 */}
                <div style={css("display:flex;align-items:center;gap:6px;font:700 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:3px")}>
                  <span style={css("width:7px;height:7px;border-radius:9999px;background:var(--gray-500)")} />
                  본인확인 · 미완료
                </div>
                <div style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:11px")}>
                  고객이 말한 <span style={css("font-weight:700;color:var(--blue-900)")}>생년월일 8자리</span>(YYYYMMDD)를 빈칸에 입력하면 자동 대조됩니다
                </div>
                {/* 8칸이라 가로가 넓다 — 세로로 쌓아 대조 버튼이 오른쪽으로 잘리지 않게 한다 */}
                <div style={css("display:flex;flex-direction:column;gap:10px;align-items:stretch")}>
                  {/* 자릿수만큼 개별 상자(OTP 스타일) — 전체 번호 마스킹 없이 '몇 자리를 칠지'가 모양으로 보인다.
                      실제 입력은 상자 위 투명 input 하나가 받고, 상자는 값을 비춰 그린다 */}
                  <label style={css("position:relative;display:flex;gap:5px;cursor:text;align-self:flex-start")}>
                    {Array.from({ length: vm.authMaxLen }).map((_, bi) => {
                      const ch = vm.authInput[bi] ?? "";
                      const cur = authFocused && bi === Math.min(vm.authInput.length, vm.authMaxLen - 1);
                      return (
                        <span
                          key={bi}
                          style={css(
                            "width:" + (vm.authMaxLen >= 8 ? "27px" : vm.authMaxLen === 6 ? "29px" : "38px") +
                              ";height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font:700 16px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-1000);background:var(--onair-surface);box-sizing:border-box;transition:border-color .15s;border:1.5px " +
                              (cur ? "solid var(--blue-700)" : ch ? "solid var(--gray-500)" : "dashed var(--gray-400)")
                          )}
                        >
                          {ch}
                        </span>
                      );
                    })}
                    <input
                      className="authin"
                      value={vm.authInput}
                      onChange={vm.onAuthInput}
                      onFocus={() => setAuthFocused(true)}
                      onBlur={() => setAuthFocused(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") vm.runVerify();
                      }}
                      maxLength={vm.authMaxLen}
                      inputMode="numeric"
                      style={css("position:absolute;inset:0;width:100%;height:100%;opacity:0;border:none;outline:none;padding:0;cursor:text;caret-color:transparent")}
                    />
                  </label>
                  <span onClick={vm.runVerify} style={css("display:flex;align-items:center;justify-content:center;padding:9px 16px;background:var(--blue-700);color:#fff;border-radius:9999px;font:700 12.5px 'Avenir Next','Pretendard',sans-serif;cursor:pointer")}>대조</span>
                </div>
                {vm.authErr && (
                  <div style={css("margin-top:7px;display:flex;align-items:center;gap:4px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--red-800)")}>
                    <span className="mi" style={css("font-size:13px")}>error</span>
                    {vm.authErrMsg}
                  </div>
                )}
                <div style={css("display:flex;align-items:center;gap:5px;margin-top:9px;font:400 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
                  <span className="mi" style={css("font-size:13px")}>lock</span> 원문은 표시되지 않으며 입력값과 자동 대조됩니다
                </div>
              </div>
            )}

            <div style={css("margin-top:12px")}>
              <div style={css("font:700 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>
                고객 상세 조회 <span style={css("font-weight:400;color:var(--gray-600)")}>· 본인인증 후 열람</span>
              </div>
              {vm.verified ? (
                <div style={css("display:flex;flex-direction:column;gap:7px")}>
                  <span onClick={() => setShowHistory((prev) => !prev)} className="qlink" style={css("cursor:pointer" + (showHistory ? ";border-color:var(--blue-400);color:var(--blue-700);font-weight:700" : ""))}>
                    과거 상담 이력 <span className="mi" style={css("font-size:17px" + (showHistory ? "" : ";color:var(--gray-600)"))}>{showHistory ? "expand_less" : "expand_more"}</span>
                  </span>
                  <span onClick={() => setShowAccounts((prev) => !prev)} className="qlink" style={css("cursor:pointer" + (showAccounts ? ";border-color:var(--blue-400);color:var(--blue-700);font-weight:700" : ""))}>
                    보유 계좌 및 카드 현황 <span className="mi" style={css("font-size:17px" + (showAccounts ? "" : ";color:var(--gray-600)"))}>{showAccounts ? "expand_less" : "expand_more"}</span>
                  </span>
                </div>
              ) : (
                <div style={css("display:flex;flex-direction:column;gap:7px;opacity:.6")}>
                  <span className="qlink" style={css("border-color:var(--gray-200);background:var(--gray-100);color:var(--gray-600)")}>과거 상담 이력 <span className="mi" style={css("font-size:16px")}>lock</span></span>
                  <span className="qlink" style={css("border-color:var(--gray-200);background:var(--gray-100);color:var(--gray-600)")}>보유 계좌 및 카드 현황 <span className="mi" style={css("font-size:16px")}>lock</span></span>
                </div>
              )}
            </div>
          </div>

          {vm.verified && showHistory && (
            <div className="card" style={css("flex:none;display:flex;flex-direction:column;overflow:hidden;animation:dockDown .25s cubic-bezier(0.2,0.8,0.2,1)")}>
              <div style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px dashed var(--color-border)")}>
                <span className="sechd">과거 상담 이력</span>
                <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>최근 6개월 · {HISTORY.length}건</span>
              </div>
              {/* 타임라인 — 불릿이 세로선으로 이어져 시간의 흐름을 만든다 */}
              <div style={css("overflow:auto;padding:6px 15px 4px")}>
                {HISTORY.map((h, i) => (
                  <div key={i} style={css("display:flex;gap:11px")}>
                    <div style={css("display:flex;flex-direction:column;align-items:center;width:9px;flex:none")}>
                      <span style={css("width:9px;height:9px;border-radius:9999px;flex:none;margin-top:13px;box-sizing:border-box;" + (i === 0 ? "background:var(--blue-700)" : "border:1.5px solid var(--gray-500);background:var(--onair-surface)"))} />
                      {i < HISTORY.length - 1 && <span style={css("width:1.5px;flex:1;background:var(--gray-300);margin-bottom:-13px")} />}
                    </div>
                    <div style={css("flex:1;padding:8px 0 14px")}>
                      <div style={css("display:flex;align-items:center;gap:6px")}>
                        <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>{h.date}</span>
                        <span style={css("font:400 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>· {h.ago}</span>
                        {i === 0 && (
                          <span style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-900)")}>가장 최근</span>
                        )}
                        <span style={css("font:400 10px 'Avenir Next','Pretendard',sans-serif;color:var(--green-900);margin-left:auto;background:var(--gray-100);border-radius:9999px;padding:2px 8px")}>완결</span>
                      </div>
                      <div style={css("font:600 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);margin-top:3px")}>{h.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {vm.verified && showAccounts && (
            <div className="card" style={css("flex:none;display:flex;flex-direction:column;overflow:hidden;animation:dockDown .25s cubic-bezier(0.2,0.8,0.2,1)")}>
              <div style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px dashed var(--color-border)")}>
                <span className="sechd">보유 계좌 및 카드</span>
                <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>{ACCOUNTS.length}건 · 정상</span>
              </div>
              <div style={css("overflow:auto")}>
                {ACCOUNTS.map((a, i) => (
                  <div key={i} style={css("padding:10px 14px" + (i < ACCOUNTS.length - 1 ? ";border-bottom:1px solid var(--gray-200)" : ""))}>
                    <div style={css("display:flex;align-items:center;gap:7px")}>
                      <span style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-800);background:var(--gray-100);border-radius:9999px;padding:2px 8px;flex:none")}>{a.kind}</span>
                      <span style={css("font:600 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{a.name}</span>
                      <span style={css("font:400 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--green-900);margin-left:auto")}>정상</span>
                    </div>
                    <div style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700);margin-top:4px;padding-left:2px")}>
                      {a.no} · 개설 {a.opened}
                    </div>
                  </div>
                ))}
              </div>
              <div style={css("padding:8px 15px;border-top:1px solid var(--gray-200);font:400 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
                읽기 전용 · 고객 동의 하 열람
              </div>
            </div>
          )}
        </div>

        {/* ── 중 컬럼 ── (통화 연결 시 브리핑 카드가 먼저 제자리로 안착하고, 스크립트·메모는 뒤이어 아래서 올라온다) */}
        <div data-tour="call-center" style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:14px")}>
          {/* 안착 대상 — 준비 카드가 살짝 컸다가 딱 제자리로 가라앉는다(가장 먼저) */}
          <div className="card" style={css("flex:none;padding:15px 17px;animation:consoleSettle .5s cubic-bezier(.2,.8,.2,1) both")}>
            <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:9px")}>
              <BrandLogo size={14} symbolColor="var(--blue-700)" color="var(--gray-1000)" />
              <span style={css("font:700 12.5px 'Avenir Next','Pretendard',sans-serif;letter-spacing:.2px;color:var(--gray-500)")}>브리핑</span>
              <span style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>· {vm.summarySourceLabel}</span>
            </div>
            {/* 라우팅 배정 메타 — 이 카드가 자동 라우팅되어 온 것임을 어필: SGE(1층)·부서(2층)·업무유형(3층)·확신 */}
            <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:11px")}>
              <span style={css("display:inline-flex;align-items:center;gap:4px;font:700 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-700);background:var(--gray-100);border-radius:9999px;padding:3px 9px")}>
                <span className="mi" style={css("font-size:13px")}>alt_route</span>자동 라우팅
              </span>
              {(() => { const m = SGE_META[vm.prepSge]; return (
                <span title={m.desc} style={css("display:inline-flex;align-items:center;gap:5px;font:600 11px 'Avenir Next','Pretendard',sans-serif;background:var(--gray-100);border-radius:9999px;padding:3px 10px;color:" + m.fg)}>
                  <span style={css("width:6px;height:6px;border-radius:9999px;background:" + m.bar)} />SGE {vm.prepSge}·{m.label}
                </span>
              ); })()}
              <span style={css("display:inline-flex;align-items:center;gap:4px;font:600 11px 'Avenir Next','Pretendard',sans-serif;background:var(--gray-100);border-radius:9999px;padding:3px 10px;color:var(--gray-1000)")}>
                <span style={css("font-weight:500;color:var(--gray-600)")}>부서</span>{vm.prepRoutingTitle}
              </span>
              <span style={css("display:inline-flex;align-items:center;gap:4px;font:600 11px 'Avenir Next','Pretendard',sans-serif;background:var(--gray-100);border-radius:9999px;padding:3px 10px;color:var(--gray-1000)")}>
                <span style={css("font-weight:500;color:var(--gray-600)")}>업무</span>{vm.prepBusinessType}
              </span>
              {vm.prepConfidencePct != null && (
                <span style={css("display:inline-flex;align-items:baseline;gap:4px;font:600 11px 'Avenir Next','Pretendard',sans-serif;background:var(--gray-100);border-radius:9999px;padding:3px 10px;color:var(--gray-1000)")}>
                  <span style={css("font-weight:500;color:var(--gray-600)")}>확신</span>{vm.prepConfidencePct}%
                </span>
              )}
            </div>
            {/* 라우팅 근거 — 왜 이 부서로 왔는지 한 줄 */}
            <div style={css("display:flex;gap:6px;align-items:baseline;margin-bottom:11px;font:400 11.5px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
              <span className="mi" style={css("font-size:13px;color:var(--gray-500);transform:translateY(2px)")}>subdirectory_arrow_right</span>
              <span>근거 · {vm.prepRoutingReason}</span>
            </div>
            {/* 카드의 주인 문장 — Title 18px: 통화 시작 순간 첫 시선이 꽂히는 곳 */}
            <div style={css("font:600 18px/1.4 'Avenir Next','Pretendard',sans-serif;letter-spacing:-.2px;color:var(--gray-1000);margin-bottom:11px")}>{vm.prepHeadline}</div>
            {/* 전화 요약 — 고객 발화 STT를 요약한 내용(대화 요약) */}
            <div style={css("display:flex;align-items:center;gap:5px;font:700 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:9px")}>
              <span className="mi" style={css("font-size:14px;color:var(--gray-500)")}>summarize</span>전화 요약 <span style={css("font:400 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-500)")}>· 고객 발화 STT 요약</span>
            </div>
            <div style={css("display:flex;flex-direction:column;gap:8px")}>
              {vm.summaryPoints.map((t, i) => (
                <div key={i} style={css("display:flex;gap:10px;align-items:baseline")}>
                  <span style={css("flex:none;width:5px;height:5px;border-radius:9999px;background:var(--gray-500);transform:translateY(-2px)")} />
                  <span style={css("font:400 14px/1.55 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 단계별 스크립트 — 아코디언. 초보 상담사용 기초 안내라 기본 접힘, 헤더 클릭으로 펼침 (카드 안착 후 아래서 등장) */}
          <div className="card" style={css("flex:none;min-height:0;display:flex;flex-direction:column;overflow:hidden;animation:consoleInUp .48s cubic-bezier(.2,.8,.2,1) .5s both")}>
            <div
              onClick={() => setScriptOpen((v) => !v)}
              style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;user-select:none" + (scriptOpen ? ";border-bottom:1px dashed var(--color-border)" : ""))}
            >
              <span className="sechd" style={css("display:flex;align-items:center;gap:6px")}>
                <span className="mi" style={css("font-size:18px")}>menu_book</span> 단계별 상담 스크립트
                <span style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-500)")}>· {vm.steps.length}단계</span>
              </span>
              <span style={css("display:flex;align-items:center;gap:4px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
                {scriptOpen ? "접기" : "펼쳐 보기"}
                <span className="mi" style={css("font-size:18px;color:var(--gray-500);transition:transform .25s;transform:rotate(" + (scriptOpen ? 180 : 0) + "deg)")}>expand_more</span>
              </span>
            </div>
            {scriptOpen && (
              <div style={css("overflow:auto;max-height:320px;padding:14px 16px;display:flex;flex-direction:column;gap:9px")}>
                {vm.steps.map((st, i) => (
                  <div key={i} style={css("background:var(--gray-100);border-radius:8px;padding:11px 13px")}>
                    <div style={css("font:600 14px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:5px")}>{st.title}</div>
                    <div style={css("font:400 14px/1.6 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>{st.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 하단 메모 — 카드 안착 후 아래서 등장(래퍼가 애니메이션, 안쪽 카드는 미인증 딤 opacity 유지) */}
          <div style={css("flex:1;min-height:0;display:flex;flex-direction:column;animation:consoleInUp .48s cubic-bezier(.2,.8,.2,1) .6s both")}>
          <div className="card" style={css("flex:1;min-height:196px;display:flex;flex-direction:column" + (focus === "memo" ? ";box-shadow:var(--sh-focus)" : vm.verified ? "" : ";opacity:.93"))}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px dashed var(--color-border)")}>
              <span className="sechd" style={css("display:flex;align-items:center;gap:5px")}>
                <span className="mi" style={css("font-size:17px")}>edit_note</span> 상담원 메모
              </span>
              <span style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>불릿 자동 · 종료 시 후처리에 반영</span>
            </div>
            {/* 빈 영역을 클릭해도 바로 입력 — placeholder 영역이 입력처럼 안 보이던 문제 해소 */}
            <div
              ref={memoListRef}
              onClick={(e) => {
                if (e.target === e.currentTarget || vm.memoEmpty) memoInputRef.current?.focus();
              }}
              style={css("flex:1;overflow:auto;padding:10px 16px;display:flex;flex-direction:column;gap:6px;cursor:text")}
            >
              {/* 스페이서 — 메모가 적을 땐 목록을 입력창 쪽(아래)으로 민다. 새 메모 = 항상 입력창 바로 위 */}
              <div style={css("flex:1")} />
              {vm.memoItems.map((m, i) => (
                <div key={i} className="memorow" style={css("display:flex;gap:8px;align-items:baseline")}>
                  <span style={css("color:var(--blue-700);font-weight:700;flex:none")}>•</span>
                  {editIdx === i ? (
                    <input
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          vm.updateMemo(i, editText);
                          setEditIdx(null);
                        }
                      }}
                      onBlur={() => setEditIdx(null)}
                      style={css("flex:1;min-width:0;border:none;outline:none;border-bottom:1px solid var(--blue-400);font:400 14px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);background:transparent;padding:0")}
                    />
                  ) : (
                    <>
                      <span style={css("flex:1;min-width:0;font:400 14px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{m}</span>
                      {/* 수정·삭제 — 행에 올렸을 때만 드러난다 (memorow:hover) */}
                      <span className="memoact" style={css("display:flex;gap:2px;flex:none;align-self:center")}>
                        <span
                          className="mi"
                          title="수정 · Enter 저장, Esc 취소"
                          onClick={() => {
                            setEditIdx(i);
                            setEditText(m);
                          }}
                          style={css("font-size:15px;color:var(--gray-600);cursor:pointer;padding:2px")}
                        >edit</span>
                        <span
                          className="mi"
                          title="삭제"
                          onClick={() => vm.removeMemo(i)}
                          style={css("font-size:15px;color:var(--gray-600);cursor:pointer;padding:2px")}
                        >close</span>
                      </span>
                    </>
                  )}
                </div>
              ))}
              {vm.memoEmpty && (
                <div style={css("font:400 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-500)")}>특이사항을 입력하면 불릿으로 기록됩니다</div>
              )}
            </div>
            <div style={css("flex:none;display:flex;align-items:center;gap:8px;padding:9px 14px;border-top:1px solid var(--gray-200)")}>
              <span style={css("color:var(--blue-700);font-weight:700")}>•</span>
              <input
                ref={memoInputRef}
                value={vm.memoDraft}
                onChange={vm.onMemoDraft}
                onKeyDown={vm.onMemoKey}
                onFocus={() => setMemoFocused(true)}
                onBlur={() => setMemoFocused(false)}
                placeholder="메모 입력 후 Enter · 단축키 N"
                style={css("flex:1;border:none;outline:none;font:400 14px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);background:transparent")}
              />
            </div>
          </div>
          </div>
        </div>

        {/* ── 우 컬럼 : 규정 ── (안착 morph — 오른쪽 가장자리에서 스르륵 등장) */}
        {/* 오토레이아웃 모션 — 규정 패널 확장(372↔640)이 스냅 대신 부드럽게 밀린다 */}
        <div data-tour="call-right" style={css("width:" + (regWide ? 640 : 372) + "px;flex:none;display:flex;flex-direction:column;gap:14px;min-height:0;transition:width .35s cubic-bezier(0.2,0.8,0.2,1);animation:consoleInR .52s cubic-bezier(.2,.8,.2,1) .52s both")}>
          <div className="card" style={css("flex:" + (regWide ? "1" : "none") + ";min-height:0;display:flex;flex-direction:column;overflow:hidden" + (focus === "reg" ? ";box-shadow:var(--sh-focus)" : ";opacity:" + (vm.verified ? ".95" : ".9")))}>
            {/* 헤더 — 제목 + 상시 검색 input(한 element로 고정) + 확장 시 축소 버튼.
                검색 input이 여기 상주하므로 접힘↔확장·검색 유무가 바뀌어도 remount되지 않는다(한글 안 깨짐). */}
            <div style={css("display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px dashed var(--color-border)")}>
              <span className="sechd" style={css("display:flex;align-items:center;gap:5px;flex:none")}>
                <span className="mi" style={css("font-size:18px")}>gavel</span> 관련 규정
              </span>
              <span style={css("flex:1;min-width:0;display:flex;align-items:center;gap:6px;border:1px solid var(--gray-400);border-radius:9999px;padding:6px 11px;background:var(--onair-surface)")}>
                <span className="mi" style={css("font-size:16px;color:var(--gray-600)")}>search</span>
                <input
                  value={vm.regSearch}
                  onChange={vm.onRegSearch}
                  onFocus={vm.openManual}
                  placeholder={vm.regQuery || "규정 검색  (예: 만기 or 재약정)"}
                  style={css("flex:1;min-width:0;border:none;outline:none;background:transparent;font:400 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}
                />
                {vm.semLoading ? (
                  <Spinner size={15} speedMs={750} />
                ) : vm.regSearch ? (
                  <span className="mi" onClick={vm.clearRegSearch} style={css("font-size:15px;color:var(--gray-500);cursor:pointer;flex:none")}>close</span>
                ) : null}
              </span>
              {regWide && (
                <span onClick={vm.closeReg} title="규정집 축소 · 단축키 R" style={css("flex:none;display:inline-flex;align-items:center;gap:3px;font:600 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-700);border:1px solid var(--blue-400);border-radius:9999px;padding:5px 10px;cursor:pointer")}>
                  <span className="mi" style={css("font-size:15px")}>close_fullscreen</span> 축소
                </span>
              )}
            </div>

            {/* 실시간 추천 검색어 — 통화에서 언급된 규정 용어만, 나온 순서대로 하나씩 나타난다.
                누르면 그 용어로 즉시 검색, 다시 누르면 해제. 언급 전에는 줄 자체가 없다. */}
            {vm.regSuggests.length > 0 && (
              <div style={css("display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--gray-200)")}>
                <span style={css("display:inline-flex;align-items:center;gap:3px;font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);flex:none")}>
                  <span className="mi" style={css("font-size:13px;color:var(--blue-700)")}>graphic_eq</span>통화 중 언급
                </span>
                {vm.regSuggests.map((s2) => {
                  const on = vm.regSearch === s2.term;
                  return (
                    <span
                      key={s2.term}
                      onClick={() => vm.applyRegSearch(s2.term)}
                      title="규정에서 이 용어로 검색"
                      style={css(
                        "display:inline-flex;align-items:center;gap:4px;font:600 11.5px 'Avenir Next','Pretendard',sans-serif;border-radius:9999px;padding:4px 11px;cursor:pointer;white-space:nowrap;animation:fadeIn .3s ease-out;transition:background .15s,border-color .15s;" +
                          (on
                            ? "background:var(--blue-700);color:#fff;border:1px solid var(--blue-700)"
                            : "background:var(--onair-surface);color:var(--blue-900);border:1px solid var(--blue-700)")
                      )}
                    >
                      {!on && <span style={css("width:5px;height:5px;border-radius:9999px;background:var(--blue-700);flex:none")} />}
                      {s2.term}
                    </span>
                  );
                })}
              </div>
            )}

            {/* 검색 필터 — 엑셀 컬럼필터처럼. 확장 시에만. 문서유형·부서·시행일 드롭다운 + 표만 토글 */}
            {regWide && (
              <div style={css("display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--gray-200);background:var(--gray-100)")}>
                <span className="mi" style={css("font-size:15px;color:var(--gray-500)")}>filter_alt</span>
                <select
                  value={vm.regDocType ?? ""}
                  onChange={(e) => vm.setRegDocType(e.target.value || null)}
                  style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);background:var(--onair-surface);border:1px solid " + (vm.regDocType ? "var(--blue-400)" : "var(--gray-300)") + ";border-radius:9999px;padding:4px 8px;cursor:pointer;outline:none")}
                >
                  <option value="">문서유형 전체</option>
                  {REG_DOC_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
                <select
                  value={vm.regDeptFilter ?? ""}
                  onChange={(e) => vm.setRegDeptFilter(e.target.value || null)}
                  style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);background:var(--onair-surface);border:1px solid " + (vm.regDeptFilter ? "var(--blue-400)" : "var(--gray-300)") + ";border-radius:9999px;padding:4px 8px;cursor:pointer;outline:none")}
                >
                  <option value="">부서 전체 · 카드 자동</option>
                  {REG_DEPT_OPTS.map((d) => (<option key={d.code} value={d.code}>{d.label}</option>))}
                </select>
                <select
                  value={vm.regEffFrom ?? ""}
                  onChange={(e) => vm.setRegEffFrom(e.target.value || null)}
                  style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);background:var(--onair-surface);border:1px solid " + (vm.regEffFrom ? "var(--blue-400)" : "var(--gray-300)") + ";border-radius:9999px;padding:4px 8px;cursor:pointer;outline:none")}
                >
                  <option value="">시행일 전체</option>
                  {REG_EFF_OPTS.map((o) => (<option key={o.from} value={o.from}>{o.label}</option>))}
                </select>
                <span
                  onClick={() => vm.setRegTableOnly(!vm.regTableOnly)}
                  title="표(테이블) 청크만 보기"
                  style={css("display:inline-flex;align-items:center;gap:3px;font:600 11px 'Avenir Next','Pretendard',sans-serif;border-radius:9999px;padding:4px 10px;cursor:pointer;" + (vm.regTableOnly ? "background:var(--blue-700);color:#fff" : "background:var(--onair-surface);color:var(--gray-800);border:1px solid var(--gray-300)"))}
                >
                  <span className="mi" style={css("font-size:14px")}>table_rows</span>표만
                </span>
                {vm.regFilterCount > 0 && (
                  <span onClick={vm.clearRegFilters} style={css("display:inline-flex;align-items:center;gap:2px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);cursor:pointer;margin-left:auto")}>
                    <span className="mi" style={css("font-size:14px")}>filter_alt_off</span>필터 {vm.regFilterCount} 초기화
                  </span>
                )}
              </div>
            )}

            {!regWide ? (
              /* 내부 폭 고정 — 패널 width가 애니메이션되는 동안 텍스트가 재줄바꿈되며 끊겨 보이는 것을 방지 */
              <div style={css("flex:1;min-height:0;overflow:auto;width:372px;animation:fadeIn .25s ease-out")}>
                <div style={css("padding:11px 15px 0;display:flex;align-items:center;gap:5px;font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
                  <span className="mi" style={css("font-size:14px")}>info</span> 위에서 검색하면 규정 원문이 엑셀처럼 펼쳐집니다
                </div>
                <div style={css("padding:13px 15px;display:flex;flex-direction:column;gap:14px")}>
                  <div>
                    <div style={css("display:flex;align-items:center;gap:5px;font:700 11px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-700);margin-bottom:8px")}>
                      <span className="mi" style={css("font-size:14px")}>auto_awesome</span> 이번 상담 예상 규정 · AI 추천
                    </div>
                    <div style={css("display:flex;flex-direction:column;gap:9px")}>
                      {vm.knowledgeReferences.length ? (
                        vm.knowledgeReferences.map((reference, index) => (
                          <RegReco
                            key={reference.doc_id}
                            vm={vm}
                            title={`${reference.title} · ${reference.section}`}
                            body={reference.excerpt}
                            file={`${reference.source} · 관련도 ${Math.round(reference.score * 100)}%`}
                            row={index}
                          />
                        ))
                      ) : vm.regRecos.length ? (
                        vm.regRecos.map((r) => (
                          <RegReco key={r.title} vm={vm} title={r.title} body={r.body} file={r.file} row={r.row} query={r.query} />
                        ))
                      ) : (
                        <div style={css("font:400 12px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>
                          실측 추천 규정 없음 · 위 검색창에서 실제 규정 DB를 조회해 주세요.
                        </div>
                      )}
                    </div>
                  </div>
                  {!vm.isExplicitLiveCall && <div>
                    <div style={css("font:700 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:8px")}>규정집 파일 바로가기</div>
                    <div style={css("display:flex;flex-direction:column;gap:7px")}>
                      {vm.knowledgeReferences.map((reference) => (
                        <RegFile key={reference.doc_id} vm={vm} name={reference.source} />
                      ))}
                    </div>
                  </div>}
                </div>
              </div>
            ) : vm.regDoc || vm.regDocLoading ? (
              <RegDocSheet vm={vm} />
            ) : vm.regSearch.trim() ? (
              <RegCorpusSearchSheet vm={vm} />
            ) : (
              <div style={css("width:640px;flex:1;min-height:0;display:flex;flex-direction:column;animation:fadeIn .25s ease-out")}>
                {/* 시트 크롬 — 중립 그레이(틴트 금지). 검색·파일 업로드가 여기 산다 */}
                <div style={css("display:flex;align-items:center;gap:8px;padding:9px 14px;background:var(--gray-100);color:var(--gray-1000);border-bottom:1px solid var(--gray-300)")}>
                  <span className="mi" style={css("font-size:18px")}>grid_on</span>
                  <span style={css("font:600 12.5px 'Avenir Next','Pretendard',sans-serif")}>{vm.regFile}</span>
                  <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600)")}>· {vm.regSheet} 시트</span>
                  <span style={css("margin-left:auto;display:flex;align-items:center;gap:6px")}>
                    <label title="실제 규정 파일 열기 (CSV·XLSX)" style={css("display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--onair-surface);border:1px solid var(--gray-300);border-radius:9999px;padding:4px 10px;font:600 11px 'Avenir Next','Pretendard',sans-serif")}>
                      <span className="mi" style={css("font-size:14px")}>folder_open</span>파일 열기
                      <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void vm.loadManualFile(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </span>
                </div>
                {/* 3컬럼 리플로우 — 안내 멘트는 별도 컬럼이 아니라 내용 아래 인용 줄로.
                    가로 스크롤 없이 패널 폭에 맞는다 */}
                <div style={css("flex:1;min-height:0;overflow-y:auto;background:#fff")}>
                  <div style={css("display:flex;flex-direction:column")}>
                    <div style={css("display:flex;position:sticky;top:0;z-index:1")}>
                      <span style={css("width:36px;flex:none;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300)")} />
                      {vm.regCols.slice(0, 3).map((c, i) => (
                        <span key={i} style={css((i === 2 ? "flex:1;min-width:0" : "width:" + c.w + "px;flex:none") + ";padding:8px 10px;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300);font:700 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>{c.l}{i === 2 ? " · 안내 멘트" : ""}</span>
                      ))}
                    </div>
                    {vm.regRows.map((r) => {
                      /* '열기'로 진입한 조항은 행 전체가 강조된다 */
                      const hit = vm.regTargetRow != null && r.n === vm.regTargetRow + 1;
                      const ment = r.cells[3] && r.cells[3].text !== "—" ? r.cells[3].text : null;
                      return (
                        <div key={r.n} style={css("display:flex" + (hit ? ";box-shadow:inset 0 0 0 1.5px var(--gray-1000);position:relative;z-index:1" : ""))}>
                          <span style={css("width:36px;flex:none;padding:8px 0;text-align:center;border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-200);font:" + (hit ? "700" : "400") + " 11px 'Geist Mono','IBM Plex Mono',monospace;color:" + (hit ? "var(--gray-1000)" : "var(--gray-600)") + ";background:" + (hit ? "var(--gray-100)" : "var(--gray-100)"))}>{r.n}</span>
                          {r.cells.slice(0, 2).map((cell, ci) => (
                            <span key={ci} style={css("width:" + cell.w + "px;flex:none;padding:8px 10px;border-right:1px solid var(--gray-200);border-bottom:1px solid var(--gray-200);font:" + (hit ? "600" : "400") + " 12px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);background:" + (hit ? "var(--gray-100)" : "transparent"))}>{highlight(cell.text, vm.regSearch)}</span>
                          ))}
                          <span style={css("flex:1;min-width:0;padding:8px 10px;border-bottom:1px solid var(--gray-200);background:" + (hit ? "var(--gray-100)" : "transparent"))}>
                            <span style={css("display:block;font:" + (hit ? "600" : "400") + " 12px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{highlight(r.cells[2].text, vm.regSearch)}</span>
                            {ment && (
                              <span style={css("display:block;margin-top:4px;font:400 12px/1.5 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-700)")}>{highlight(ment, vm.regSearch)}</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                    {vm.regRows.length === 0 && (
                      <div style={css("padding:26px 0;text-align:center;font:400 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
                        “{vm.regSearch}” 검색 결과 없음 · 전체 {vm.regRowsTotal}행
                      </div>
                    )}
                  </div>
                </div>
                <div style={css("display:flex;align-items:center;gap:2px;padding:6px 10px;background:var(--gray-100);border-top:1px solid var(--gray-300)")}>
                  <span style={css("font:600 11.5px 'Avenir Next','Pretendard',sans-serif;background:#fff;border:1px solid var(--gray-300);border-bottom:none;border-radius:4px 4px 0 0;padding:5px 12px;color:var(--gray-1000)")}>{vm.regSheet}</span>
                  <span style={css("font:400 11.5px 'Avenir Next','Pretendard',sans-serif;padding:5px 12px;color:var(--gray-600)")}>Sheet2</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 접힌 후처리 시트의 가장자리 — 통화 중에도 "종료하면 여기서 이어진다"를 예고 */}
      {!vm.showWrap && (
        <div style={css("position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:1240px;height:34px;background:var(--onair-surface);border-radius:12px 12px 0 0;box-shadow:var(--sh-modal);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;animation:fadeIn .7s ease-out .45s both")}>
          <span style={css("width:40px;height:4px;border-radius:9999px;background:var(--color-border)")} />
          <span style={css("font:500 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>통화를 종료하면 여기서 후처리가 이어집니다</span>
        </div>
      )}
    </DesktopShell>
  );
}

// 엑셀 시트 룩 — 진짜 색(초록 헤더 + 행 줄무늬). '틴트 금지'는 흐릿한 회색빛만 금지, 엑셀 색은 허용.
const XL_HEAD = "#217346"; // 엑셀 그린 헤더
const XL_HEAD_FG = "#ffffff";
const XL_BAND = "#eef7f0"; // 짝수 행 옅은 초록
const XL_GRID = "#cfe3d5"; // 격자선
const XL_HIT = "#e9f2fe"; // 검색이 찾은 행(연파랑 강조)
const XL_GUT = "#f5f5f6"; // 행번호 거터 — 중립 그레이(초록 아님, 엑셀 행머리처럼)
/** 청크 원문의 내부 하드 줄바꿈을 공백으로 정규화 — "4호다목\n에"처럼 단어가 끊겨 보이는 것 방지.
 *  단, 빈 줄(문단 구분)은 살린다(줄바꿈 2개 이상 → 문단). */
function cleanChunk(t: string): string {
  return t
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}
/** 엑셀 행 배경 — 검색 히트=연파랑, 짝수=옅은 초록, 홀수=흰색 */
function xlRowBg(hit: boolean, i: number): string {
  return hit ? XL_HIT : i % 2 === 1 ? XL_BAND : "#fff";
}

/** 실제 규정 원문 열람 시트 — 검색 히트를 클릭하면 그 문서의 청크 전체를 엑셀 룩으로.
 *  강조 청크(검색에서 들어온 자리)로 자동 스크롤한다. */
function RegDocSheet({ vm }: { vm: CallFlowVM }) {
  const hitRef = useRef<HTMLDivElement | null>(null);
  // 상담원이 읽기엔 원문 전체가 너무 길다 — 기본은 검색이 찾은 청크 ± 맥락 2줄만, '전체 보기'로 펼친다
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [vm.regDoc, vm.regDocChunk]);
  useEffect(() => {
    hitRef.current?.scrollIntoView({ block: "center" });
  }, [vm.regDoc, vm.regDocChunk, showAll]);
  const doc = vm.regDoc;
  const chunks = doc?.chunks ?? [];
  const hitIdx = chunks.findIndex((c) => c.chunk_id === vm.regDocChunk);
  const WIN = 2; // 히트 앞뒤 맥락 줄 수
  const windowed = !showAll && hitIdx >= 0 && chunks.length > 2 * WIN + 1;
  const from = windowed ? Math.max(0, hitIdx - WIN) : 0;
  const to = windowed ? Math.min(chunks.length, hitIdx + WIN + 1) : chunks.length;
  return (
    <div style={css("width:640px;flex:1;min-height:0;display:flex;flex-direction:column;animation:fadeIn .25s ease-out")}>
      <div style={css("display:flex;align-items:center;gap:8px;padding:9px 14px;background:var(--gray-100);color:var(--gray-1000);border-bottom:1px solid var(--gray-300)")}>
        <span onClick={vm.closeRegDoc} title="검색 결과로 돌아가기" style={css("display:flex;align-items:center;gap:3px;cursor:pointer;background:var(--onair-surface);border:1px solid var(--gray-300);border-radius:9999px;padding:4px 10px;font:600 11px 'Avenir Next','Pretendard',sans-serif")}>
          <span className="mi" style={css("font-size:14px")}>arrow_back</span>검색
        </span>
        <span className="mi" style={css("font-size:18px")}>grid_on</span>
        <span style={css("font:600 12.5px 'Avenir Next','Pretendard',sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{doc ? doc.title : "원문 불러오는 중…"}</span>
        {doc && (
          <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600);flex:none")}>· {doc.version} · {doc.chunks.length}행</span>
        )}
        <span style={css("margin-left:auto;flex:none;font:400 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px")}>{doc?.source_file ?? ""}</span>
      </div>
      <div style={css("flex:1;min-height:0;overflow-y:auto;background:#fff")}>
        {!doc ? (
          <div style={css("padding:40px 0;display:flex;justify-content:center")}>
            <Spinner size={26} />
          </div>
        ) : (
          <div style={css("display:flex;flex-direction:column")}>
            {/* 엑셀 헤더 — 초록. 컬럼: 행번호 거터 · 섹션 · 내용 (p·구분 제거) */}
            <div style={css("display:flex;position:sticky;top:0;z-index:2")}>
              {[["#", 40], ["섹션", 160], ["내용", 0]].map(([l, w], i) => (
                <span key={i} style={{ ...css((w ? "width:" + w + "px;flex:none" : "flex:1;min-width:0") + ";padding:8px 10px;border-right:1px solid " + XL_GRID + ";font:700 12px 'Avenir Next','Pretendard',sans-serif"), background: XL_HEAD, color: XL_HEAD_FG }}>{l}</span>
              ))}
            </div>
            {/* 앞 생략분 — 눌러서 전체 펼치기 */}
            {windowed && from > 0 && (
              <div onClick={() => setShowAll(true)} className="memorow" style={css("display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 0;background:" + XL_GUT + ";border-bottom:1px solid " + XL_GRID + ";cursor:pointer;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-700)")}>
                <span className="mi" style={css("font-size:15px")}>unfold_more</span>앞 {from}행 더 보기
              </div>
            )}
            {chunks.slice(from, to).map((c, li) => {
              const ri = from + li;
              const hit = c.chunk_id === vm.regDocChunk;
              const bg = xlRowBg(hit, ri);
              return (
                <div key={c.chunk_id} ref={hit ? hitRef : undefined} style={css("display:flex" + (hit ? ";box-shadow:inset 0 0 0 1.5px var(--blue-700);position:relative;z-index:1" : ""))}>
                  <span style={{ ...css("width:40px;flex:none;padding:9px 0;text-align:center;border-right:1px solid " + XL_GRID + ";border-bottom:1px solid " + XL_GRID + ";font:" + (hit ? "700" : "400") + " 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-500)"), background: hit ? bg : XL_GUT }}>{ri + 1}</span>
                  <span style={{ ...css("width:160px;flex:none;padding:9px 10px;border-right:1px solid " + XL_GRID + ";border-bottom:1px solid " + XL_GRID + ";font:" + (hit ? "700" : "600") + " 11.5px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-800);overflow:hidden;text-overflow:ellipsis"), background: bg }}>{c.section ?? ""}</span>
                  <div style={{ ...css("flex:1;min-width:0;padding:9px 12px;border-bottom:1px solid " + XL_GRID), background: bg }}>
                    {c.kind === "table" ? (
                      <MiniTable raw={c.text} q={vm.regSearch} />
                    ) : (
                      <span style={css("font:" + (hit ? "600" : "400") + " 12.5px/1.7 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);white-space:pre-wrap")}>{highlight(cleanChunk(c.text), vm.regSearch)}</span>
                    )}
                  </div>
                </div>
              );
            })}
            {/* 뒤 생략분 */}
            {windowed && to < chunks.length && (
              <div onClick={() => setShowAll(true)} className="memorow" style={css("display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 0;background:" + XL_GUT + ";cursor:pointer;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-700)")}>
                <span className="mi" style={css("font-size:15px")}>unfold_more</span>뒤 {chunks.length - to}행 더 보기
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ ...css("display:flex;align-items:center;gap:6px;padding:6px 12px;background:" + XL_BAND + ";border-top:1px solid " + XL_GRID + ";font:400 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)") }}>
        <span className="mi" style={css("font-size:13px")}>table_view</span>
        {windowed ? "검색 위치 ± 맥락만 표시 중" : "규정 원문 · 파란 강조 = 검색 위치"}
        <span style={css("flex:1")} />
        {hitIdx >= 0 && chunks.length > 2 * WIN + 1 && (
          <span onClick={() => setShowAll((v) => !v)} style={css("display:inline-flex;align-items:center;gap:3px;font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-700);cursor:pointer")}>
            <span className="mi" style={css("font-size:14px")}>{showAll ? "unfold_less" : "unfold_more"}</span>{showAll ? "맥락만 보기" : "전체 " + chunks.length + "행 보기"}
          </span>
        )}
      </div>
    </div>
  );
}

/** 실제 코퍼스 검색 결과 시트 — 펼친 상태에서 검색어가 있으면 32개 문서 전체를 대상으로 한
 *  하이브리드 검색 결과를 엑셀 룩으로. 행 클릭 = 그 문서 원문 열람. */
function RegCorpusSearchSheet({ vm }: { vm: CallFlowVM }) {
  // 검색 결과에 걸린 서로 다른 파일들 — 하단에 엑셀 시트탭처럼 깔아 "여러 파일에서 나왔음"을 보여준다
  const files: typeof vm.semHits = [];
  const seen = new Set<string>();
  for (const h of vm.semHits) {
    if (!seen.has(h.doc_id)) {
      seen.add(h.doc_id);
      files.push(h);
    }
  }
  return (
    <div style={css("width:640px;flex:1;min-height:0;display:flex;flex-direction:column;animation:fadeIn .25s ease-out")}>
      {/* 검색 input은 패널 헤더에 상주 — 여기선 제목·건수만 (remount 방지) */}
      <div style={css("display:flex;align-items:center;gap:8px;padding:9px 14px;background:var(--gray-100);color:var(--gray-1000);border-bottom:1px solid var(--gray-300)")}>
        <span className="mi" style={css("font-size:18px")}>manage_search</span>
        <span style={css("font:600 12.5px 'Avenir Next','Pretendard',sans-serif")}>“{vm.regSearch}” 검색 결과</span>
        <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600)")}>{vm.semLoading ? "· 검색 중…" : "· " + vm.semHits.length + "건 · 파일 " + files.length + "개"}</span>
      </div>
      <div style={css("flex:1;min-height:0;overflow-y:auto;background:#fff")}>
        {vm.semLoading && vm.semHits.length === 0 ? (
          <div style={css("padding:40px 0;display:flex;flex-direction:column;align-items:center;gap:12px")}>
            <Spinner size={26} />
            <span style={css("font:400 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>규정에서 검색 중…</span>
          </div>
        ) : vm.semHits.length === 0 ? (
          <div style={css("padding:36px 0;text-align:center;font:400 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>“{vm.regSearch}” 검색 결과 없음</div>
        ) : (
        <div style={css("display:flex;flex-direction:column")}>
          {/* 엑셀 헤더 — 초록. 컬럼: 행번호 · 문서 · 내용 (p·구분 제거) */}
          <div style={css("display:flex;position:sticky;top:0;z-index:2")}>
            {[["#", 40], ["문서", 180], ["내용  (클릭 = 원문 열람)", 0]].map(([l, w], i) => (
              <span key={i} style={{ ...css((w ? "width:" + w + "px;flex:none" : "flex:1;min-width:0") + ";padding:8px 10px;border-right:1px solid " + XL_GRID + ";font:700 12px 'Avenir Next','Pretendard',sans-serif"), background: XL_HEAD, color: XL_HEAD_FG }}>{l}</span>
            ))}
          </div>
          {vm.semHits.map((h, ri) => {
            const bg = ri % 2 === 1 ? XL_BAND : "#fff";
            return (
            <div key={h.chunk_id} onClick={() => vm.openRegDocReal(h.doc_id, h.chunk_id)} style={css("display:flex;cursor:pointer")}>
              <span style={{ ...css("width:40px;flex:none;padding:9px 0;text-align:center;border-right:1px solid " + XL_GRID + ";border-bottom:1px solid " + XL_GRID + ";font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-500)"), background: XL_GUT }}>{ri + 1}</span>
              <span style={{ ...css("width:180px;flex:none;padding:9px 10px;border-right:1px solid " + XL_GRID + ";border-bottom:1px solid " + XL_GRID + ";font:600 11.5px/1.45 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis"), background: bg }}>{h.title}</span>
              <span style={{ ...css("flex:1;min-width:0;padding:9px 12px;border-bottom:1px solid " + XL_GRID + ";font:400 12.5px/1.65 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)"), background: bg }}>{highlight(stripPipes(h.excerpt), vm.regSearch)}</span>
            </div>
            );
          })}
        </div>
        )}
      </div>
      {/* 하단 시트탭 — 검색이 걸린 파일들을 엑셀 탭처럼. 탭 클릭 = 그 파일 원문 열람 */}
      <div style={css("display:flex;align-items:center;gap:3px;padding:5px 10px;background:var(--gray-100);border-top:1px solid " + XL_GRID + ";overflow-x:auto")}>
        <span className="mi" style={css("font-size:14px;color:var(--gray-500);flex:none")}>folder</span>
        <span style={css("flex:none;font:400 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-right:5px")}>매칭 {files.length}개</span>
        {files.map((f) => (
          <span
            key={f.doc_id}
            onClick={() => vm.openRegDocReal(f.doc_id, f.chunk_id)}
            title={f.title + " 원문 열기"}
            style={css("flex:none;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 11px 'Avenir Next','Pretendard',sans-serif;background:#fff;border:1px solid " + XL_GRID + ";border-bottom:none;border-radius:5px 5px 0 0;padding:5px 12px;color:var(--gray-1000);cursor:pointer")}
          >
            {f.title}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 표(마크다운) 청크를 실제 격자로 — 파이프 제거, 상담사가 읽기 편한 표. 첫 행=머리글 */
function MiniTable({ raw, q }: { raw: string; q: string }) {
  const rows = parseMdTable(raw);
  if (!rows.length) return <span style={css("font:400 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{stripPipes(raw)}</span>;
  return (
    <div style={{ border: "1px solid " + XL_GRID, borderRadius: 6, overflow: "hidden", maxWidth: "100%" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
        <tbody>
          {rows.map((cells, ri) => (
            <tr key={ri}>
              {cells.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    border: "1px solid " + XL_GRID,
                    padding: "5px 8px",
                    verticalAlign: "top",
                    wordBreak: "break-word",
                    // 헤더 행=엑셀 그린, 짝수 데이터 행=옅은 초록 줄무늬
                    background: ri === 0 ? XL_HEAD : ri % 2 === 0 ? XL_BAND : "#fff",
                    font: (ri === 0 ? "700" : "400") + " 11.5px/1.5 'Avenir Next','Pretendard',sans-serif",
                    color: ri === 0 ? XL_HEAD_FG : "var(--gray-1000)",
                  }}
                >
                  {cell ? highlight(cell, q) : ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegReco({ vm, title, body, file, row, query }: { vm: CallFlowVM; title: string; body: string; file: string; row: number | null; query?: string | null }) {
  // 열기 — 픽스처(row 있음)는 규정집 시트의 그 행을 강조, 실제 RAG 추천(row 없음)은
  // 규정집 의미검색으로 그 문서를 찾아 보여준다. 둘 다 없으면 버튼을 숨긴다.
  const open = row != null ? () => vm.openManualAt(row) : query ? () => vm.openRegQuery(query) : null;
  return (
    <div style={css("background:var(--gray-100);border-radius:8px;padding:11px 13px")}>
      <div style={css("font:700 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:5px")}>{title}</div>
      <div style={css("font:400 12px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>{body}</div>
      <div style={css("display:flex;align-items:center;justify-content:space-between;margin-top:8px")}>
        <span style={css("font:400 10.5px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600)")}>{file}</span>
        {/* 열기 — 픽스처(row 있음)는 규정집 시트의 그 행을 강조, 실제 RAG 추천(row 없음)은
             규정집 의미검색(query)으로 그 문서를 찾아 보여준다. 둘 다 없으면 버튼을 숨긴다. */}
        {open && (
          <span onClick={open} style={css("display:inline-flex;align-items:center;gap:4px;font:600 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-700);border:1px solid var(--blue-400);background:var(--onair-surface);border-radius:9999px;padding:4px 11px;cursor:pointer")}>
            <span className="mi" style={css("font-size:14px")}>open_in_new</span> 열기
          </span>
        )}
      </div>
    </div>
  );
}

function RegFile({ vm, name }: { vm: CallFlowVM; name: string }) {
  return (
    <span onClick={vm.openManual} style={css("display:flex;align-items:center;gap:8px;background:var(--gray-100);border-radius:9999px;padding:9px 14px;font:600 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);cursor:pointer")}>
      <span style={css("flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{name}</span>
      <span className="mi" style={css("font-size:16px;color:var(--gray-600)")}>open_in_new</span>
    </span>
  );
}
