import { useEffect, useState } from "react";
import { css } from "../../lib/css";
import { BrandSymbol } from "../BrandLogo";

const FONT = "'Avenir Next','Pretendard',sans-serif";
const MONO = "'Geist Mono',monospace";

/**
 * 자료실 — KARI-NA 발표·분석·설계 보고서 32건을 관제 대시보드 톤으로 모은 모달.
 * 카테고리 = 채널(색 점), 보고서 = 카드(가는 색 레일). 색은 점·레일·태그에만(ONAIR).
 * 카드를 누르면 원문(claude.ai 아티팩트)이 새 탭으로 열린다.
 */
const BASE = "https://claude.ai/code/artifact/";
type Item = { t: string; id: string; d: string; h: string };
type Cat = { name: string; color: string; items: Item[] };
const CATS: Cat[] = [
  { name: "발표", color: "#B67916", items: [
    { t: "발표 대본 — 김설빈용 완전판 (15분)", id: "413ef3e0-c096-4748-9d8b-b710dcb10be7", d: "07-24", h: "발표 15분 완전 대본" },
    { t: "발표 대사 — 낭독용 (김설빈)", id: "8ba83828-f08c-466f-8adf-ee7ce79d7747", d: "07-24", h: "그대로 읽는 낭독용" },
    { t: "프로젝트 전체 안내서", id: "fee1c4bf-5321-48ee-9b4b-1578464cddea", d: "07-23", h: "프로젝트 개요 총정리" },
  ] },
  { name: "경쟁·전략", color: "var(--blue-700)", items: [
    { t: "전략 브리핑 — 비교불가 1위로 가는 법", id: "ad9c3c43-c792-45da-98c1-fad5cb5661cd", d: "07-23", h: "해자·급소·5가지 수" },
    { t: "경쟁 분석 — 상세 채점·비교·예상질문", id: "c505e5e2-9d0b-4e65-b56a-2e290b2cb180", d: "07-24", h: "32기준 채점 + 예상질문 30" },
    { t: "점수 감사 — 남은 6일, 아픈 곳부터", id: "35810a92-cbb4-4c63-8266-b77c52a0ad9e", d: "07-23", h: "쓴소리 5가지 + 우선순위" },
    { t: "팀 브리핑 — 1위를 증명하는 6일", id: "55de1f8e-297e-40c8-8739-6f078a7d3084", d: "07-24", h: "역할분담 + 6일 계획" },
    { t: "의사결정 원장 — 15개 쟁점·선택지·KPI", id: "560c5f74-7774-47c2-aa77-4fb6dd74cbaf", d: "07-23", h: "결정 이력 15건" },
  ] },
  { name: "아키텍처·기술", color: "#0E8A72", items: [
    { t: "아키텍처 · 데이터 흐름 · 구현 상태", id: "3531b8b8-9df8-4594-98a7-10195015914f", d: "07-24", h: "17단계 + 상태색 구분" },
    { t: "모델 성적표 — 정직한 버전", id: "a5d0d52b-5bdb-4806-8c96-f8fef542bec0", d: "07-24", h: "감정온도·WavLM 실측 지표" },
    { t: "기술 문서", id: "cac4060e-addd-4ac8-9c3b-db37a037794a", d: "07-21", h: "초기 기술 정리" },
  ] },
  { name: "감정·주의도", color: "#9B4FB0", items: [
    { t: "감정온도 · 주의도가 나오기까지", id: "9a1a7906-db52-406b-bbbb-6ff78320f661", d: "07-22", h: "감정 판정 과정" },
    { t: "감정온도·주의도가 나오기까지 (2채널)", id: "b4b570ee-2cfe-4737-8062-2d2af73b0ad1", d: "07-22", h: "음향+텍스트 2채널판" },
    { t: "주의도 vs 긴급 — 두 레인으로 나누기", id: "db58b5f1-2b3c-440e-971b-f4621d531938", d: "07-22", h: "주의도·긴급 분리 설계" },
    { t: "감정·긴급도 판정 파이프라인", id: "8acbd830-a2cc-4d28-974c-6373b1117bf3", d: "07-22", h: "판정 파이프라인 흐름" },
    { t: "EXAONE 텍스트 감정 설명서", id: "49c94ee5-db95-47ee-9a8d-1002c44b8ada", d: "07-22", h: "텍스트 감정 모델" },
    { t: "감정온도 → 주의 레벨 브리핑", id: "9657bb35-0199-468d-aac3-2ca416f76e0a", d: "07-22", h: "온도→레벨 매핑" },
  ] },
  { name: "본인인증", color: "#C13B60", items: [
    { t: "본인인증 설계안 — 간소화 vs 상세", id: "d996e964-61b5-49b2-9c07-cb03e6bc488e", d: "07-22", h: "인증 두 가지 안 비교" },
    { t: "백엔드 본인인증 프로세스 — 동작 확인", id: "1f9d7941-568a-4866-a2eb-8499bc627ef1", d: "07-23", h: "인증 백엔드 흐름" },
    { t: "본인인증 — React 프론트 연동 명세", id: "f1c62a07-33fc-40c8-9361-ef5467c82b4c", d: "07-23", h: "프론트 연동 계약" },
    { t: "본인인증 백엔드 인수인계 — STAGE 0~4a", id: "fa04db36-404b-4e89-b883-d99e81a4a986", d: "07-23", h: "단계별 인수인계" },
  ] },
  { name: "개인정보·보안", color: "#C0392B", items: [
    { t: "개인정보·보안 데이터 흐름 브리핑", id: "de371c91-077b-42cf-82f3-7420c1ff59af", d: "07-24", h: "데이터별 보안 흐름" },
    { t: "개인정보·보안 브리핑", id: "74aa0a65-47d3-4e92-b832-a1b957fa0c10", d: "07-22", h: "보안 개요" },
    { t: "개인정보 보호 4원칙", id: "968a6571-dcd2-449d-9a99-691eb5b9eb61", d: "07-21", h: "보호 원칙 4가지" },
  ] },
  { name: "상담 흐름·카드", color: "#2079AE", items: [
    { t: "상담 업무 흐름 Before → After", id: "bb32f6ad-b083-4636-93ef-e47d89c7af34", d: "07-22", h: "기존 vs 개선 흐름" },
    { t: "상담 브리핑 카드", id: "89bf2ecf-2c11-448a-a3e4-5e8e36a0b004", d: "07-22", h: "상담카드 구성" },
    { t: "준비 카드 v4", id: "8d36f866-d2f9-41dd-afd3-33209aeebf8e", d: "07-24", h: "준비 카드 최신본" },
    { t: "후처리 v2", id: "92d76b76-ff1c-4cd7-b9df-da995be4649b", d: "07-24", h: "후처리 화면" },
  ] },
  { name: "기타", color: "#6B7280", items: [
    { t: "방언 대응 한계와 로드맵", id: "6ed94997-54af-458b-9a7e-b90665b5757b", d: "07-23", h: "방언 한계 + 계획" },
    { t: "로고 적용", id: "f4112218-57fb-4b16-a591-2e7600433ee3", d: "07-24", h: "로고 시안" },
    { t: "로딩 스피너", id: "81c5ceeb-bb0a-4e8d-9d63-d332a0a53f8f", d: "07-23", h: "로딩 애니메이션" },
    { t: "전형진님께 — 키워드 사전 최신화 부탁", id: "c07d9bf3-348e-4a5e-be33-99c8bd99350e", d: "07-23", h: "키워드 사전 요청" },
  ] },
];
const TOTAL = CATS.reduce((n, c) => n + c.items.length, 0);

