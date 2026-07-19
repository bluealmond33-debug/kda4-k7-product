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
  // 시트 전체 높이 812px(1440 좌표계), 접힌 상태 = 헤더 56px만 보임
  const SHEET_H = 812;
  const PEEK = 56;
  return (
    <DesktopShell overlay>
      {/* dim — 시트가 열렸을 때만. 클릭하면 접혀서 뒤의 통화 화면을 본다 */}
      <div
        onClick={open ? vm.toggleWrapSheet : undefined}
        style={css(
          "position:absolute;inset:0;background:rgba(22,20,17,.34);transition:opacity .45s var(--ease-drawer);pointer-events:" +
            (open ? "auto" : "none") +
            ";opacity:" +
            (open ? "1" : "0")
        )}
      />

      {/* 바텀 시트 — 항상 마운트, translateY로 승강 (열림/접힘 모두 부드럽게) */}
      <div
        style={css(
          "position:absolute;left:50%;bottom:0;width:1240px;height:" +
            SHEET_H +
            "px;background:var(--onair-surface);border-radius:12px 12px 0 0;box-shadow:var(--sh-modal);display:flex;flex-direction:column;overflow:hidden;pointer-events:auto;transition:transform .5s var(--ease-drawer);transform:translateX(-50%) translateY(" +
            (open ? "0" : SHEET_H - PEEK + "px") +
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
              {/* 좌 — 예전엔 상담사가 손으로 쓰던 기입 항목들. 기본값이 채워져 있고 클릭해 수정 */}
              <div style={css("width:300px;flex:none;display:flex;flex-direction:column;gap:12px;overflow:visible")}>
                <div className="lbl">기입 항목 · 자동 채움, 클릭해 수정</div>
                <div style={css("display:flex;flex-direction:column;gap:8px")}>
                  <EditRow label="고객" value={`${vm.customerName} · ${vm.customerPhone}`} />
                  <EditRow label="상담사" value={`${AGENT.name} · ${AGENT.id}`} />
                  <EditRow label="일시" value="2026.07.15 14:32" small />
                </div>
                <SelectField label="상담 유형" value={vm.wrapType} open={vm.typeMenu} onToggle={vm.toggleTypeMenu} opts={vm.typeOpts} />
                <SelectField label="상담 결과" value={vm.wrapResult} open={vm.resultMenu} onToggle={vm.toggleResultMenu} opts={vm.resultOpts} />
                <div style={css("flex:1")} />
                <div style={css("font:400 11px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
                  MVP 상담 결과 — 저장 시 상담 이력에 기록됩니다
                </div>
              </div>

              {/* 우 — 재료 1·2가 위에 나란히, 그 아래 초안이 합쳐져 내려온다 */}
              <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:10px")}>
                <div style={css("display:flex;gap:10px;flex:none")}>
                  <div style={css("flex:1.3;background:var(--gray-100);border-radius:8px;padding:11px 14px")}>
                    <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:6px")}>
                      <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>graphic_eq</span>
                      <span style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>재료 1 · 음성 데이터</span>
                      <span style={css("font:400 10.5px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600);margin-left:auto")}>통화 {vm.clockStr} · 녹취</span>
                    </div>
                    <div style={css("font:400 12px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);max-height:56px;overflow:auto")}>
                      {vm.wrapSummaryDefault}
                    </div>
                  </div>
                  {/* 재료 2 — 메모는 여기서도 실제로 추가된다 (통화 중 못 적었어도 늦지 않게) */}
                  <div style={css("flex:1;background:var(--gray-100);border-radius:8px;padding:11px 14px;display:flex;flex-direction:column")}>
                    <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:6px")}>
                      <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>edit_note</span>
                      <span style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>재료 2 · 상담원 메모</span>
                      <span style={css("font:400 10.5px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600);margin-left:auto")}>{vm.memoItems.length}건</span>
                    </div>
                    <div style={css("flex:1;max-height:34px;overflow:auto;display:flex;flex-direction:column;gap:3px")}>
                      {vm.memoItems.map((m, i) => (
                        <div key={i} style={css("display:flex;gap:6px;align-items:baseline")}>
                          <span style={css("color:var(--blue-700);font-weight:700;flex:none;font-size:11px")}>•</span>
                          <span style={css("font:400 12px/1.45 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{m}</span>
                        </div>
                      ))}
                      {vm.memoEmpty && (
                        <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>통화 중 작성한 메모가 없습니다 — 아래에서 추가할 수 있어요</span>
                      )}
                    </div>
                    <div style={css("flex:none;display:flex;align-items:center;gap:6px;margin-top:6px;background:var(--onair-surface);border-radius:9999px;padding:6px 11px")}>
                      <span style={css("color:var(--blue-700);font-weight:700;font-size:12px")}>•</span>
                      <input
                        value={vm.memoDraft}
                        onChange={vm.onMemoDraft}
                        onKeyDown={vm.onMemoKey}
                        placeholder="메모 추가 후 Enter"
                        style={css("flex:1;min-width:0;border:none;outline:none;background:transparent;font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}
                      />
                    </div>
                  </div>
                </div>

                <div style={css("flex:none;display:flex;align-items:center;justify-content:center;gap:7px;color:var(--gray-600);font:600 11px 'Geist Sans','Pretendard',sans-serif")}>
                  <span className="mi" style={css("font-size:14px")}>call_merge</span>
                  두 재료가 아래 초안으로 합쳐졌습니다
                  <span className="mi" style={css("font-size:14px")}>arrow_downward</span>
                </div>

                {/* 최종 초안 — 재료를 보면서 바로 수정 */}
                <div style={css("flex:1;display:flex;flex-direction:column;min-height:0")}>
                  <div style={css("display:flex;justify-content:space-between;align-items:center;margin-bottom:6px")}>
                    <span style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
                      <span className="mi" style={css("font-size:14px;color:var(--blue-700);vertical-align:-2px;margin-right:4px")}>auto_awesome</span>
                      후처리 초안 <span style={css("font-weight:400;color:var(--blue-700)")}>· 클릭해 편집</span>
                    </span>
                    <span style={css("display:inline-flex;align-items:center;gap:3px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);cursor:pointer")}>
                      <span className="mi" style={css("font-size:15px")}>refresh</span> 다시 생성
                    </span>
                  </div>
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    onInput={vm.onSummary}
                    style={css("flex:1;border:1px solid var(--gray-300);border-radius:8px;padding:13px 16px;font:400 14px/1.75 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);background:#fff;overflow:auto;outline:none")}
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
              <span onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 22px;background:var(--blue-700);color:#fff;border-radius:9999px;font-weight:700;font-size:14px;cursor:pointer")}>
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
  return (
    <div style={css("display:flex;align-items:center;gap:8px;background:var(--gray-100);border-radius:9999px;padding:7px 12px")}>
      <span className="lbl" style={css("width:44px;flex:none")}>{label}</span>
      <span contentEditable suppressContentEditableWarning style={css("flex:1;font:600 " + (small ? "12px" : "12.5px") + " 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);outline:none")}>{value}</span>
      <span className="mi" style={css("font-size:14px;color:var(--gray-400)")}>edit</span>
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
