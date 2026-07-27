import type { ReactNode } from "react";

/** 검색어 하이라이트 — 노랑은 라이트 뉴트럴 위에서 잘 안 보여 파랑 틴트를 쓴다.
 *  강조 행 테두리(blue-700)와 같은 계열이라 "검색이 찾은 것"으로 일관되게 읽힌다.
 *
 *  단어 단위로 매칭한다 — "전세자금대출 만기이자"처럼 여러 단어를 검색했을 때, 본문에
 *  그 문구가 통째로 있지 않아도 "전세자금대출"·"만기" 각각이 있으면 그 부분만 표시한다.
 *  (예전엔 질의 전체를 한 문자열로 찾아서, 여러 단어 검색이면 거의 항상 표시가 안 됐다.) */
export function highlight(text: string, query: string): ReactNode {
  const tokens = [...new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean))];
  if (!tokens.length) return text;
  const lower = text.toLowerCase();

  const ranges: [number, number][] = [];
  for (const t of tokens) {
    let from = 0;
    let idx = lower.indexOf(t, from);
    while (idx >= 0) {
      ranges.push([idx, idx + t.length]);
      from = idx + t.length;
      idx = lower.indexOf(t, from);
    }
  }
  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);

  // 겹치거나 맞닿은 구간은 하나로 합친다 — <mark>가 서로 안 겹치게.
  const merged: [number, number][] = [ranges[0]];
  for (const [s, e] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  let k = 0;
  for (const [s, e] of merged) {
    if (s > cursor) parts.push(text.slice(cursor, s));
    parts.push(
      <mark
        key={k++}
        style={{ background: "var(--blue-200)", color: "var(--blue-1000)", borderRadius: "2px", padding: "0 1px" }}
      >
        {text.slice(s, e)}
      </mark>
    );
    cursor = e;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
