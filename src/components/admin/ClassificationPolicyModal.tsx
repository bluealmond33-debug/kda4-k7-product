import { useEffect, useRef, useState, type ReactNode } from "react";
import { css } from "../../lib/css";
import { BeamPath } from "../ui/AnimatedBeam";
import { SGE_META } from "../../services";

const FONT = "'Avenir Next','Pretendard',sans-serif";
const MONO = "'Avenir Next','Pretendard',sans-serif";

/* ── 노드 좌표 (절대 캔버스, 콜 인입→게이트→E/S/G→목적지 왼→오른) ── */
type N = { x: number; y: number; w: number; h: number };
const NODES = {
  input: { x: 0, y: 198, w: 176, h: 56 },
  gate: { x: 216, y: 181, w: 252, h: 92 },
  E: { x: 508, y: 11, w: 150, h: 64 },
  S: { x: 508, y: 104, w: 150, h: 64 },
  G: { x: 508, y: 378, w: 150, h: 64 },
  SG: { x: 700, y: 0, w: 300, h: 86 },
  AI: { x: 700, y: 98, w: 300, h: 78 },
  DEP: { x: 700, y: 188, w: 300, h: 88 },
  LON: { x: 700, y: 288, w: 300, h: 60 },
  CRD: { x: 700, y: 360, w: 300, h: 60 },
  FX: { x: 700, y: 432, w: 300, h: 60 },
  EFN: { x: 700, y: 504, w: 300, h: 60 },
  INV: { x: 700, y: 576, w: 300, h: 60 },
} satisfies Record<string, N>;
const CW = 1000, CH = 636;
type Key = keyof typeof NODES;
const rMid = (n: N) => ({ x: n.x + n.w, y: n.y + n.h / 2 });
const lMid = (n: N) => ({ x: n.x, y: n.y + n.h / 2 });

/* 엣지: [from, to] — from 오른쪽 포트 → to 왼쪽 포트 */
const EDGES: Array<[Key, Key]> = [
  ["input", "gate"],
  ["gate", "E"], ["gate", "S"], ["gate", "G"],
  ["E", "SG"], ["S", "AI"],
  ["G", "DEP"], ["G", "LON"], ["G", "CRD"], ["G", "FX"], ["G", "EFN"], ["G", "INV"],
];

type Code = { c?: string; t: string };
const chips = (codes: Code[]) => (
  <div style={css("display:flex;flex-wrap:wrap;gap:4px")}>
    {codes.map((code) => (
      <span key={code.t} style={css("display:inline-flex;align-items:center;gap:4px;background:var(--gray-100);border-radius:6px;padding:2.5px 6px 2.5px " + (code.c ? "4px" : "6px"))}>
        {code.c && <span style={css("font:800 8px " + MONO + ";color:var(--blue-700)")}>{code.c}</span>}
        <span style={css("font:500 9.5px " + FONT + ";color:var(--gray-800)")}>{code.t}</span>
      </span>
    ))}
  </div>
);

/** 절대배치 노드 상자 — 얇은 테두리, 색은 테두리(신호)에만. */
function Box({ n, border, children }: { n: N; border?: string; children: ReactNode }) {
  return (
    <div style={css("position:absolute;left:" + n.x + "px;top:" + n.y + "px;width:" + n.w + "px;height:" + n.h + "px;box-sizing:border-box;background:var(--onair-surface);border:1.5px solid " + (border || "var(--gray-300)") + ";border-radius:11px;box-shadow:var(--sh-near);padding:9px 12px;overflow:hidden")}>
      {children}
    </div>
  );
}

/** 부서 노드 헤더(코드 · 이름) */
function DeptHead({ code, name, emg }: { code: string; name: string; emg?: boolean }) {
  return (
    <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:6px")}>
      <span style={css("font:800 8.5px " + MONO + ";color:var(--gray-500);letter-spacing:.5px")}>{code}</span>
      <span style={css("font:700 12px " + FONT + ";color:var(--gray-1000)")}>{name}</span>
      {emg && <span style={css("font:800 8px " + FONT + ";color:#fff;background:var(--red-800);border-radius:9999px;padding:1px 5px")}>E 직결</span>}
    </div>
  );
}

/**
 * 분류 정책 · 라우팅 파이프라인 — n8n식 가로(왼→오른) 노드 그래프.
 * 콜 인입 → 규칙 게이트(필터) → 〈E·S·G 분기〉 → 각 등급이 자기 부서·업무코드로 연결.
 *   E 긴급 → 사고·신고(SG) 직결 · S 단순 → AI 즉시응대 · G 일반 → 주제 부서 6종.
 * 색은 배경에 쓰지 않고 신호(E/S/G·사고신고 테두리)에만.
 */