export default function ArchiveModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const hit = (it: Item, cat: Cat) =>
    !term || (it.t + " " + it.h + " " + cat.name).toLowerCase().includes(term);
  const shownCats = CATS.map((c) => ({ ...c, items: c.items.filter((it) => hit(it, c)) })).filter((c) => c.items.length);
  const shownCount = shownCats.reduce((n, c) => n + c.items.length, 0);

  return (
    <>
      <div onClick={onClose} style={css("position:fixed;inset:0;z-index:900;background:rgba(22,20,17,.45);animation:fadeIn .25s ease-out;cursor:pointer")} />
      <div style={css("position:fixed;left:50%;top:50%;z-index:901;transform:translate(-50%,-50%);width:1000px;max-width:95vw;height:82vh;max-height:820px;display:flex;flex-direction:column;background:var(--gray-100);border-radius:16px;box-shadow:var(--sh-modal);animation:modalIn .3s var(--ease-out);overflow:hidden")}>
        {/* 헤더 — 관제 알약 톤 */}
        <div style={css("display:flex;align-items:center;gap:11px;padding:14px 18px;flex:none;background:var(--onair-surface);border-bottom:1px solid var(--gray-200)")}>
          <BrandSymbol size={19} color="var(--blue-700)" />
          <span>
            <span style={css("display:block;font:800 14px " + FONT + ";color:var(--gray-1000);letter-spacing:-.2px;line-height:1.15")}>KARI-NA 자료실</span>
            <span style={css("display:block;font:500 8.5px " + MONO + ";color:var(--gray-700);letter-spacing:.4px")}>ARCHIVE · {TOTAL}건 / {CATS.length}채널</span>
          </span>
          <span style={css("width:1px;height:22px;background:var(--gray-200);margin:0 3px")} />
          <label style={css("flex:1;display:flex;align-items:center;gap:7px;background:var(--gray-100);border:1px solid var(--gray-200);border-radius:9999px;padding:7px 14px;min-width:0")}>
            <span className="mi" style={css("font-size:16px;color:var(--gray-600)")}>search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="제목·주제로 검색 (감정 · 본인인증 · 발표 · 개인정보)"
              style={css("flex:1;border:none;background:none;font:500 13px " + FONT + ";color:var(--gray-1000);min-width:0;outline:none")}
            />
            {q && <span onClick={() => setQ("")} className="mi" style={css("font-size:16px;color:var(--gray-500);cursor:pointer")}>close</span>}
          </label>
          <span onClick={onClose} style={css("cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
          </span>
        </div>

        {/* 채널 그리드 */}
        <div style={css("flex:1;overflow:auto;padding:16px 18px 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;align-content:start")}>
          {shownCats.map((cat) => (
            <div key={cat.name} style={css("background:var(--onair-surface);border:1px solid var(--gray-200);border-radius:12px;padding:12px 13px 14px;display:flex;flex-direction:column;gap:8px;box-shadow:var(--sh-near)")}>
              <div style={css("display:flex;align-items:center;gap:8px")}>
                <span style={css("width:9px;height:9px;border-radius:3px;flex:none;background:" + cat.color)} />
                <span style={css("font:750 13px " + FONT + ";color:var(--gray-1000)")}>{cat.name}</span>
                <span style={css("margin-left:auto;font:600 11px " + MONO + ";color:var(--gray-600);background:var(--gray-100);border-radius:9999px;padding:2px 8px")}>{cat.items.length}</span>
              </div>
              <div style={css("display:flex;flex-direction:column;gap:7px")}>
                {cat.items.map((it) => (
                  <a
                    key={it.id}
                    href={BASE + it.id}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="arow"
                    style={css("display:block;text-decoration:none;background:var(--gray-100);border:1px solid var(--gray-200);border-left:3px solid " + cat.color + ";border-radius:9px;padding:9px 11px")}
                  >
                    <div style={css("font:700 12.5px/1.34 " + FONT + ";color:var(--gray-1000);letter-spacing:-.1px")}>{it.t}</div>
                    <div style={css("display:flex;align-items:center;gap:6px;margin-top:4px;font:400 10.5px " + FONT + ";color:var(--gray-600)")}>
                      <span style={css("font-weight:700;color:" + cat.color)}>{cat.name}</span><span>·</span><span style={css("font-family:" + MONO)}>{it.d}</span>
                    </div>
                    <div style={css("margin-top:4px;font:400 11px/1.4 " + FONT + ";color:var(--gray-700)")}>{it.h}</div>
                  </a>
                ))}
              </div>
            </div>
          ))}
          {shownCount === 0 && (
            <div style={css("grid-column:1/-1;text-align:center;color:var(--gray-600);padding:40px;font:400 13px " + FONT)}>검색 결과가 없습니다.</div>
          )}
        </div>
      </div>
    </>
  );
}
