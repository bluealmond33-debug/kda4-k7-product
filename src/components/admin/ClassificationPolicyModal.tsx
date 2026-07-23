import { useEffect, type ReactNode } from "react";
import { css } from "../../lib/css";
import { SGE_META, type Sge } from "../../services";

/* ── 1층: 우선순위 게이트에서 갈라지는 3분기 (E→S→G 순) ── */
const LANES: Array<{ k: Sge; title: string; dest: string; brief: string }> = [
  { k: "E", title: "긴급", dest: "사고·신고 직결", brief: "정황 결합 시 · 대기열 최우선" },
  { k: "S", title: "단순", dest: "AI 즉시 응대", brief: "정형 조회·신청 · 대기열 없음" },
  { k: "G", title: "일반", dest: "부서 배정", brief: "상담사 큐 → 배정" },
];

/* ── 2층 부서 + 3층 업무코드(ARS 코드) — backend/app/routing/taxonomy.py 기준 ── */
type Code = { c: string | null; t: string };
const DEPTS: Array<{ name: string; dep: string; emg?: boolean; codes: Code[] }> = [
  { name: "수신·예적금", dep: "DEP", codes: [
    { c: "G007", t: "예적금·발행어음" }, { c: "G012", t: "주택청약" }, { c: "G006", t: "자동이체" },
    { c: "G005", t: "거래내역" }, { c: "G003", t: "이체한도" }, { c: "G004", t: "일반·기타" } ] },
  { name: "여신·대출", dep: "LON", codes: [
    { c: "G002", t: "대출" }, { c: "G008", t: "금리·이자" }, { c: "G009", t: "금리인하요구" } ] },
  { name: "카드·결제", dep: "CRD", codes: [
    { c: null, t: "카드 승인·한도" }, { c: null, t: "결제대금" }, { c: null, t: "포인트" }, { c: null, t: "리볼빙·할부" } ] },
  { name: "외환·수출입", dep: "FX", codes: [
    { c: "G010", t: "외환(해외송금·환전)" }, { c: null, t: "송금 취소·반환" }, { c: null, t: "외화계좌" } ] },
  { name: "전자금융·디지털", dep: "EFN", codes: [
    { c: null, t: "공동인증서" }, { c: null, t: "OTP 재발급" }, { c: null, t: "이체 비밀번호" }, { c: null, t: "비대면 계좌 해제" } ] },
  { name: "연금·신탁·투자", dep: "INV", codes: [
    { c: "G011", t: "연금·IRP" }, { c: null, t: "펀드·신탁" }, { c: null, t: "디폴트옵션" } ] },
  { name: "사고·신고", dep: "SG", emg: true, codes: [
    { c: "G001", t: "착오송금 반환" }, { c: null, t: "보이스피싱" }, { c: null, t: "명의도용·해킹" },
    { c: null, t: "지급정지" }, { c: null, t: "분실·도난" } ] },
];

const FONT = "'Geist Sans','Pretendard',sans-serif";
const MONO = "'Geist Mono',monospace";

/** n8n식 흐름 노드 — 얇은 테두리 + 위·아래 포트 점, 색은 배경에 쓰지 않는다. */
function Node({ w, children, ports = "both", accent }: { w: number; children: ReactNode; ports?: "both" | "bottom" | "top" | "none"; accent?: string }) {
  const port = "position:absolute;left:50%;transform:translateX(-50%);width:8px;height:8px;border-radius:9999px;background:var(--onair-surface);border:1.5px solid " + (accent || "var(--gray-400)");
  return (
    <div style={css("position:relative;width:" + w + "px;max-width:100%;background:var(--onair-surface);border:1.5px solid " + (accent || "var(--gray-300)") + ";border-radius:11px;box-shadow:var(--sh-near);padding:11px 14px")}>
      {(ports === "both" || ports === "top") && <span style={css(port + ";top:-5px")} />}
      {(ports === "both" || ports === "bottom") && <span style={css(port + ";bottom:-5px")} />}
      {children}
    </div>
  );
}

/**
 * 분류 정책 · 라우팅 파이프라인 — n8n식 노드 그래프.
 * 콜 인입 → 규칙 게이트(필터) →〈E·S·G 분기〉→ 부서 7종 → 업무코드(ARS).
 * 색은 배경/상단바에 쓰지 않고 신호(E/S/G 점·글자·테두리, 사고신고 테두리)에만.
 */
