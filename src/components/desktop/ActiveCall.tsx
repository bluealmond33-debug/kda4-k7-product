import { useEffect, useRef, useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import { AGENT } from "../../data/demoContent";
import DesktopShell from "./DesktopShell";

const HISTORY = [
  { date: "2026.07.02", label: "카드 › 분실신고" },
  { date: "2026.05.18", label: "수신 › 이체한도 상향" },
  { date: "2026.03.09", label: "전자금융 › OTP 재발급" },
  { date: "2026.02.14", label: "대출 › 상환일정 문의" },
];

const ACCOUNTS = [
  { kind: "입출금", name: "키움 주거래 통장", no: "***-**-4821", opened: "2019.03.11" },
  { kind: "적금", name: "키움 자유적금", no: "***-**-7745", opened: "2022.06.01" },
  { kind: "체크카드", name: "키움 체크카드", no: "****-****-**-2231", opened: "2019.03.11" },
  { kind: "대출", name: "신용대출", no: "***-**-9902", opened: "2024.01.20" },
];

/** 1a — 통화 중. 좌: 상담사·고객(본인인증 1d)·이력 / 중: 요약·스크립트·메모 / 우: 규정. */
export default function ActiveCall({ vm }: { vm: CallFlowVM }) {
  const [showHistory, setShowHistory] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  // 메모 인라인 수정 — editIdx 행이 input으로 바뀐다
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const memoInputRef = useRef<HTMLInputElement | null>(null);

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

  // 키보드 단축키 — 입력 중에는 무시(Esc 제외). M 음소거 / H 보류 / T 이관 예약 / R 규정집 / N 메모
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
      const k = e.key.toLowerCase();
      if (k === "m") setMuted((v) => !v);
      else if (k === "h") setHeld((v) => !v);
      else if (k === "t") vm.toggleTransferReserve();
      else if (k === "r") (vm.regCollapsed ? vm.openManual : vm.closeReg)();
      else if (k === "n") {
        e.preventDefault();
        memoInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vm]);
  return (
    <DesktopShell flex>
      {/* 상단 알약 */}
      <div style={css("height:74px;flex:none;position:relative;z-index:5")}>
        <div className="pill" style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:1004px")}>
          <span style={css("display:flex;align-items:center;gap:7px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--red-900)")} title="온에어 — 통화·녹취 중">
            <span className="onairdot" /> 녹취 중
          </span>
          {vm.isUrgent && (
            <span style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:#fff;background:var(--red-800);border-radius:9999px;padding:3px 9px")}>긴급</span>
          )}
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;align-items:center;gap:6px")}>
            <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>auto_awesome</span>
            <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>AI 배정</span>
            <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.prepRoutingTitle}</span>
          </span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;align-items:center;gap:7px")} title="고객 감정온도">
            <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>감정온도</span>
            <span className="lampdots">
              <i className={"g" + (vm.prepEmotionBars === 1 ? " lit" : "")} />
              <i className={"a" + (vm.prepEmotionBars === 2 ? " lit" : "")} />
              <i className={"r" + (vm.prepEmotionBars >= 3 ? " lit" : "")} />
            </span>
            <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepEmotionFg)}>{vm.prepEmotionLabel}</span>
          </span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;align-items:center;gap:5px")}>
            <span className="mi" style={css("font-size:15px;color:" + vm.prepRiskFg)}>gpp_maybe</span>
            <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>사고 징후</span>
            <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepRiskFg)}>{vm.prepRiskLabel}</span>
          </span>
          <span style={css("margin-left:auto;font:500 15px 'Geist Mono','IBM Plex Mono',monospace")}>{vm.clockStr}</span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          {vm.transferReserved && (
            <span style={css("display:flex;align-items:center;gap:4px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-900);background:var(--gray-100);border-radius:9999px;padding:3px 9px;white-space:nowrap")}>
              <span className="mi" style={css("font-size:13px")}>sync_alt</span> 이관 예약 · 종료 시 인계
            </span>
          )}
          {held && (
            <span style={css("display:flex;align-items:center;gap:4px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);background:var(--gray-100);border-radius:9999px;padding:3px 9px;white-space:nowrap")}>
              <span className="mi" style={css("font-size:13px")}>pause</span> 보류 중 · 고객에게 대기 안내
            </span>
          )}
          <span style={css("display:flex;gap:5px")}>
            <span
              className="cbtn"
              title={(muted ? "음소거 해제" : "음소거") + " · 단축키 M"}
              onClick={() => setMuted((v) => !v)}
              style={muted ? { background: "var(--gray-1000)", color: "#fff", borderColor: "var(--gray-1000)" } : undefined}
            >
              <span className="mi" style={css("font-size:19px")}>{muted ? "mic_off" : "mic"}</span>
            </span>
            <span
              className="cbtn"
              title={(held ? "보류 해제" : "보류 — 고객에게 대기 멘트") + " · 단축키 H"}
              onClick={() => setHeld((v) => !v)}
              style={held ? { background: "var(--amber-700)", color: "#fff", borderColor: "var(--amber-700)" } : undefined}
            >
              <span className="mi" style={css("font-size:19px")}>{held ? "play_arrow" : "pause"}</span>
            </span>
            <span
              className="cbtn"
              title={(vm.transferReserved ? "이관 예약 취소" : "이관 예약 — 통화를 끊지 않고 종료 시 인계") + " · 단축키 T"}
              onClick={vm.toggleTransferReserve}
              style={vm.transferReserved ? { background: "var(--blue-700)", color: "#fff", borderColor: "var(--blue-700)" } : undefined}
            >
              <span className="mi" style={css("font-size:19px")}>phone_forwarded</span>
            </span>
          </span>
          <span style={css("position:relative")}>
            <span
              title="통화 종료"
              onClick={() => setEndConfirm((v) => !v)}
              style={css("width:38px;height:38px;border-radius:9999px;background:var(--red-800);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer")}
            >
              <span className="mi" style={css("font-size:20px")}>call_end</span>
            </span>
            {/* 오클릭 방지 — 종료는 한 번 더 묻는다 */}
            {endConfirm && (
              <div style={css("position:absolute;top:48px;right:0;width:220px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);padding:13px 14px;z-index:40;animation:dockUp .15s ease")}>
                <div style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:9px")}>통화를 종료할까요?</div>
                <div style={css("display:flex;gap:6px")}>
                  <span onClick={vm.endCall} style={css("flex:1;text-align:center;padding:7px 0;border-radius:9999px;background:var(--red-800);color:#fff;font:700 12px 'Geist Sans','Pretendard',sans-serif;cursor:pointer")}>종료</span>
                  <span onClick={() => setEndConfirm(false)} style={css("flex:1;text-align:center;padding:7px 0;border-radius:9999px;background:var(--gray-100);color:var(--gray-900);font:600 12px 'Geist Sans','Pretendard',sans-serif;cursor:pointer")}>계속 통화</span>
                </div>
              </div>
            )}
          </span>
        </div>
      </div>

      <div style={css("flex:1;display:flex;gap:16px;padding:16px;min-height:0")}>
        {/* ── 좌 컬럼 ── */}
        <div ref={leftColRef} style={css("width:320px;flex:none;display:flex;flex-direction:column;gap:14px;min-height:0;overflow-y:auto;overflow-x:hidden")}>
          <div className="card" style={css("padding:13px 15px;display:flex;align-items:center;gap:12px" + (vm.verified ? ";opacity:.93" : ""))}>
            <span className="av" style={css("width:42px;height:42px")}><span className="mi" style={css("font-size:22px")}>headset_mic</span></span>
            <div style={css("flex:1;min-width:0")}>
              <div style={css("display:flex;align-items:center;gap:6px")}>
                <span style={css("font-weight:700;font-size:15px")}>{AGENT.role} {AGENT.name}</span>
                <span style={css("width:7px;height:7px;border-radius:9999px;background:var(--green-700)")} />
                <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--green-700)")}>통화 중</span>
              </div>
              <div style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:1px")}>{AGENT.dept} · {AGENT.tenure} · {AGENT.id}</div>
            </div>
            <div style={css("text-align:right;flex:none;padding-left:10px;border-left:1px solid var(--gray-200)")}>
              <div style={css("font:700 16px 'Geist Mono','IBM Plex Mono',monospace;color:var(--blue-700)")}>12</div>
              <div className="lbl">오늘 후처리</div>
            </div>
          </div>

          {/* 고객 카드 + 본인인증 (1d) — 본인확인 전에는 광원이 여기에 있다 */}
          {/* 인증 전에는 인증 폼 높이(≈418px) 고정으로 흔들림 방지, 인증 후에는 내용만큼 */}
          <div className="card" style={css("padding:16px" + (vm.verified ? "" : ";min-height:418px;box-shadow:var(--sh-focus)"))}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;margin-bottom:12px")}>
              <span className="sechd">고객</span>
              <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);background:var(--gray-100);border-radius:9999px;padding:4px 10px")}>고객 동의 시 열람</span>
            </div>
            <div style={css("display:flex;align-items:center;gap:12px")}>
              <span className="av" style={css("width:46px;height:46px")}><span className="mi" style={css("font-size:26px")}>person</span></span>
              <div>
                <div style={css("font-weight:700;font-size:18px;line-height:1.2")}>{vm.customerName}</div>
                <div style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:2px")}>
                  {vm.customerType} · 발신 <span style={css("font-family:'Geist Mono','IBM Plex Mono',monospace")}>{vm.customerPhone}</span>
                </div>
              </div>
            </div>

            {vm.verified ? (
              <div style={css("margin-top:13px;background:var(--gray-100);border-radius:8px;overflow:hidden")}>
                <div style={css("display:flex;align-items:center;gap:9px;padding:10px 12px;border-bottom:1px solid var(--gray-300)")}>
                  <span style={css("width:22px;height:22px;border-radius:9999px;background:var(--green-900);color:#fff;display:flex;align-items:center;justify-content:center")}>
                    <span className="mi" style={css("font-size:15px")}>check</span>
                  </span>
                  <div style={css("flex:1")}>
                    <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900)")}>본인인증 완료</span>
                    <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--green-600);margin-left:6px")}>{vm.authTime}</span>
                  </div>
                  <span onClick={vm.resetAuth} style={css("display:flex;align-items:center;gap:2px;font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);cursor:pointer")}>
                    재인증 <span className="mi" style={css("font-size:15px")}>restart_alt</span>
                  </span>
                </div>
                <div style={css("padding:10px 12px;font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>
                  {vm.authMethodLabel} · 일치 <span style={css("color:var(--gray-600)")}>(입력 자동 대조)</span>
                </div>
              </div>
            ) : (
              <div style={css("margin-top:13px;background:var(--gray-100);border-radius:8px;padding:12px")}>
                <div style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);margin-bottom:3px")}>본인확인 · 미완료</div>
                <div style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:10px")}>고객이 말한 값을 입력하면 자동 대조됩니다</div>
                <div className="lbl" style={css("margin-bottom:6px")}>대조 방식</div>
                <div style={css("display:flex;gap:6px;flex-wrap:wrap;margin-bottom:11px")}>
                  <span onClick={vm.setAuthPhone} style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:5px 11px;cursor:pointer;background:" + vm.mPhoneBg + ";color:" + vm.mPhoneFg + ";border:1px solid " + vm.mPhoneBd)}>연락처 뒷 4자리</span>
                  <span onClick={vm.setAuthBirth} style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:5px 11px;cursor:pointer;background:" + vm.mBirthBg + ";color:" + vm.mBirthFg + ";border:1px solid " + vm.mBirthBd)}>생년월일</span>
                  <span onClick={vm.setAuthAcct} style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:5px 11px;cursor:pointer;background:" + vm.mAcctBg + ";color:" + vm.mAcctFg + ";border:1px solid " + vm.mAcctBd)}>계좌 뒷 4자리</span>
                </div>
                <div style={css("display:flex;gap:7px;align-items:center")}>
                  <input
                    className="authin"
                    value={vm.authInput}
                    onChange={vm.onAuthInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") vm.runVerify();
                    }}
                    placeholder={vm.authPlaceholder}
                    inputMode="numeric"
                    style={css("flex:1;min-width:0;border:1px solid var(--gray-400);border-radius:9999px;padding:8px 14px;background:var(--onair-surface);font:600 14px 'Geist Mono','IBM Plex Mono',monospace;letter-spacing:2px;outline:none;color:var(--gray-1000)")}
                  />
                  <span onClick={vm.runVerify} style={css("flex:none;padding:9px 16px;background:var(--blue-700);color:#fff;border-radius:9999px;font:700 12.5px 'Geist Sans','Pretendard',sans-serif;cursor:pointer")}>대조</span>
                </div>
                {vm.authErr && (
                  <div style={css("margin-top:7px;display:flex;align-items:center;gap:4px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--red-800)")}>
                    <span className="mi" style={css("font-size:13px")}>error</span>
                    {vm.authErrMsg}
                  </div>
                )}
                <div style={css("display:flex;align-items:center;gap:5px;margin-top:9px;font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
                  <span className="mi" style={css("font-size:13px")}>lock</span> 원문은 표시되지 않으며 입력값과 자동 대조됩니다
                </div>
              </div>
            )}

            <div style={css("margin-top:12px")}>
              <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>
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
            <div className="card" style={css("flex:none;display:flex;flex-direction:column;overflow:hidden;animation:dockUp .25s ease")}>
              <div style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px dashed var(--color-border)")}>
                <span className="sechd">과거 상담 이력</span>
                <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>최근 6개월 · {HISTORY.length}건</span>
              </div>
              {/* 타임라인 — 불릿이 세로선으로 이어져 시간의 흐름을 만든다 */}
              <div style={css("overflow:auto;padding:6px 15px 4px")}>
                {HISTORY.map((h, i) => (
                  <div key={i} style={css("display:flex;gap:11px")}>
                    <div style={css("display:flex;flex-direction:column;align-items:center;width:9px;flex:none")}>
                      <span style={css("width:9px;height:9px;border-radius:9999px;flex:none;margin-top:13px;box-sizing:border-box;" + (i === 0 ? "background:var(--blue-700)" : "border:1.5px solid var(--gray-500);background:var(--onair-surface)"))} />
                      {i < HISTORY.length - 1 && <span style={css("width:1.5px;flex:1;background:var(--gray-300)")} />}
                    </div>
                    <div style={css("flex:1;padding:8px 0 14px")}>
                      <div style={css("display:flex;align-items:center;gap:8px")}>
                        <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>{h.date}</span>
                        <span style={css("font:400 10px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900);margin-left:auto;background:var(--gray-100);border-radius:9999px;padding:2px 8px")}>완결</span>
                      </div>
                      <div style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-top:3px")}>{h.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {vm.verified && showAccounts && (
            <div className="card" style={css("flex:none;display:flex;flex-direction:column;overflow:hidden;animation:dockUp .25s ease")}>
              <div style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px dashed var(--color-border)")}>
                <span className="sechd">보유 계좌 및 카드</span>
                <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>{ACCOUNTS.length}건 · 정상</span>
              </div>
              <div style={css("overflow:auto")}>
                {ACCOUNTS.map((a, i) => (
                  <div key={i} style={css("padding:10px 14px" + (i < ACCOUNTS.length - 1 ? ";border-bottom:1px solid var(--gray-200)" : ""))}>
                    <div style={css("display:flex;align-items:center;gap:7px")}>
                      <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);background:var(--gray-100);border-radius:9999px;padding:2px 8px;flex:none")}>{a.kind}</span>
                      <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{a.name}</span>
                      <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900);margin-left:auto")}>정상</span>
                    </div>
                    <div style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700);margin-top:4px;padding-left:2px")}>
                      {a.no} · 개설 {a.opened}
                    </div>
                  </div>
                ))}
              </div>
              <div style={css("padding:8px 15px;border-top:1px solid var(--gray-200);font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
                읽기 전용 · 고객 동의 하 열람
              </div>
            </div>
          )}
        </div>

        {/* ── 중 컬럼 ── */}
        <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:14px")}>
          <div className="card" style={css("flex:none;padding:15px 17px")}>
            <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:9px")}>
              <span className="mi" style={css("font-size:17px;color:var(--blue-700)")}>auto_awesome</span>
              <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>AI 사전 요약</span>
              <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>대기 중 고객 진술 기반</span>
            </div>
            <div style={css("font:600 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:10px")}>{vm.prepHeadline}</div>
            <div style={css("display:flex;flex-direction:column;gap:8px")}>
              {vm.prepSummaryBullets.map((t, i) => (
                <div key={i} style={css("display:flex;gap:11px")}>
                  <span style={css("width:3px;border-radius:2px;background:var(--blue-500);flex:none")} />
                  <span style={css("font:400 13px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={css("flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden" + (vm.verified ? ";box-shadow:var(--sh-focus)" : ""))}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px dashed var(--color-border)")}>
              <span className="sechd" style={css("display:flex;align-items:center;gap:6px")}>
                <span className="mi" style={css("font-size:18px")}>menu_book</span> 단계별 상담 스크립트
              </span>
              <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>AI 추천 흐름 · 전체 표시</span>
            </div>
            <div style={css("flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:9px")}>
              {vm.steps.map((st, i) => (
                <div key={i} style={css("background:var(--gray-100);border-radius:8px;padding:11px 13px")}>
                  <div style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:5px")}>{st.title}</div>
                  <div style={css("font:400 13px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{st.text}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={css("flex:none;height:196px;display:flex;flex-direction:column" + (vm.verified ? "" : ";opacity:.93"))}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px dashed var(--color-border)")}>
              <span className="sechd" style={css("display:flex;align-items:center;gap:5px")}>
                <span className="mi" style={css("font-size:17px")}>edit_note</span> 상담원 메모
              </span>
              <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>불릿 자동 · 종료 시 후처리에 반영</span>
            </div>
            <div style={css("flex:1;overflow:auto;padding:10px 16px;display:flex;flex-direction:column;gap:6px")}>
              {vm.memoItems.map((m, i) => (
                <div key={i} className="memorow" style={css("display:flex;gap:8px;align-items:baseline")}>
                  <span style={css("color:var(--blue-700);font-weight:700;flex:none")}>•</span>
                  {editIdx === i ? (
                    <input
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          vm.updateMemo(i, editText);
                          setEditIdx(null);
                        }
                      }}
                      onBlur={() => setEditIdx(null)}
                      style={css("flex:1;min-width:0;border:none;outline:none;border-bottom:1px solid var(--blue-400);font:400 13px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:transparent;padding:0")}
                    />
                  ) : (
                    <>
                      <span style={css("flex:1;min-width:0;font:400 13px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{m}</span>
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
                <div style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>특이사항을 입력하면 불릿으로 기록됩니다</div>
              )}
            </div>
            <div style={css("flex:none;display:flex;align-items:center;gap:8px;padding:9px 14px;border-top:1px solid var(--gray-200)")}>
              <span style={css("color:var(--blue-700);font-weight:700")}>•</span>
              <input
                ref={memoInputRef}
                value={vm.memoDraft}
                onChange={vm.onMemoDraft}
                onKeyDown={vm.onMemoKey}
                placeholder="메모 입력 후 Enter · 단축키 N"
                style={css("flex:1;border:none;outline:none;font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:transparent")}
              />
            </div>
          </div>
        </div>

        {/* ── 우 컬럼 : 규정 ── */}
        <div style={css("width:" + vm.regW + "px;flex:none;display:flex;flex-direction:column;gap:14px;min-height:0")}>
          <div className="card" style={css("flex:" + (vm.regCollapsed ? "none" : "1") + ";min-height:0;display:flex;flex-direction:column;overflow:hidden;opacity:" + (vm.verified ? ".95" : ".9"))}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px dashed var(--color-border)")}>
              <span className="sechd" style={css("display:flex;align-items:center;gap:6px")}>
                <span className="mi" style={css("font-size:18px")}>gavel</span> 관련 규정 및 매뉴얼
              </span>
              {vm.regCollapsed ? (
                <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);background:var(--gray-100);border:1px solid var(--gray-200);border-radius:9999px;padding:2px 8px")}>규정집 · 매뉴얼</span>
              ) : (
                <span onClick={vm.closeReg} title="규정집 축소 · 단축키 R" style={css("display:inline-flex;align-items:center;gap:4px;font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);border:1px solid var(--blue-400);border-radius:9999px;padding:5px 12px;cursor:pointer")}>
                  <span className="mi" style={css("font-size:15px")}>close_fullscreen</span> 축소
                </span>
              )}
            </div>

            {vm.regCollapsed ? (
              <div style={css("flex:1;min-height:0;overflow:auto")}>
                <div style={css("padding:12px 15px;border-bottom:1px solid var(--gray-200)")}>
                  <div style={css("display:flex;align-items:center;gap:8px;border:1px solid var(--gray-400);border-radius:9999px;padding:9px 14px;background:var(--onair-surface)")}>
                    <span className="mi" style={css("font-size:18px;color:var(--gray-700)")}>search</span>
                    <span style={css("flex:1;font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.regQuery}</span>
                  </div>
                  <div style={css("display:flex;align-items:center;gap:5px;margin-top:7px;font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
                    <span className="mi" style={css("font-size:14px")}>info</span> 열기를 누르면 오른쪽에서 규정집이 펼쳐집니다
                  </div>
                </div>
                <div style={css("padding:13px 15px;display:flex;flex-direction:column;gap:14px")}>
                  <div>
                    <div style={css("display:flex;align-items:center;gap:5px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);margin-bottom:8px")}>
                      <span className="mi" style={css("font-size:14px")}>auto_awesome</span> 이번 상담 예상 규정 · AI 추천
                    </div>
                    <div style={css("display:flex;flex-direction:column;gap:9px")}>
                      {vm.regRecos.map((r) => (
                        <RegReco key={r.title} vm={vm} title={r.title} body={r.body} file={r.file} row={r.row} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:8px")}>규정집 파일 바로가기</div>
                    <div style={css("display:flex;flex-direction:column;gap:7px")}>
                      <RegFile vm={vm} name="전자금융거래 업무매뉴얼_v24" />
                      <RegFile vm={vm} name="착오송금_반환지원_안내" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* 엑셀 크롬 — 채도 높은 초록 대신 쿨 뉴트럴 잉크 (온에어: 면은 한 색) */}
                <div style={css("display:flex;align-items:center;gap:8px;padding:9px 14px;background:var(--gray-1000);color:#fff")}>
                  <span className="mi" style={css("font-size:18px")}>grid_on</span>
                  <span style={css("font:600 12.5px 'Geist Sans','Pretendard',sans-serif")}>{vm.regFile}</span>
                  <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;opacity:.85")}>· {vm.regSheet} 시트</span>
                </div>
                {/* 3컬럼 리플로우 — 안내 멘트는 별도 컬럼이 아니라 내용 아래 인용 줄로.
                    가로 스크롤 없이 패널 폭에 맞는다 */}
                <div style={css("flex:1;min-height:0;overflow-y:auto;background:#fff")}>
                  <div style={css("display:flex;flex-direction:column")}>
                    <div style={css("display:flex;position:sticky;top:0;z-index:1")}>
                      <span style={css("width:36px;flex:none;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300)")} />
                      {vm.regCols.slice(0, 3).map((c, i) => (
                        <span key={i} style={css((i === 2 ? "flex:1;min-width:0" : "width:" + c.w + "px;flex:none") + ";padding:8px 10px;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300);font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{c.l}{i === 2 ? " · 안내 멘트" : ""}</span>
                      ))}
                    </div>
                    {vm.regRows.map((r) => {
                      /* '열기'로 진입한 조항은 행 전체가 강조된다 */
                      const hit = vm.regTargetRow != null && r.n === vm.regTargetRow + 1;
                      const ment = r.cells[3] && r.cells[3].text !== "—" ? r.cells[3].text : null;
                      return (
                        <div key={r.n} style={css("display:flex" + (hit ? ";box-shadow:inset 3px 0 0 var(--blue-700)" : ""))}>
                          <span style={css("width:36px;flex:none;padding:8px 0;text-align:center;border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-200);font:" + (hit ? "700" : "400") + " 11px 'Geist Mono','IBM Plex Mono',monospace;color:" + (hit ? "var(--blue-900)" : "var(--gray-600)") + ";background:" + (hit ? "var(--blue-100)" : "var(--gray-100)"))}>{r.n}</span>
                          {r.cells.slice(0, 2).map((cell, ci) => (
                            <span key={ci} style={css("width:" + cell.w + "px;flex:none;padding:8px 10px;border-right:1px solid var(--gray-200);border-bottom:1px solid var(--gray-200);font:" + (hit ? "600" : "400") + " 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:" + (hit ? "var(--blue-100)" : "transparent"))}>{cell.text}</span>
                          ))}
                          <span style={css("flex:1;min-width:0;padding:8px 10px;border-bottom:1px solid var(--gray-200);background:" + (hit ? "var(--blue-100)" : "transparent"))}>
                            <span style={css("display:block;font:" + (hit ? "600" : "400") + " 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{r.cells[2].text}</span>
                            {ment && (
                              <span style={css("display:block;margin-top:4px;font:400 12px/1.5 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-700)")}>{ment}</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={css("display:flex;align-items:center;gap:2px;padding:6px 10px;background:var(--gray-100);border-top:1px solid var(--gray-300)")}>
                  <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;background:#fff;border:1px solid var(--gray-300);border-bottom:none;border-radius:4px 4px 0 0;padding:5px 12px;color:var(--gray-1000)")}>{vm.regSheet}</span>
                  <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;padding:5px 12px;color:var(--gray-600)")}>Sheet2</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

    </DesktopShell>
  );
}

function RegReco({ vm, title, body, file, row }: { vm: CallFlowVM; title: string; body: string; file: string; row: number }) {
  return (
    <div style={css("background:var(--gray-100);border-radius:8px;padding:11px 13px")}>
      <div style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:5px")}>{title}</div>
      <div style={css("font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{body}</div>
      <div style={css("display:flex;align-items:center;justify-content:space-between;margin-top:8px")}>
        <span style={css("font:400 10.5px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600)")}>{file}</span>
        {/* 열기 = 규정집 확장 + 해당 조항 행 강조 */}
        <span onClick={() => vm.openManualAt(row)} style={css("display:inline-flex;align-items:center;gap:4px;font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);border:1px solid var(--blue-400);background:var(--onair-surface);border-radius:9999px;padding:4px 11px;cursor:pointer")}>
          <span className="mi" style={css("font-size:14px")}>open_in_new</span> 열기
        </span>
      </div>
    </div>
  );
}

function RegFile({ vm, name }: { vm: CallFlowVM; name: string }) {
  return (
    <span onClick={vm.openManual} style={css("display:flex;align-items:center;gap:8px;background:var(--gray-100);border-radius:9999px;padding:9px 14px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);cursor:pointer")}>
      <span style={css("flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{name}</span>
      <span className="mi" style={css("font-size:16px;color:var(--gray-600)")}>open_in_new</span>
    </span>
  );
}
