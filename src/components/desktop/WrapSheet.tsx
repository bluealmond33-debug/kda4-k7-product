import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import DesktopShell from "./DesktopShell";

const DONE_LIST = [
  { name: "고객 · 정OO", meta: "14:05", type: "수신 › 이체한도" },
  { name: "고객 · 이OO", meta: "13:40", type: "카드 › 재발급" },
];

/** 1b — 통화 종료 · 후처리. 요약 로딩 → 후처리 시트(요약·후속조치·항목·메모). */
export default function WrapSheet({ vm }: { vm: CallFlowVM }) {
  return (
    <DesktopShell flex>
      {/* 상단 알약 (종료됨) */}
      <div style={css("height:74px;flex:none;background:#fff;border-bottom:1px solid var(--color-border);position:relative;z-index:5")}>
        <div className="pill" style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)")}>
          <span style={css("display:flex;align-items:center;gap:8px")}>
            <span style={css("width:9px;height:9px;border-radius:9999px;background:var(--gray-600)")} />
            <span style={css("font-weight:700;font-size:15px;color:var(--gray-1000)")}>통화 종료됨</span>
          </span>
          <span style={css("display:flex;align-items:center;gap:4px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);background:var(--gray-100);border:1px solid var(--gray-300);border-radius:9999px;padding:3px 9px")}>
            <span className="mi" style={css("font-size:13px;color:var(--green-700)")}>check_circle</span> 녹취 완료
          </span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>
            전자금융 <span style={css("color:var(--gray-600)")}>›</span> 착오송금
          </span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;align-items:center;gap:6px;font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>
            <span className="mi" style={css("font-size:17px;color:var(--gray-600)")}>call_end</span>010-****-4821
          </span>
          <span style={css("font:500 15px 'Geist Mono','IBM Plex Mono',monospace")}>{vm.clockStr}</span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;gap:5px")}>
            <span className="cbtn" title="녹취 다시 듣기"><span className="mi" style={css("font-size:19px")}>play_arrow</span></span>
            <span className="cbtn" title="통화 요약 복사"><span className="mi" style={css("font-size:19px")}>content_copy</span></span>
          </span>
        </div>
      </div>

      <div style={css("flex:1;display:flex;gap:16px;padding:16px;min-height:0")}>
        {/* 좌 컬럼 */}
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

          <div className="card" style={css("padding:16px")}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;margin-bottom:12px")}>
              <span className="sechd">고객</span>
              <span style={css("display:inline-flex;align-items:center;gap:4px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900);background:#fff;border:1px solid var(--green-400);border-radius:9999px;padding:4px 10px")}>
                <span className="mi" style={css("font-size:14px")}>verified</span> 인증 완료
              </span>
            </div>
            <div style={css("display:flex;align-items:center;gap:12px")}>
              <span className="av" style={css("width:46px;height:46px")}><span className="mi" style={css("font-size:26px")}>person</span></span>
              <div>
                <div style={css("font-weight:700;font-size:18px;line-height:1.2")}>김케이</div>
                <div style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:2px")}>
                  개인 고객 · <span style={css("font-family:'Geist Mono','IBM Plex Mono',monospace")}>C-10482391</span>
                </div>
              </div>
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
                  <span style={css("font-weight:700;font-size:14px")}>고객 · 김OO</span>
                  <span style={css("font:700 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-left:auto")}>지금 후처리 중</span>
                </div>
                <div style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);margin-top:4px")}>전자금융 › 착오송금</div>
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
            <div style={css("position:absolute;inset:0;background:#fff;border:1px solid var(--color-border);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px")}>
              <span style={css("width:42px;height:42px;border:3px solid var(--blue-400);border-top-color:var(--blue-700);border-radius:9999px;animation:spin .8s linear infinite")} />
              <div style={css("font:700 18px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>통화 내용을 요약하고 있습니다…</div>
              <div style={css("font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>녹취와 상담원 메모를 바탕으로 후처리 초안을 작성 중입니다</div>
            </div>
          )}

          {vm.wrapReady &&
            (vm.wrapSheetOpen ? (
              <div style={css("position:absolute;inset:0;background:#fff;border:1px solid var(--color-border);border-radius:12px;box-shadow:var(--shadow-card);display:flex;flex-direction:column;overflow:visible")}>
                <div onClick={vm.toggleWrapSheet} style={css("display:flex;align-items:center;justify-content:center;padding:8px 0 4px;cursor:pointer")}>
                  <span style={css("width:48px;height:5px;border-radius:9999px;background:var(--color-border)")} />
                </div>
                <div style={css("padding:4px 24px 14px;border-bottom:1px solid var(--gray-200);display:flex;align-items:center;gap:12px")}>
                  <div style={css("flex:1;min-width:0")}>
                    <div style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:3px")}>{vm.wrapType} · 거래 확인 문의</div>
                    <div style={css("font:600 20px/1.2 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.3px;color:var(--gray-1000)")}>후처리 작성</div>
                  </div>
                  <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700);background:var(--gray-100);border-radius:9999px;padding:5px 11px")}>통화 {vm.clockStr}</span>
                  <span style={css("display:inline-flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;background:#fff;color:var(--gray-800);border:1px solid var(--gray-300);padding:5px 11px;border-radius:9999px")}>
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
                        style={css("flex:1;border:1px solid var(--gray-400);border-radius:8px;padding:15px 17px;font:400 14px/1.8 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);background:#fff;overflow:auto;outline:none")}
                      >
                        고객 김케이님, 금일 오전 지인 계좌로 이체 중 착오송금 발생(30만원). 거래 시각·수취 계좌 확인 후 착오송금 반환지원 제도 안내함. 본인인증 완료 상태. 고객 불안 발화가 감지되어 안정 유도함. 반환 확정 표현은 사용하지 않음. 사고대응팀으로 이관 및 콜백 예약 처리.
                      </div>
                    </div>
                    <div style={css("flex:none")}>
                      <div style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:8px")}>후속 조치</div>
                      <div style={css("display:flex;flex-direction:column;gap:7px")}>
                        {vm.followups.map((f, i) => (
                          <div key={i} style={css("display:flex;align-items:center;gap:8px;border:1px solid var(--gray-300);background:#fff;border-radius:8px;padding:9px 11px")}>
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
                      <EditRow label="고객" value="김케이 · C-10482391" />
                      <EditRow label="상담사" value="김키움 · A-2231" />
                      <EditRow label="일시" value="2026.07.15 14:32" small />
                    </div>

                    <SelectField label="상담 유형" value={vm.wrapType} open={vm.typeMenu} onToggle={vm.toggleTypeMenu} opts={vm.typeOpts} />
                    <SelectField label="상담 결과" value={vm.wrapResult} open={vm.resultMenu} onToggle={vm.toggleResultMenu} opts={vm.resultOpts} />

                    <div style={css("flex:1;display:flex;flex-direction:column;min-height:0")}>
                      <div className="lbl" style={css("margin-bottom:5px")}>상담 메모 · 불릿</div>
                      <div style={css("flex:1;border:1px solid var(--gray-300);border-radius:8px;background:var(--background-200);display:flex;flex-direction:column;overflow:hidden")}>
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
                  <span style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>개인정보 마스킹 적용 · 저장 시 상담 이력에 기록</span>
                  <div style={css("flex:1")} />
                  <span style={css("font:500 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);text-decoration:underline;text-underline-offset:2px;cursor:pointer")}>임시 저장</span>
                  <span onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 18px;border:1px solid var(--gray-500);border-radius:6px;font-size:14px;font-weight:700;color:var(--gray-1000);cursor:pointer")}>
                    <span className="mi" style={css("font-size:18px")}>coffee</span> 저장 후 휴식
                  </span>
                  <span onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:var(--blue-700);color:#fff;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer")}>
                    <span className="mi" style={css("font-size:18px")}>call</span> 저장 후 다음 콜
                  </span>
                </div>
              </div>
            ) : (
              <div style={css("position:absolute;left:0;right:0;bottom:0;padding:15px 24px;background:#fff;border:1px solid var(--gray-300);border-radius:12px;display:flex;align-items:center;gap:12px;z-index:20")}>
                <span className="mi" style={css("font-size:22px;color:var(--gray-700)")}>expand_less</span>
                <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>후처리 작성 시트가 접혀 있습니다</span>
                <div style={css("flex:1")} />
                <span onClick={vm.toggleWrapSheet} style={css("display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:var(--blue-700);color:#fff;border-radius:6px;font:700 13px 'Geist Sans','Pretendard',sans-serif;cursor:pointer")}>
                  <span className="mi" style={css("font-size:16px")}>edit_note</span> 후처리 작성 열기
                </span>
              </div>
            ))}
        </div>
      </div>
    </DesktopShell>
  );
}

function EditRow({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div style={css("display:flex;align-items:center;gap:8px;border:1px solid var(--gray-300);border-radius:6px;padding:7px 10px")}>
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
      <div onClick={onToggle} style={css("display:flex;align-items:center;justify-content:space-between;border:1px solid var(--gray-400);border-radius:6px;padding:9px 11px;cursor:pointer;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
        {value}
        <span className="mi" style={css("font-size:17px;color:var(--gray-600)")}>expand_more</span>
      </div>
      {open && (
        <div style={css("position:absolute;left:0;right:0;top:calc(100% + 4px);background:#fff;border:1px solid var(--gray-300);border-radius:8px;box-shadow:var(--shadow-popover);z-index:40;overflow:hidden")}>
          {opts.map((o, i) => (
            <div key={i} onClick={o.pick} style={css("padding:9px 12px;font:400 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);cursor:pointer")}>{o.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}
