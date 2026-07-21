import { useEffect, useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import { AGENT } from "../../data/demoContent";
import DesktopShell from "./DesktopShell";

/** 1b — 통화 종료 · 후처리 바텀 시트.
 *  통화 화면(ActiveCall)이 배경에 그대로 남고, 시트가 그 위로 올라온다 — 통화→후처리는 한 흐름.
 *  접으면 헤더 바만 하단에 남아 방금 통화 내용을 다시 볼 수 있다.
 *  승강 커브 = --ease-drawer (iOS 드로어), transform만 애니메이션(GPU). */
export default function WrapSheet({ vm }: { vm: CallFlowVM }) {
  const open = vm.wrapSheetOpen;
  // 시트 전체 높이 700px(1440 좌표계 — 콘텐츠에 맞게, 휑하지 않게), 접힌 상태 = 헤더 56px만
  const SHEET_H = 700;
  const PEEK = 56;
  // 마운트 직후 한 프레임은 내려간 상태 → 다음 프레임에 올라온다 (등장이 항상 아래에서 위로)
  const [entered, setEntered] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false); // 출처(재료) 접이식 — 기본 접힘
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const shown = open && entered;
  return (
    <DesktopShell overlay>
      {/* dim — 시트가 열렸을 때만. 클릭하면 접혀서 뒤의 통화 화면을 본다 */}
      <div
        onClick={open ? vm.toggleWrapSheet : undefined}
        style={css(
          "position:absolute;inset:0;background:rgba(22,20,17,.34);transition:opacity .45s var(--ease-drawer);pointer-events:" +
            (shown ? "auto" : "none") +
            ";opacity:" +
            (shown ? "1" : "0")
        )}
      />

      {/* 바텀 시트 — 항상 마운트, translateY로 승강 (열림/접힘 모두 부드럽게) */}
      <div
        data-tour="wrap-sheet"
        style={css(
          "position:absolute;left:50%;bottom:0;width:1240px;height:" +
            SHEET_H +
            "px;background:var(--onair-surface);border-radius:12px 12px 0 0;box-shadow:var(--sh-modal);display:flex;flex-direction:column;overflow:hidden;pointer-events:auto;transition:transform .5s var(--ease-drawer);transform:translateX(-50%) translateY(" +
            (shown ? "0" : SHEET_H - PEEK + "px") +
            ")"
        )}
      >
        {/* 헤더 = 접힌 상태에서 보이는 바. 클릭하면 토글 */}
        <div
          onClick={vm.toggleWrapSheet}
          style={css("flex:none;cursor:pointer;user-select:none;border-bottom:1px solid var(--gray-200)")}
        >
          <div style={css("display:flex;align-items:center;justify-content:center;padding:7px 0 0")}>
            <span style={css("width:48px;height:5px;border-radius:9999px;background:var(--color-border)")} />
          </div>
          <div style={css("display:flex;align-items:center;gap:12px;padding:4px 24px 12px")}>
            <span className="mi" style={css("font-size:20px;color:var(--blue-700)")}>edit_note</span>
            <div style={css("flex:1;min-width:0")}>
              <div style={css("font:600 18px/1.2 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.2px;color:var(--gray-1000)")}>
                후처리 작성
                <span style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-left:10px")}>
                  {open ? "녹취 + 메모 기반 자동 작성 · 모두 수정 가능" : "접힘 — 클릭해 열기 · 뒤로 방금 통화 화면이 보입니다"}
                </span>
              </div>
            </div>
            <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700);background:var(--gray-100);border-radius:9999px;padding:5px 11px")}>통화 {vm.clockStr}</span>
            <span style={css("display:inline-flex;align-items:baseline;gap:5px;background:var(--gray-100);border-radius:9999px;padding:5px 11px")}>
              <span className="lbl">오늘 후처리</span>
              <span style={css("font:700 12.5px 'Geist Mono','IBM Plex Mono',monospace;color:var(--blue-700)")}>12→13</span>
            </span>
            <span className="mi" style={css("font-size:22px;color:var(--gray-500);transition:transform .3s var(--ease-drawer);transform:rotate(" + (open ? 0 : 180) + "deg)")}>expand_more</span>
          </div>
        </div>

        {/* 본문 — summarizing 동안엔 스피너, 준비되면 콘텐츠 */}
        {vm.wrapLoading ? (
          <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px")}>
            <span style={css("width:42px;height:42px;border:3px solid var(--blue-400);border-top-color:var(--blue-700);border-radius:9999px;animation:spin .8s linear infinite")} />
            <div style={css("font:600 18px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>통화 내용을 요약하고 있습니다…</div>
            <div style={css("font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>녹취와 상담원 메모를 바탕으로 후처리 초안을 작성 중입니다</div>
          </div>
        ) : (
          <>
            <div style={css("flex:1;display:flex;gap:18px;padding:14px 24px;min-height:0")}>
              {/* 좌 = 문서 속성 사이드바 — 고객·상담사·일시·유형·결과 */}
              <div style={css("width:270px;flex:none;display:flex;flex-direction:column;gap:11px;overflow:visible")}>
                <div className="lbl">상담 정보 · 자동 채움 — ✎로 수정</div>
                <div style={css("display:flex;flex-direction:column;gap:7px")}>
                  <EditRow label="고객" value={`${vm.customerName} · ${vm.customerPhone}`} />
                  <EditRow label="상담사" value={`${AGENT.name} · ${AGENT.id}`} />
                  <EditRow label="일시" value="2026.07.15 14:32" small />
                </div>
                <SelectField label="상담 유형" value={vm.wrapType} open={vm.typeMenu} onToggle={vm.toggleTypeMenu} opts={vm.typeOpts} />
                <SelectField label="상담 결과" value={vm.wrapResult} open={vm.resultMenu} onToggle={vm.toggleResultMenu} opts={vm.resultOpts} />
                <div style={css("flex:1")} />
                <div style={css("font:400 11px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
                  저장 시 상담 이력에 기록됩니다
                </div>
              </div>

              {/* 우 = 초안이 주인공. 재료는 위 접이식 '출처' 바에 숨어 있다 */}
              <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:10px")}>
                {/* 출처 바 — 기본 접힘. 펼치면 음성·메모(편집 가능)가 드러난다 */}
                <div style={css("flex:none;background:var(--gray-100);border-radius:8px")}>
                  <div
                    onClick={() => setSourcesOpen((v) => !v)}
                    style={css("display:flex;align-items:center;gap:8px;padding:9px 14px;cursor:pointer;user-select:none")}
                  >
                    <span className="mi" style={css("font-size:15px;color:var(--gray-600)")}>graphic_eq</span>
                    <span className="mi" style={css("font-size:15px;color:var(--gray-600)")}>edit_note</span>
                    <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800)")}>
                      출처 — 음성 녹취 + 메모 {vm.memoItems.length}건으로 작성됨
                    </span>
                    <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500);margin-left:auto")}>
                      {sourcesOpen ? "접기" : "펼쳐 보기"}
                    </span>
                    <span className="mi" style={css("font-size:18px;color:var(--gray-500);transition:transform .25s var(--ease-drawer);transform:rotate(" + (sourcesOpen ? 180 : 0) + "deg)")}>expand_more</span>
                  </div>
                  {/* max-height 애니메이션 — grid-fr은 중첩 flex에서 콘텐츠가 눌린다(알약과 같은 교훈) */}
                  <div style={css("overflow:hidden;transition:max-height .3s var(--ease-drawer),opacity .25s;max-height:" + (sourcesOpen ? "140px" : "0px") + ";opacity:" + (sourcesOpen ? "1" : "0"))}>
                    <div>
                      <div style={css("display:flex;gap:10px;padding:0 14px 12px")}>
                        <div style={css("flex:1.3;background:var(--onair-surface);border-radius:8px;padding:10px 12px")}>
                          <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:5px")}>🎙 음성 녹취 · 통화 {vm.clockStr}</div>
                          <div style={css("font:400 12px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);max-height:52px;overflow:auto")}>{vm.wrapSummaryDefault}</div>
                        </div>
                        <div style={css("flex:1;background:var(--onair-surface);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column")}>
                          <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:5px")}>✎ 상담원 메모 · {vm.memoItems.length}건</div>
                          <div style={css("flex:1;max-height:34px;overflow:auto;display:flex;flex-direction:column;gap:2px")}>
                            {vm.memoItems.map((m, i) => (
                              <div key={i} style={css("display:flex;gap:5px;align-items:baseline")}>
                                <span style={css("color:var(--blue-700);font-weight:700;flex:none;font-size:11px")}>•</span>
                                <span style={css("font:400 12px/1.4 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{m}</span>
                              </div>
                            ))}
                            {vm.memoEmpty && <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>작성한 메모가 없습니다</span>}
                          </div>
                          <div style={css("flex:none;display:flex;align-items:center;gap:6px;margin-top:5px;background:var(--gray-100);border-radius:9999px;padding:5px 10px")}>
                            <span style={css("color:var(--blue-700);font-weight:700;font-size:12px")}>•</span>
                            <input value={vm.memoDraft} onChange={vm.onMemoDraft} onKeyDown={vm.onMemoKey} placeholder="메모 추가 후 Enter" style={css("flex:1;min-width:0;border:none;outline:none;background:transparent;font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 최종 초안 = 히어로. 시트 높이 대부분을 차지한다 */}
                <div style={css("flex:1;display:flex;flex-direction:column;min-height:0")}>
                  <div style={css("display:flex;justify-content:space-between;align-items:center;margin-bottom:6px")}>
                    <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
                      <span className="mi" style={css("font-size:15px;color:var(--blue-700);vertical-align:-2px;margin-right:4px")}>auto_awesome</span>
                      후처리 초안 <span style={css("font-weight:400;font-size:12px;color:var(--gray-600)")}>· 클릭해 편집</span>
                    </span>
                    <span
                      onClick={vm.regenerating ? undefined : vm.regenerateSummary}
                      style={css("display:inline-flex;align-items:center;gap:4px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);cursor:" + (vm.regenerating ? "default;opacity:.6" : "pointer"))}
                    >
                      <span className="mi" style={css("font-size:15px" + (vm.regenerating ? ";animation:spin .8s linear infinite" : ""))}>refresh</span>
                      {vm.regenerating ? "생성 중…" : "다시 생성"}
                    </span>
                  </div>
                  {/* key=summaryVersion — 다시 생성하면 초안이 새 문형으로 갈아끼워진다 */}
                  <div
                    key={vm.summaryVersion}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={vm.onSummary}
                    style={css("flex:1;border:1px solid var(--gray-300);border-radius:8px;padding:15px 18px;font:400 14px/1.8 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);background:#fff;overflow:auto;outline:none;transition:opacity .25s;opacity:" + (vm.regenerating ? ".4" : "1"))}
                  >
                    {vm.wrapSummaryDefault}
                  </div>
                </div>

                {/* 후속 조치 */}
                <div style={css("flex:none")}>
                  <div style={css("display:flex;align-items:center;gap:7px;flex-wrap:wrap")}>
                    <span style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-right:2px")}>후속 조치</span>
                    {vm.followups.map((f, i) => (
                      <span key={i} style={css("display:inline-flex;align-items:center;gap:6px;background:var(--gray-100);border-radius:9999px;padding:6px 8px 6px 12px")}>
                        <span className="mi" style={css("font-size:14px;color:var(--gray-700)")}>{f.icon}</span>
                        <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{f.label}</span>
                        <span onClick={f.remove} style={css("cursor:pointer;display:flex")} title="삭제">
                          <span className="mi" style={css("font-size:15px;color:var(--gray-500)")}>close</span>
                        </span>
                      </span>
                    ))}
                    {vm.recoFollowups.map((f, i) => (
                      <span key={i} onClick={f.add} style={css("display:inline-flex;align-items:center;gap:3px;font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);border:1px dashed var(--blue-400);border-radius:9999px;padding:5px 10px;cursor:pointer")}>
                        <span className="mi" style={css("font-size:14px")}>add</span>{f.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:12px 24px;border-top:1px solid var(--gray-200)")}>
              <span style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>시트를 접으면 방금 통화 화면을 다시 볼 수 있습니다</span>
              <div style={css("flex:1")} />
              <span style={css("font:500 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);text-decoration:underline;text-underline-offset:2px;cursor:pointer")}>임시 저장</span>
              <span onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border:1px solid var(--gray-500);border-radius:9999px;font-size:14px;font-weight:700;color:var(--gray-1000);cursor:pointer;background:var(--onair-surface)")}>
                <span className="mi" style={css("font-size:18px")}>coffee</span> 저장 후 휴식
              </span>
              <span data-tour="wrap-save" onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 22px;background:var(--blue-700);color:#fff;border-radius:9999px;font-weight:700;font-size:14px;cursor:pointer")}>
                <span className="mi" style={css("font-size:18px")}>call</span> 저장 후 다음 콜
              </span>
            </div>
          </>
        )}
      </div>
    </DesktopShell>
  );
}

function EditRow({ label, value, small }: { label: string; value: string; small?: boolean }) {
  // 연필을 눌러야만 편집 — 기본 편집 가능이면 흘끗 클릭에 실수로 고쳐진다
  const [editing, setEditing] = useState(false);
  return (
    <div style={css("display:flex;align-items:center;gap:8px;border-radius:9999px;padding:7px 12px;transition:background .2s,box-shadow .2s;background:var(--gray-100)" + (editing ? ";background:var(--onair-surface);box-shadow:inset 0 0 0 1.5px var(--blue-500)" : ""))}>
      <span className="lbl" style={css("width:44px;flex:none")}>{label}</span>
      <span
        contentEditable={editing}
        suppressContentEditableWarning
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLElement).blur();
        }}
        style={css("flex:1;font:600 " + (small ? "12px" : "12.5px") + " 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);outline:none;cursor:" + (editing ? "text" : "default"))}
      >
        {value}
      </span>
      <span
        className="mi"
        title={editing ? "완료 (Enter)" : "수정"}
        onClick={(e) => {
          if (!editing) {
            setEditing(true);
            const txt = (e.currentTarget.parentElement?.querySelector('[contenteditable]') ?? null) as HTMLElement | null;
            requestAnimationFrame(() => txt?.focus());
          }
        }}
        style={css("font-size:14px;cursor:pointer;color:" + (editing ? "var(--blue-700)" : "var(--gray-500)"))}
      >
        {editing ? "check" : "edit"}
      </span>
    </div>
  );
}

function SelectField({
  label,
  value,
  open,
  onToggle,
  opts,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  opts: { label: string; pick: () => void }[];
}) {
  return (
    <div style={css("position:relative")}>
      <div className="lbl" style={css("margin-bottom:5px")}>{label}</div>
      <div onClick={onToggle} style={css("display:flex;align-items:center;justify-content:space-between;border:1px solid var(--gray-400);border-radius:9999px;padding:9px 14px;cursor:pointer;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:var(--onair-surface)")}>
        {value}
        <span className="mi" style={css("font-size:17px;color:var(--gray-600);transition:transform .2s;transform:rotate(" + (open ? 180 : 0) + "deg)")}>expand_more</span>
      </div>
      {open && (
        <>
          {/* 바깥 클릭 시 닫힘 */}
          <div onClick={onToggle} style={css("position:fixed;inset:-2000px;z-index:39")} />
          <div style={css("position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--onair-surface);border-radius:8px;box-shadow:var(--sh-modal);z-index:40;overflow:hidden")}>
            {opts.map((o, i) => (
              <div
                key={i}
                onClick={o.pick}
                style={css(
                  "display:flex;align-items:center;justify-content:space-between;padding:9px 13px;font:" +
                    (o.label === value ? "700" : "400") +
                    " 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);cursor:pointer" +
                    (o.label === value ? ";background:var(--gray-100)" : "")
                )}
              >
                {o.label}
                {o.label === value && <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>check</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
