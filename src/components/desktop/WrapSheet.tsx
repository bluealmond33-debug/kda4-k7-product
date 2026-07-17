import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import DesktopShell from "./DesktopShell";

const DONE_LIST = [
  { name: "고객 · 정OO", meta: "14:05", type: "수신 › 이체한도" },
  { name: "고객 · 이OO", meta: "13:40", type: "카드 › 재발급" },
];

/** 1b — 통화 종료 · 후처리. 재료(음성+메모) → 바텀업 시트에서 초안 확인·수정. */
export default function WrapSheet({ vm }: { vm: CallFlowVM }) {
  return (
    <DesktopShell flex>
      {/* 상단 알약 — 통화 알약과 같은 고정 기하(1004×54)라 전환 시 움직이지 않는다 */}
      <div style={css("height:74px;flex:none;position:relative;z-index:5")}>
        <div className="pill" style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:1004px")}>
          <span className="lampdots" title="통화 종료 — 온에어 소등"><i className="r" /><i className="a" /><i className="g" /></span>
          <span style={css("display:flex;align-items:center;gap:4px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800)")}>
            <span className="mi" style={css("font-size:14px;color:var(--green-700)")}>check_circle</span> 녹취 완료
          </span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
            <span className="mi" style={css("font-size:15px;color:var(--amber-700)")}>edit_note</span> 후처리 작성 중
          </span>
          <span style={css("margin-left:auto;font:500 15px 'Geist Mono','IBM Plex Mono',monospace")}>{vm.clockStr}</span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;gap:5px")}>
            <span className="cbtn" title="녹취 다시 듣기"><span className="mi" style={css("font-size:19px")}>play_arrow</span></span>
            <span className="cbtn" title="통화 요약 복사"><span className="mi" style={css("font-size:19px")}>content_copy</span></span>
          </span>
        </div>
      </div>

      <div style={css("flex:1;display:flex;gap:16px;padding:16px;min-height:0")}>
        {/* 좌 컬럼 — 상담사 바로 아래 오늘 완료한 상담 */}
        <div style={css("width:320px;flex:none;display:flex;flex-direction:column;gap:14px;min-height:0")}>
          <div className="card" style={css("padding:13px 15px;display:flex;align-items:center;gap:12px")}>
            <span className="av" style={css("width:42px;height:42px")}><span className="mi" style={css("font-size:22px")}>headset_mic</span></span>
            <div style={css("flex:1;min-width:0")}>
              <div style={css("display:flex;align-items:center;gap:6px")}>
                <span style={css("font-weight:700;font-size:15px")}>상담사 김키움</span>
                <span style={css("width:7px;height:7px;border-radius:9999px;background:var(--amber-700)")} />
                <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900)")}>후처리 중</span>
              </div>
              <div style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:1px")}>전자금융팀 · 사번 A-2231</div>
            </div>
            <div style={css("text-align:right;flex:none;padding-left:10px;border-left:1px solid var(--gray-200)")}>
              <div style={css("font:700 15px 'Geist Mono','IBM Plex Mono',monospace;color:var(--blue-700)")}>12→13</div>
              <div className="lbl">오늘 후처리</div>
            </div>
          </div>

          <div className="card" style={css("flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden")}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px dashed var(--color-border)")}>
              <span className="sechd">오늘 완료한 상담</span>
              <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>12건</span>
            </div>
            <div style={css("overflow:auto")}>
              <div style={css("padding:11px 14px;background:var(--gray-100);border-bottom:1px solid var(--gray-200)")}>
                <div style={css("display:flex;align-items:center;gap:8px")}>
                  <span style={css("font-weight:700;font-size:14px")}>고객 · {vm.customerName}</span>
                  <span style={css("font:700 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-left:auto")}>지금 후처리 중</span>
                </div>
                <div style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);margin-top:4px")}>{vm.inquiryLabel}</div>
              </div>
              {DONE_LIST.map((d, i) => (
                <div key={i} style={css("padding:11px 14px" + (i < DONE_LIST.length - 1 ? ";border-bottom:1px solid var(--gray-200)" : ""))}>
                  <div style={css("display:flex;align-items:center;gap:8px")}>
                    <span style={css("font-weight:700;font-size:14px;color:var(--gray-1000)")}>{d.name}</span>
                    <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600);margin-left:auto")}>{d.meta}</span>
                  </div>
                  <div style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);margin-top:4px")}>{d.type}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 우 영역 */}
        <div style={css("flex:1;position:relative;min-width:0")}>
          {vm.wrapLoading && (
            <div style={css("position:absolute;inset:0;background:var(--onair-surface);border-radius:20px;box-shadow:var(--sh-near);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px")}>
              <span style={css("width:42px;height:42px;border:3px solid var(--blue-400);border-top-color:var(--blue-700);border-radius:9999px;animation:spin .8s linear infinite")} />
              <div style={css("font:700 18px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>통화 내용을 요약하고 있습니다…</div>
              <div style={css("font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>녹취와 상담원 메모를 바탕으로 후처리 초안을 작성 중입니다</div>
            </div>
          )}

          {/* 재료 패널 — 음성 데이터와 메모가 초안으로 합쳐지는 과정 */}
          {vm.wrapReady && (
            <div style={css("position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;padding-bottom:82px;overflow:hidden" + (vm.wrapSheetOpen ? ";opacity:.55" : ""))}>
              <div style={css("display:flex;gap:12px;flex:none")}>
                <div className="card" style={css("flex:1.4;padding:15px 18px;box-shadow:var(--sh-near)")}>
                  <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:8px")}>
                    <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>graphic_eq</span>
                    <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>재료 1 · 음성 데이터</span>
                    <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600);margin-left:auto")}>통화 {vm.clockStr} · 녹취</span>
                  </div>
                  <div style={css("font:400 12.5px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);max-height:60px;overflow:hidden")}>
                    {vm.wrapSummaryDefault}
                  </div>
                </div>
                <div className="card" style={css("flex:1;padding:15px 18px;box-shadow:var(--sh-near)")}>
                  <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:8px")}>
                    <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>edit_note</span>
                    <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>재료 2 · 상담원 메모</span>
                    <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600);margin-left:auto")}>{vm.memoItems.length}건</span>
                  </div>
                  <div style={css("display:flex;flex-direction:column;gap:4px;max-height:60px;overflow:hidden")}>
                    {vm.memoItems.slice(0, 3).map((m, i) => (
                      <div key={i} style={css("display:flex;gap:6px;align-items:baseline")}>
                        <span style={css("color:var(--blue-700);font-weight:700;flex:none;font-size:11px")}>•</span>
                        <span style={css("font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{m}</span>
                      </div>
                    ))}
                    {vm.memoEmpty && (
                      <span style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>통화 중 작성한 메모가 없습니다</span>
                    )}
                  </div>
                </div>
              </div>

              <div style={css("flex:none;display:flex;align-items:center;justify-content:center;gap:7px;color:var(--gray-600);font:600 11.5px 'Geist Sans','Pretendard',sans-serif")}>
                <span className="mi" style={css("font-size:16px")}>call_merge</span>
                두 재료가 하나의 후처리 초안으로 합쳐졌습니다
                <span className="mi" style={css("font-size:16px")}>arrow_downward</span>
              </div>

              <div className="card" style={css("flex:1;min-height:0;padding:16px 18px;box-shadow:var(--sh-near);display:flex;flex-direction:column;overflow:hidden")}>
                <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:8px")}>
                  <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>auto_awesome</span>
                  <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>후처리 초안</span>
                  <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>자동 작성됨 · 열어서 확인·수정</span>
                </div>
                <div style={css("flex:1;min-height:0;overflow:hidden;position:relative")}>
                  <div style={css("font:400 13px/1.7 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
                    {vm.wrapSummaryDefault}
                  </div>
                  <div style={css("position:absolute;left:0;right:0;bottom:0;height:46px;background:linear-gradient(transparent,var(--onair-surface))")} />
                </div>
              </div>
            </div>
          )}

          {/* 바텀업 시트 — 열리면 재료 패널 위로 올라온다 */}
          {vm.wrapReady && vm.wrapSheetOpen && (
            <div style={css("position:absolute;left:0;right:0;bottom:0;top:44px;background:var(--onair-surface);border-radius:20px;box-shadow:var(--sh-modal);display:flex;flex-direction:column;overflow:visible;z-index:25;animation:dockUp .3s ease")}>
              <div onClick={vm.toggleWrapSheet} style={css("display:flex;align-items:center;justify-content:center;padding:8px 0 4px;cursor:pointer")} title="시트 접기">
                <span style={css("width:48px;height:5px;border-radius:9999px;background:var(--color-border)")} />
              </div>
              <div style={css("padding:4px 24px 14px;border-bottom:1px solid var(--gray-200);display:flex;align-items:center;gap:12px")}>
                <div style={css("flex:1;min-width:0")}>
                  <div style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:3px")}>{vm.wrapType} · 거래 확인 문의</div>
                  <div style={css("font:600 20px/1.2 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.3px;color:var(--gray-1000)")}>후처리 작성</div>
                </div>
                <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700);background:var(--gray-100);border-radius:9999px;padding:5px 11px")}>통화 {vm.clockStr}</span>
                <span style={css("display:inline-flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;background:var(--gray-100);color:var(--gray-800);padding:5px 11px;border-radius:9999px")}>
                  <span className="mi" style={css("font-size:14px;color:var(--blue-700)")}>auto_awesome</span>녹취 + 메모 기반 자동 작성 · 모두 수정 가능
                </span>
                <span onClick={vm.toggleWrapSheet} className="mi" style={css("font-size:22px;color:var(--gray-500);cursor:pointer")}>expand_more</span>
              </div>

              <div style={css("flex:1;display:flex;gap:18px;padding:16px 24px;min-height:0")}>
                {/* 좌: 요약 + 후속조치 */}
                <div style={css("flex:1.5;display:flex;flex-direction:column;min-width:0;gap:14px")}>
                  <div style={css("flex:1;display:flex;flex-direction:column;min-height:0")}>
                    <div style={css("display:flex;justify-content:space-between;align-items:center;margin-bottom:7px")}>
                      <span style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>상담 내용 요약 <span style={css("font-weight:400;color:var(--blue-700)")}>· 클릭해 편집</span></span>
                      <span style={css("display:inline-flex;align-items:center;gap:3px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);cursor:pointer")}>
                        <span className="mi" style={css("font-size:15px")}>refresh</span> 다시 생성
                      </span>
                    </div>
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      onInput={vm.onSummary}
                      style={css("flex:1;border:1px solid var(--gray-300);border-radius:14px;padding:15px 17px;font:400 14px/1.8 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);background:#fff;overflow:auto;outline:none")}
                    >
                      {vm.wrapSummaryDefault}
                    </div>
                  </div>
                  <div style={css("flex:none")}>
                    <div style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:8px")}>후속 조치</div>
                    <div style={css("display:flex;flex-direction:column;gap:7px")}>
                      {vm.followups.map((f, i) => (
                        <div key={i} style={css("display:flex;align-items:center;gap:8px;background:var(--gray-100);border-radius:14px;padding:9px 12px")}>
                          <span className="mi" style={css("font-size:16px;color:var(--gray-700)")}>{f.icon}</span>
                          <span style={css("flex:1;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{f.label}</span>
                          <span onClick={f.remove} style={css("cursor:pointer;display:flex")} title="삭제">
                            <span className="mi" style={css("font-size:17px;color:var(--gray-500)")}>close</span>
                          </span>
                        </div>
                      ))}
                      {vm.noFollowups && (
                        <div style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500);padding:2px")}>등록된 후속 조치가 없습니다</div>
                      )}
                    </div>
                    <div style={css("display:flex;align-items:center;gap:7px;margin-top:9px;flex-wrap:wrap")}>
                      <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>추천 추가</span>
                      {vm.recoFollowups.map((f, i) => (
                        <span key={i} onClick={f.add} style={css("display:inline-flex;align-items:center;gap:3px;font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);border:1px dashed var(--blue-400);border-radius:9999px;padding:4px 10px;cursor:pointer")}>
                          <span className="mi" style={css("font-size:14px")}>add</span>{f.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 우: 항목 + 메모 */}
                <div style={css("width:330px;flex:none;display:flex;flex-direction:column;gap:12px;overflow:visible")}>
                  <div style={css("display:flex;flex-direction:column;gap:8px")}>
                    <EditRow label="고객" value={`${vm.customerName} · ${vm.customerNumber}`} />
                    <EditRow label="상담사" value="김키움 · A-2231" />
                    <EditRow label="일시" value="2026.07.15 14:32" small />
                  </div>

                  <SelectField label="상담 유형" value={vm.wrapType} open={vm.typeMenu} onToggle={vm.toggleTypeMenu} opts={vm.typeOpts} />
                  <SelectField label="상담 결과" value={vm.wrapResult} open={vm.resultMenu} onToggle={vm.toggleResultMenu} opts={vm.resultOpts} />

                  <div style={css("flex:1;display:flex;flex-direction:column;min-height:0")}>
                    <div className="lbl" style={css("margin-bottom:5px")}>상담 메모 · 불릿</div>
                    <div style={css("flex:1;border-radius:14px;background:var(--gray-100);display:flex;flex-direction:column;overflow:hidden")}>
                      <div style={css("flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:6px")}>
                        {vm.memoItems.map((m, i) => (
                          <div key={i} style={css("display:flex;gap:7px;align-items:baseline")}>
                            <span style={css("color:var(--blue-700);font-weight:700;flex:none")}>•</span>
                            <span style={css("font:400 12.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{m}</span>
                          </div>
                        ))}
                        {vm.memoEmpty && (
                          <div style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>통화 중 작성한 메모가 없습니다</div>
                        )}
                      </div>
                      <div style={css("flex:none;display:flex;align-items:center;gap:7px;padding:8px 12px;border-top:1px solid var(--gray-200)")}>
                        <span style={css("color:var(--blue-700);font-weight:700")}>•</span>
                        <input value={vm.memoDraft} onChange={vm.onMemoDraft} onKeyDown={vm.onMemoKey} placeholder="메모 추가 후 Enter" style={css("flex:1;border:none;outline:none;background:transparent;font:400 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:12px 24px;border-top:1px solid var(--gray-200)")}>
                <span style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>MVP 상담 결과 · 저장 시 상담 이력에 기록</span>
                <div style={css("flex:1")} />
                <span style={css("font:500 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);text-decoration:underline;text-underline-offset:2px;cursor:pointer")}>임시 저장</span>
                <span onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border:1px solid var(--gray-500);border-radius:9999px;font-size:14px;font-weight:700;color:var(--gray-1000);cursor:pointer")}>
                  <span className="mi" style={css("font-size:18px")}>coffee</span> 저장 후 휴식
                </span>
                <span onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 22px;background:var(--blue-700);color:#fff;border-radius:9999px;font-weight:700;font-size:14px;cursor:pointer")}>
                  <span className="mi" style={css("font-size:18px")}>call</span> 저장 후 다음 콜
                </span>
              </div>
            </div>
          )}

          {/* 접힌 상태 바 */}
          {vm.wrapReady && !vm.wrapSheetOpen && (
            <div style={css("position:absolute;left:0;right:0;bottom:0;padding:15px 24px;background:var(--onair-surface);border-radius:20px;box-shadow:var(--sh-focus);display:flex;align-items:center;gap:12px;z-index:20")}>
              <span className="mi" style={css("font-size:22px;color:var(--gray-700)")}>expand_less</span>
              <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>후처리 작성 시트가 접혀 있습니다</span>
              <div style={css("flex:1")} />
              <span onClick={vm.toggleWrapSheet} style={css("display:inline-flex;align-items:center;gap:6px;padding:9px 20px;background:var(--blue-700);color:#fff;border-radius:9999px;font:700 13px 'Geist Sans','Pretendard',sans-serif;cursor:pointer")}>
                <span className="mi" style={css("font-size:16px")}>edit_note</span> 후처리 작성 열기
              </span>
            </div>
          )}
        </div>
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
          <div style={css("position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--onair-surface);border-radius:14px;box-shadow:var(--sh-modal);z-index:40;overflow:hidden")}>
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
