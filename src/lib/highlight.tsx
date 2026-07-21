import type { ReactNode } from "react";

/** 검색어 하이라이트 — 노랑은 라이트 뉴트럴 위에서 잘 안 보여 파랑 틴트를 쓴다.
 *  강조 행 테두리(blue-700)와 같은 계열이라 "검색이 찾은 것"으로 일관되게 읽힌다. */
export function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  if (!lower.includes(needle)) return text;
  const parts: ReactNode[] = [];
  let from = 0;
  let idx = lower.indexOf(needle);
  let k = 0;
  while (idx >= 0) {
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(
      <mark
        key={k++}
        style={{ background: "var(--blue-200)", color: "var(--blue-1000)", borderRadius: "2px", padding: "0 1px" }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    from = idx + q.length;
    idx = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}
