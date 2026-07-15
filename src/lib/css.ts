import type { CSSProperties } from "react";

/**
 * Parse an inline-CSS string into a React style object.
 *
 * The screens in this app were ported from a design-tool export whose markup
 * used plain `style="…"` strings. Rather than hand-convert several hundred
 * declarations (and risk transcription errors), we keep the CSS text verbatim
 * and convert it at render time. Values are preserved exactly; property names
 * are camel-cased (including vendor prefixes, e.g. `-webkit-…` → `Webkit…`).
 *
 * Results are memoised per unique string, so repeated renders are cheap.
 */
const cache = new Map<string, CSSProperties>();

export function css(input: string): CSSProperties {
  const cached = cache.get(input);
  if (cached) return cached;

  const out: Record<string, string> = {};
  for (const decl of input.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    const key = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = value;
  }
  const style = out as CSSProperties;
  cache.set(input, style);
  return style;
}