export default function ClassificationPolicyModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 팬아웃 SVG 좌표(콘텐츠 폭 700 기준): 게이트 하단 중앙 → E/S/G 3열 상단
  const W = 700, cE = 112.67, cS = 350, cG = 587.33;

  return (
    <>
      <div onClick={onClose} style={css("position:fixed;inset:0;z-index:900;background:rgba(22,20,17,.45);animation:fadeIn .25s ease-out;cursor:pointer")} />
      <div style={css("position:fixed;left:50%;top:50%;z-index:901;transform:translate(-50%,-50%);width:788px;max-width:94vw;max-height:90vh;display:flex;flex-direction:column;background:var(--gray-100);border-radius:16px;box-shadow:var(--sh-modal);animation:modalIn .3s var(--ease-out);overflow:hidden")}>
        {/* 헤더 */}
        <div style={css("display:flex;align-items:center;gap:9px;padding:16px 20px 14px;flex:none;background:var(--onair-surface);border-bottom:1px solid var(--gray-200)")}>
          <span className="mi" style={css("font-size:20px;color:var(--blue-700)")}>account_tree</span>
          <span style={css("font:800 15px " + FONT + ";color:var(--gray-1000)")}>분류 정책 · 라우팅 파이프라인</span>
          <span style={css("font:400 11.5px " + FONT + ";color:var(--gray-600)")}>· 콜 인입 → 게이트 → 부서 → 업무코드</span>
          <div style={css("flex:1")} />
          <span onClick={onClose} style={css("cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
          </span>
        </div>

        <div style={css("flex:1;overflow-y:auto;padding:20px 20px 22px")}>
          {/* ══ 상단 n8n 흐름: 입력 → 게이트 → 분기 ══ */}
          <div style={css("width:" + W + "px;max-width:100%;margin:0 auto;display:flex;flex-direction:column;align-items:center")}>
            {/* 입력 */}
            <Node w={230} ports="bottom">
              <div style={css("display:flex;align-items:center;gap:8px")}>
                <span className="mi" style={css("font-size:17px;color:var(--gray-700)")}>graphic_eq</span>
                <div>
                  <div style={css("font:800 12.5px " + FONT + ";color:var(--gray-1000)")}>콜 인입</div>
                  <div style={css("font:400 10.5px " + FONT + ";color:var(--gray-600)")}>실시간 STT 전사</div>
                </div>
              </div>
            </Node>
            {/* 직선 커넥터 */}
            <svg width="24" height="26" viewBox="0 0 24 26" style={{ display: "block" }}>
              <line x1="12" y1="0" x2="12" y2="20" stroke="var(--gray-400)" strokeWidth="1.5" />
              <path d="M8 16 L12 21 L16 16" fill="none" stroke="var(--gray-400)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {/* 게이트(필터) */}
            <Node w={430}>
              <div style={css("display:flex;align-items:center;gap:9px")}>
                <span className="mi" style={css("font-size:18px;color:var(--blue-700)")}>filter_alt</span>
                <div style={css("flex:1")}>
                  <div style={css("display:flex;align-items:baseline;gap:7px")}>
                    <span style={css("font:800 13px " + FONT + ";color:var(--gray-1000)")}>규칙 게이트 · 우선순위 판정</span>
                    <span style={css("font:600 10px " + FONT + ";color:var(--gray-600)")}>LLM보다 먼저</span>
                  </div>
                  <div style={css("font:400 10.5px/1.5 " + FONT + ";color:var(--gray-700);margin-top:2px")}>
                    단일 단어로는 판정하지 않음 — “기관 사칭 + 송금 요구”처럼 <b style={css("color:var(--gray-900)")}>정황이 결합될 때</b> 긴급으로 여과.
                  </div>
                </div>
              </div>
            </Node>
            {/* 팬아웃 3분기 */}
            <svg width={W} height="46" viewBox={"0 0 " + W + " 46"} preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", maxWidth: W + "px" }}>
              {[cE, cS, cG].map((x, i) => (
                <path key={i} d={"M" + cS + " 0 C " + cS + " 24 " + x + " 22 " + x + " 46"} fill="none" stroke="var(--gray-400)" strokeWidth="1.5" />
              ))}
              {[cE, cS, cG].map((x, i) => <circle key={"d" + i} cx={x} cy={45} r={2.5} fill="var(--gray-400)" />)}
            </svg>
            {/* E/S/G 분기 노드 — 색은 점·글자·테두리(신호), 배경 없음 */}
            <div style={css("width:100%;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px")}>
              {LANES.map((l) => {
                const m = SGE_META[l.k];
                return (
                  <div key={l.k} style={css("position:relative;background:var(--onair-surface);border:1.5px solid " + m.bar + ";border-radius:11px;box-shadow:var(--sh-near);padding:11px 13px")}>
                    <span style={css("position:absolute;left:50%;top:-5px;transform:translateX(-50%);width:8px;height:8px;border-radius:9999px;background:var(--onair-surface);border:1.5px solid " + m.bar)} />
                    <div style={css("display:flex;align-items:center;gap:7px")}>
                      <span style={css("flex:none;width:20px;height:20px;border-radius:9999px;border:1.5px solid " + m.bar + ";display:flex;align-items:center;justify-content:center;font:800 10.5px " + MONO + ";color:" + m.fg)}>{l.k}</span>
                      <span style={css("font:800 13px " + FONT + ";color:var(--gray-1000)")}>{l.title}</span>
                    </div>
                    <div style={css("font:700 11px " + FONT + ";color:var(--gray-900);margin-top:7px")}>→ {l.dest}</div>
                    <div style={css("font:400 10px/1.45 " + FONT + ";color:var(--gray-600);margin-top:2px")}>{l.brief}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 분기 → 부서 연결 설명 */}
          <div style={css("display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 0 12px")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-400)")}>arrow_downward</span>
            <span style={css("font:500 10.5px " + FONT + ";color:var(--gray-600)")}>긴급(E) → 사고·신고 직결 · 단순(S)/일반(G) → 주제별 부서로 라우팅</span>
          </div>

          {/* ══ 부서 7종 + 업무코드 ══ */}
          <div style={css("font:700 10.5px " + FONT + ";letter-spacing:.3px;color:var(--gray-700);padding:0 2px 9px")}>
            2층 부서 7종 · 3층 업무코드(ARS) — 부서 코드 = RAG 규정검색 필터
          </div>
          <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:9px")}>
            {DEPTS.map((d) => (
              <div key={d.name} style={css("position:relative;background:var(--onair-surface);border:1.5px solid " + (d.emg ? "var(--red-400)" : "var(--gray-300)") + ";border-radius:11px;box-shadow:var(--sh-near);padding:11px 13px")}>
                <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:8px")}>
                  <span style={css("font:800 9px " + MONO + ";color:var(--gray-500);letter-spacing:.5px")}>{d.dep}</span>
                  <span style={css("font:700 12.5px " + FONT + ";color:var(--gray-1000)")}>{d.name}</span>
                  {d.emg && <span style={css("font:800 8.5px " + FONT + ";color:#fff;background:var(--red-800);border-radius:9999px;padding:1.5px 6px")}>E 직결</span>}
                </div>
                <div style={css("display:flex;flex-wrap:wrap;gap:5px")}>
                  {d.codes.map((code) => (
                    <span key={code.t} style={css("display:inline-flex;align-items:center;gap:5px;background:var(--gray-100);border-radius:7px;padding:3px 7px 3px " + (code.c ? "5px" : "7px"))}>
                      {code.c && <span style={css("font:800 8.5px " + MONO + ";color:var(--blue-700)")}>{code.c}</span>}
                      <span style={css("font:500 10.5px " + FONT + ";color:var(--gray-800)")}>{code.t}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 각주 */}
          <div style={css("margin-top:13px;display:flex;gap:8px;align-items:flex-start;background:var(--onair-surface);border-radius:10px;padding:11px 13px")}>
            <span className="mi" style={css("flex:none;font-size:15px;color:var(--blue-700);margin-top:1px")}>info</span>
            <span style={css("font:400 11px/1.6 " + FONT + ";color:var(--gray-800)")}>
              부서 코드가 규정검색(RAG) 대분류와 같아서 <b style={css("color:var(--gray-1000)")}>부서 확정 = 규정검색 필터 확정</b>.
              긴급 게이트는 규칙 기반이라 LLM 판단보다 <b style={css("color:var(--gray-1000)")}>먼저</b> 겁니다. (ETC 제도·민원은 문서분류 전용 — 라우팅 큐 아님)
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