export default function ClassificationPolicyModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mE = SGE_META.E, mS = SGE_META.S, mG = SGE_META.G;

  // 미니맵 — 스크롤 뷰포트 추적(캔버스가 창보다 커서 넘칠 때 현재 위치 표시)
  const PAD = 20;
  const scrollRef = useRef<HTMLDivElement>(null);
  // 미니맵 접기 — 우측 하단에 떠 있어 파이프라인 오른쪽 아래(INV 등)를 가린다.
  // 길잡이일 뿐 본문이 아니므로 언제든 치울 수 있어야 한다.
  const [mapOpen, setMapOpen] = useState(true);
  const [vp, setVp] = useState({ sl: 0, st: 0, cw: 0, ch: 0 });
  const syncVp = () => {
    const el = scrollRef.current;
    if (el) setVp({ sl: el.scrollLeft, st: el.scrollTop, cw: el.clientWidth, ch: el.clientHeight });
  };
  useEffect(() => { syncVp(); }, []);
  const MMW = 172, MMH = Math.round((MMW * CH) / CW);
  // 노드 색(미니맵) — 등급/사고신고만 색, 나머지 회색
  const mmColor: Partial<Record<Key, string>> = { E: mE.bar, S: mS.bar, G: mG.bar, SG: "var(--red-400)" };
  const vx = Math.max(0, vp.sl - PAD), vy = Math.max(0, vp.st - PAD);
  const vw = Math.max(0, Math.min(CW, vp.sl - PAD + vp.cw) - vx), vh = Math.max(0, Math.min(CH, vp.st - PAD + vp.ch) - vy);
  const jump = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * CW, py = ((e.clientY - r.top) / r.height) * CH;
    scrollRef.current?.scrollTo({ left: px - vp.cw / 2 + PAD, top: py - vp.ch / 2 + PAD, behavior: "smooth" });
  };

  return (
    <>
      <div onClick={onClose} style={css("position:fixed;inset:0;z-index:900;background:rgba(22,20,17,.45);animation:fadeIn .25s ease-out;cursor:pointer")} />
      <div style={css("position:fixed;left:50%;top:50%;z-index:901;transform:translate(-50%,-50%);width:840px;max-width:94vw;height:76vh;max-height:760px;display:flex;flex-direction:column;background:var(--gray-100);border-radius:16px;box-shadow:var(--sh-modal);animation:modalIn .3s var(--ease-out);overflow:hidden")}>
        {/* 헤더 */}
        <div style={css("display:flex;align-items:center;gap:9px;padding:16px 20px 14px;flex:none;background:var(--onair-surface);border-bottom:1px solid var(--gray-200)")}>
          <span className="mi" style={css("font-size:20px;color:var(--blue-700)")}>account_tree</span>
          <span style={css("font:800 15px " + FONT + ";color:var(--gray-1000)")}>분류 정책 · 라우팅 파이프라인</span>
          <span style={css("font:400 11.5px " + FONT + ";color:var(--gray-600)")}>· 콜 인입 → 게이트 → 등급별 부서·업무코드</span>
          <div style={css("flex:1")} />
          <span onClick={onClose} style={css("cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
          </span>
        </div>

        <div ref={scrollRef} onScroll={syncVp} style={css("flex:1;overflow:auto;padding:20px 20px 150px")}>
          {/* ── n8n 캔버스: 점 그리드 배경 + 절대배치 노드 + SVG 엣지 ── */}
          <div style={css("position:relative;width:" + CW + "px;height:" + CH + "px;margin:0 auto;background-image:radial-gradient(var(--gray-300) 1px,transparent 0);background-size:19px 19px;background-position:8px 8px")}>
            {/* 엣지 레이어 */}
            <svg width={CW} height={CH} viewBox={"0 0 " + CW + " " + CH} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
              {/* 연결선에 빛이 흐른다 — 파이프라인 플로우와 같은 빔(BeamPath).
                  여기 좌표는 상수라 DOM을 재지 않고 경로를 바로 넘긴다.
                  단계마다 조금씩 늦게 출발시켜 인입 → 게이트 → 등급 → 부서 순서가 눈에 보이게. */}
              {EDGES.map(([a, b], i) => {
                const p = rMid(NODES[a]), q = lMid(NODES[b]);
                const d = Math.max(28, (q.x - p.x) * 0.5);
                return (
                  <BeamPath
                    key={i}
                    d={"M" + p.x + " " + p.y + " C " + (p.x + d) + " " + p.y + " " + (q.x - d) + " " + q.y + " " + q.x + " " + q.y}
                    x1={p.x}
                    y1={p.y}
                    x2={q.x}
                    y2={q.y}
                    duration={2.6}
                    delay={p.x < 500 ? 0 : 0.55}
                    pathColor="var(--gray-400)"
                    pathWidth={1.5}
                    pathOpacity={1}
                  />
                );
              })}
              {EDGES.map(([a, b], i) => {
                const p = rMid(NODES[a]), q = lMid(NODES[b]);
                return <g key={"g" + i}>
                  <circle cx={p.x} cy={p.y} r={3} fill="var(--onair-surface)" stroke="var(--gray-400)" strokeWidth="1.5" />
                  <circle cx={q.x} cy={q.y} r={3} fill="var(--onair-surface)" stroke="var(--gray-400)" strokeWidth="1.5" />
                </g>;
              })}
            </svg>

            {/* 입력 */}
            <Box n={NODES.input}>
              <div style={css("display:flex;align-items:center;gap:8px;height:100%")}>
                <span className="mi" style={css("font-size:17px;color:var(--gray-700)")}>graphic_eq</span>
                <div>
                  <div style={css("font:800 12.5px " + FONT + ";color:var(--gray-1000)")}>콜 인입</div>
                  <div style={css("font:400 10px " + FONT + ";color:var(--gray-600)")}>실시간 STT 전사</div>
                </div>
              </div>
            </Box>

            {/* 게이트 */}
            <Box n={NODES.gate}>
              <div style={css("display:flex;align-items:center;gap:8px")}>
                <span className="mi" style={css("font-size:17px;color:var(--blue-700)")}>filter_alt</span>
                <span style={css("font:800 12.5px " + FONT + ";color:var(--gray-1000)")}>규칙 게이트 · 우선순위</span>
                <span style={css("font:600 9.5px " + FONT + ";color:var(--gray-600)")}>LLM보다 먼저</span>
              </div>
              <div style={css("font:400 10px/1.5 " + FONT + ";color:var(--gray-700);margin-top:5px")}>
                단일 단어로 판정 안 함 — “기관 사칭 + 송금 요구”처럼 <b style={css("color:var(--gray-900)")}>정황 결합 시</b> 긴급으로 여과.
              </div>
            </Box>

            {/* 분기 E/S/G */}
            {([["E", mE, "긴급", "사고·신고 직결"], ["S", mS, "단순", "AI 즉시 응대"], ["G", mG, "일반", "부서 배정"]] as const).map(([k, m, title, dest]) => (
              <Box key={k} n={NODES[k]} border={m.bar}>
                <div style={css("display:flex;align-items:center;gap:7px")}>
                  <span style={css("flex:none;width:20px;height:20px;border-radius:9999px;border:1.5px solid " + m.bar + ";display:flex;align-items:center;justify-content:center;font:800 10.5px " + MONO + ";color:" + m.fg)}>{k}</span>
                  <span style={css("font:800 13px " + FONT + ";color:var(--gray-1000)")}>{title}</span>
                </div>
                <div style={css("font:700 10.5px " + FONT + ";color:var(--gray-800);margin-top:6px")}>→ {dest}</div>
              </Box>
            ))}

            {/* E → 사고·신고 */}
            <Box n={NODES.SG} border="var(--red-400)">
              <DeptHead code="SG" name="사고·신고" emg />
              {chips([{ c: "G001", t: "착오송금 반환" }, { t: "보이스피싱" }, { t: "명의도용·해킹" }, { t: "지급정지" }, { t: "분실·도난" }])}
            </Box>

            {/* S → AI 즉시응대 */}
            <Box n={NODES.AI}>
              <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:6px")}>
                <span className="mi" style={css("font-size:14px;color:var(--gray-600)")}>bolt</span>
                <span style={css("font:700 12px " + FONT + ";color:var(--gray-1000)")}>AI 즉시 응대</span>
                <span style={css("font:400 9px " + FONT + ";color:var(--gray-600)")}>본인확인 후 자동 · 대기열 없음</span>
              </div>
              {chips([{ t: "잔액·거래내역 조회" }, { t: "이체한도 조회" }, { t: "OTP 재발급" }, { t: "자동이체 조회" }])}
            </Box>

            {/* G → 부서 6종 */}
            <Box n={NODES.DEP}><DeptHead code="DEP" name="수신·예적금" />
              {chips([{ c: "G007", t: "예적금·발행어음" }, { c: "G012", t: "주택청약" }, { c: "G006", t: "자동이체" }, { c: "G005", t: "거래내역" }, { c: "G003", t: "이체한도" }, { c: "G004", t: "일반·기타" }])}</Box>
            <Box n={NODES.LON}><DeptHead code="LON" name="여신·대출" />
              {chips([{ c: "G002", t: "대출" }, { c: "G008", t: "금리·이자" }, { c: "G009", t: "금리인하요구" }])}</Box>
            <Box n={NODES.CRD}><DeptHead code="CRD" name="카드·결제" />
              {chips([{ t: "카드 승인·한도" }, { t: "결제대금" }, { t: "포인트" }, { t: "리볼빙·할부" }])}</Box>
            <Box n={NODES.FX}><DeptHead code="FX" name="외환·수출입" />
              {chips([{ c: "G010", t: "외환(해외송금·환전)" }, { t: "송금 취소·반환" }, { t: "외화계좌" }])}</Box>
            <Box n={NODES.EFN}><DeptHead code="EFN" name="전자금융·디지털" />
              {chips([{ t: "공동인증서" }, { t: "OTP 재발급" }, { t: "이체 비밀번호" }, { t: "비대면 계좌 해제" }])}</Box>
            <Box n={NODES.INV}><DeptHead code="INV" name="연금·신탁·투자" />
              {chips([{ c: "G011", t: "연금·IRP" }, { t: "펀드·신탁" }, { t: "디폴트옵션" }])}</Box>
          </div>

          {/* 각주 */}
          <div style={css("width:" + CW + "px;max-width:100%;margin:16px auto 0;display:flex;gap:8px;align-items:flex-start;background:var(--onair-surface);border-radius:10px;padding:11px 13px")}>
            <span className="mi" style={css("flex:none;font-size:15px;color:var(--blue-700);margin-top:1px")}>info</span>
            <span style={css("font:400 11px/1.6 " + FONT + ";color:var(--gray-800)")}>
              긴급(E)은 규칙 게이트에서 <b style={css("color:var(--gray-1000)")}>사고·신고(SG)로 직결</b> · 단순(S)은 부서 대기열 없이 AI가 정형업무 즉시 처리 · 일반(G)은 주제별 부서로 배정.
              부서 코드(DEP·LON…)가 규정검색(RAG) 대분류와 같아 <b style={css("color:var(--gray-1000)")}>부서 확정 = 규정검색 필터 확정</b>. (ETC 제도·민원은 문서분류 전용 — 라우팅 큐 아님)
            </span>
          </div>
        </div>

        {/* ── 미니맵 (우측 하단) — 전체 그래프 축소도 + 현재 보이는 영역.
            접을 수 있다: 펼친 채로는 오른쪽 아래 부서 카드를 가린다. ── */}
        {!mapOpen && (
          <span
            onClick={() => setMapOpen(true)}
            title="미니맵 펼치기"
            style={css("position:absolute;right:14px;bottom:14px;z-index:5;display:flex;align-items:center;gap:5px;background:var(--onair-surface);border:1px solid var(--gray-300);border-radius:9999px;box-shadow:var(--sh-near);padding:6px 11px;cursor:pointer")}
          >
            <span className="mi" style={css("font-size:13px;color:var(--gray-600)")}>map</span>
            <span style={css("font:700 9px " + FONT + ";letter-spacing:.3px;color:var(--gray-600)")}>미니맵</span>
          </span>
        )}
        {mapOpen && (
        <div style={css("position:absolute;right:14px;bottom:14px;z-index:5;background:var(--onair-surface);border:1px solid var(--gray-300);border-radius:9px;box-shadow:var(--sh-modal);padding:6px 6px 5px")}>
          <div style={css("display:flex;align-items:center;gap:4px;padding:0 2px 4px")}>
            <span className="mi" style={css("font-size:11px;color:var(--gray-500)")}>map</span>
            <span style={css("font:700 8.5px " + FONT + ";letter-spacing:.3px;color:var(--gray-500)")}>미니맵</span>
            <div style={css("flex:1")} />
            <span
              onClick={() => setMapOpen(false)}
              title="미니맵 접기"
              className="mi"
              style={css("font-size:13px;color:var(--gray-500);cursor:pointer;margin-right:-1px")}
            >
              close_fullscreen
            </span>
          </div>
          <svg onClick={jump} width={MMW} height={MMH} viewBox={"0 0 " + CW + " " + CH}
            style={{ display: "block", borderRadius: 5, background: "var(--gray-100)", cursor: "pointer" }}>
            {(Object.keys(NODES) as Key[]).map((k) => {
              const n = NODES[k];
              return <rect key={k} x={n.x} y={n.y} width={n.w} height={n.h} rx={9} fill={mmColor[k] || "var(--gray-400)"} opacity={mmColor[k] ? 0.9 : 0.55} />;
            })}
            {vw > 0 && vh > 0 && (
              <rect x={vx} y={vy} width={vw} height={vh} rx={6} fill="rgba(20,110,235,.12)" stroke="var(--blue-700)" strokeWidth={9} />
            )}
          </svg>
        </div>
        )}
      </div>
    </>
  );
}
