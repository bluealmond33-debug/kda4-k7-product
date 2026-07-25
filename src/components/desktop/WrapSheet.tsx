import { useEffect, useState } from "react";
import { css } from "../../lib/css";
import { Coffee, Phone } from "lucide-react";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import { AGENT } from "../../data/demoContent";
import Spinner from "../Spinner";
import DesktopShell from "./DesktopShell";
import ClassifierFeedback from "./ClassifierFeedback";

const FONT = "'Avenir Next','Pretendard',sans-serif";

/** 1b — 통화 종료 · 후처리 바텀 시트.
 *  통화 화면(ActiveCall)이 배경에 그대로 남고, 시트가 그 위로 올라온다 — 통화→후처리는 한 흐름.
 *  접으면 헤더 바만 하단에 남아 방금 통화 내용을 다시 볼 수 있다.
 *  승강 커브 = --ease-drawer (iOS 드로어), transform만 애니메이션(GPU). */
export default function WrapSheet({ vm }: { vm: CallFlowVM }) {
  // 재료(녹취·메모)는 기본 접힘 — 초안이 주인공. 둘은 같은 '재료'라 한 번에 함께 여닫는다
  const [matsOpen, setMatsOpen] = useState(false);
  const open = vm.wrapSheetOpen;
  // 시트 전체 높이 700px(1440 좌표계 — 콘텐츠에 맞게, 휑하지 않게), 접힌 상태 = 헤더 56px만
  const SHEET_H = 700;
  const PEEK = 56;
  // 마운트 직후 한 프레임은 내려간 상태 → 다음 프레임에 올라온다 (등장이 항상 아래에서 위로)
  const [entered, setEntered] = useState(false);
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
          "position:absolute;left:50%;bottom:0;width:950px;height:" +
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
              <div style={css("font:600 18px/1.2 'Avenir Next','Pretendard',sans-serif;letter-spacing:-.2px;color:var(--gray-1000)")}>
                후처리 작성
                <span style={css("font:400 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-left:10px")}>
                  {open ? "녹취 + 메모 기반 자동 작성 · 모두 수정 가능" : "접힘 — 클릭해 열기 · 뒤로 방금 통화 화면이 보입니다"}
                </span>
              </div>
            </div>
            <span style={css("font:500 11px ui-monospace,'SF Mono',Menlo,Consolas,monospace;color:var(--gray-700);background:var(--gray-100);border-radius:9999px;padding:5px 11px")}>통화 {vm.clockStr}</span>
            <span style={css("display:inline-flex;align-items:baseline;gap:5px;background:var(--gray-100);border-radius:9999px;padding:5px 11px")}>
              <span className="lbl">오늘 후처리</span>
              <span style={css("font:700 12.5px ui-monospace,'SF Mono',Menlo,Consolas,monospace;color:var(--blue-700)")}>{vm.isExplicitLiveCall ? "로컬 초안 · 미저장" : "12→13"}</span>
            </span>
            <span className="mi" style={css("font-size:22px;color:var(--gray-500);transition:transform .3s var(--ease-drawer);transform:rotate(" + (open ? 0 : 180) + "deg)")}>expand_more</span>
          </div>
        </div>

        {/* 본문 — summarizing 동안엔 스피너, 준비되면 콘텐츠 */}
        {vm.wrapLoading ? (
          <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px")}>
            <Spinner size={46} mark />
            <div style={css("font:600 18px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>통화 내용을 요약하고 있습니다…</div>
            <div style={css("font:400 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>녹취와 상담원 메모를 바탕으로 후처리 초안을 작성 중입니다</div>
          </div>
        ) : (
          <>
            <div style={css("flex:1;display:flex;flex-direction:column;gap:10px;padding:14px 22px;min-height:0")}>
              {/* 재료(녹취·메모) — 기본 접힘. 초안이 주인공이고, 재료는 의심될 때만 펼친다.
                  헤더만 남아 한 줄이라 초안 상자가 그만큼 커진다 */}
              <div style={css("flex:none;display:flex;gap:10px;align-items:flex-start")}>
                <div style={css("flex:1.4;min-width:0;background:var(--gray-100);border-radius:8px;padding:9px 12px;display:flex;flex-direction:column;gap:8px")}>
                  <div onClick={() => setMatsOpen((v) => !v)} style={css("display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none")}>
                    <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>graphic_eq</span>
                    <span style={css("font:700 12px " + FONT + ";color:var(--gray-800)")}>음성 녹취</span>
                    <span style={css("font:400 11px " + FONT + ";color:var(--gray-600)")}>· 통화 {vm.clockStr}</span>
                    <div style={css("flex:1")} />
                    <span className="mi" style={css("font-size:18px;color:var(--gray-600);transition:transform .2s;transform:rotate(" + (matsOpen ? 180 : 0) + "deg)")}>expand_more</span>
                  </div>
                  {matsOpen && (
                    <>
                      <audio controls preload="none" src="/demo/recording.mp3" style={{ width: "100%", height: 34 }} />
                      <div style={css("flex:none;font:400 12.5px/1.6 " + FONT + ";color:var(--gray-900);background:var(--onair-surface);border-radius:6px;padding:9px 11px;height:80px;overflow:auto")}>{vm.wrapSummaryDefault}</div>
                    </>
                  )}
                </div>
                <div style={css("flex:1;min-width:0;background:var(--gray-100);border-radius:8px;padding:9px 12px;display:flex;flex-direction:column;gap:7px")}>
                  <div onClick={() => setMatsOpen((v) => !v)} style={css("display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none")}>
                    <span style={css("font:700 12px " + FONT + ";color:var(--gray-800)")}>✎ 상담원 메모</span>
                    <span style={css("font:400 11px " + FONT + ";color:var(--gray-600)")}>· {vm.memoItems.length}건</span>
                    <div style={css("flex:1")} />
                    <span className="mi" style={css("font-size:18px;color:var(--gray-600);transition:transform .2s;transform:rotate(" + (matsOpen ? 180 : 0) + "deg)")}>expand_more</span>
                  </div>
                  {matsOpen && (
                    <>
                      <div style={css("max-height:104px;overflow:auto;display:flex;flex-direction:column;gap:3px")}>
                        {vm.memoItems.map((m, i) => (
                          <div key={i} style={css("display:flex;gap:5px;align-items:baseline")}>
                            <span style={css("color:var(--blue-700);font-weight:700;flex:none;font-size:11px")}>•</span>
                            <span style={css("font:400 12px/1.45 " + FONT + ";color:var(--gray-900)")}>{m}</span>
                          </div>
                        ))}
                        {vm.memoEmpty && <span style={css("font:400 11px " + FONT + ";color:var(--gray-600)")}>작성한 메모가 없습니다</span>}
                      </div>
                      <div style={css("flex:none;display:flex;align-items:center;gap:6px;background:var(--onair-surface);border-radius:9999px;padding:6px 11px")}>
                        <span style={css("color:var(--blue-700);font-weight:700;font-size:12px")}>•</span>
                        <input value={vm.memoDraft} onChange={vm.onMemoDraft} onKeyDown={vm.onMemoKey} placeholder="메모 추가 후 Enter" style={css("flex:1;min-width:0;border:none;outline:none;background:transparent;font:400 12px " + FONT + ";color:var(--gray-1000)")} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* 상담 정보(자동 채움) 바로 오른쪽에 후처리 초안 — 채워진 값과 초안을 나란히 대조한다 */}
              <div style={css("flex:1;display:flex;gap:12px;min-height:0")}>
                <div style={css("width:248px;flex:none;display:flex;flex-direction:column;gap:9px;overflow:visible")}>
                  <div className="lbl">상담 정보 · 자동 채움 — ✎로 수정</div>
                  <div style={css("display:flex;flex-direction:column;gap:7px")}>
                    <EditRow label="고객" value={`${vm.customerName} · ${vm.customerPhone}`} />
                    <EditRow label="상담사" value={`${AGENT.name} · ${AGENT.id}`} />
                    <EditRow label="일시" value={vm.callStartedAt} small />
                  </div>
                  <SelectField label="상담 유형" value={vm.wrapType} open={vm.typeMenu} onToggle={vm.toggleTypeMenu} opts={vm.typeOpts} />
                  <SelectField label="상담 결과" value={vm.wrapResult} open={vm.resultMenu} onToggle={vm.toggleResultMenu} opts={vm.resultOpts} />
                </div>

                <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;min-height:0")}>
                  <div style={css("display:flex;justify-content:space-between;align-items:center;margin-bottom:6px")}>
                    <span style={css("font:700 13px " + FONT + ";color:var(--gray-1000)")}>
                      <span className="mi" style={css("font-size:15px;color:var(--blue-700);vertical-align:-2px;margin-right:4px")}>auto_awesome</span>
                      후처리 초안 <span style={css("font-weight:400;font-size:12px;color:var(--gray-600)")}>· 클릭해 편집</span>
                    </span>
                    <span style={css("font:500 11.5px " + FONT + ";color:var(--gray-600)")}>자동 저장·재생성 미연동</span>
                  </div>
                  <div
                    key={vm.summaryVersion}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={vm.onSummary}
                    style={css("flex:1;border:1px solid var(--gray-300);border-radius:8px;padding:14px 16px;font:400 14px/1.8 " + FONT + ";color:var(--gray-900);background:#fff;overflow:auto;outline:none;transition:opacity .25s;opacity:" + (vm.regenerating ? ".4" : "1"))}
                  >
                    {vm.wrapSummaryDefault}
                  </div>
                </div>
              </div>

              {/* 후속 조치 */}
              <div style={css("flex:none;display:flex;align-items:center;gap:7px;flex-wrap:wrap")}>
                <span style={css("font:700 12px " + FONT + ";color:var(--gray-1000);margin-right:2px")}>후속 조치</span>
                {vm.followups.map((f, i) => (
                  <span key={i} style={css("display:inline-flex;align-items:center;gap:6px;background:var(--gray-100);border-radius:9999px;padding:6px 8px 6px 12px")}>
                    <span className="mi" style={css("font-size:14px;color:var(--gray-700)")}>{f.icon}</span>
                    <span style={css("font:600 12px " + FONT + ";color:var(--gray-1000)")}>{f.label}</span>
                    <span onClick={f.remove} style={css("cursor:pointer;display:flex")} title="삭제">
                      <span className="mi" style={css("font-size:15px;color:var(--gray-600)")}>close</span>
                    </span>
                  </span>
                ))}
                {vm.recoFollowups.map((f, i) => (
                  <span key={i} onClick={f.add} style={css("display:inline-flex;align-items:center;gap:3px;font:600 11.5px " + FONT + ";color:var(--blue-700);border:1px dashed var(--blue-400);border-radius:9999px;padding:5px 10px;cursor:pointer")}>
                    <span className="mi" style={css("font-size:14px")}>add</span>{f.label}
                  </span>
                ))}
              </div>
            </div>

            <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:12px 24px;border-top:1px solid var(--gray-200)")}>
              <span style={css("font:400 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>시트를 접으면 방금 통화 화면을 다시 볼 수 있습니다</span>
              <div style={css("flex:1")} />
              {/* 초안 품질 — 저장 누르기 직전 자리. 엄지 둘만 */}
              <ClassifierFeedback vm={vm} />
              <span style={css("width:1px;height:22px;background:var(--gray-300);flex:none")} />
              {/* 후처리는 어느 쪽이든 저장된다 — 갈리는 건 '다음에 무엇을 할지'뿐 */}
              <span onClick={vm.reset} title="후처리를 저장하고 대기 화면으로 돌아갑니다" style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border:1px solid var(--gray-400);border-radius:9999px;font-size:14px;font-weight:700;color:var(--gray-800);cursor:pointer;background:var(--onair-surface);white-space:nowrap")}>
                <Coffee size={17} strokeWidth={2} absoluteStrokeWidth style={{ display: "block" }} /> 저장 후 휴식
              </span>
              <span data-tour="wrap-save" onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 22px;background:var(--blue-700);color:#fff;border-radius:9999px;font-weight:700;font-size:14px;cursor:pointer")}>
                <Phone size={17} strokeWidth={2} absoluteStrokeWidth style={{ display: "block" }} /> 저장 후 다음 콜
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
        style={css("flex:1;font:600 " + (small ? "12px" : "12.5px") + " 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);outline:none;cursor:" + (editing ? "text" : "default"))}
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
      <div onClick={onToggle} style={css("display:flex;align-items:center;justify-content:space-between;border:1px solid var(--gray-400);border-radius:9999px;padding:9px 14px;cursor:pointer;font:600 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);background:var(--onair-surface)")}>
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
                    " 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);cursor:pointer" +
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
