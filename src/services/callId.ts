const SAFE_CALL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Return only an explicitly supplied, path-safe call id. */
export function resolveExplicitCallId(search: string): string | null {
  const params = new URLSearchParams(search);
  const candidate = (params.get("call") ?? params.get("call_id") ?? "").trim();
  return SAFE_CALL_ID.test(candidate) ? candidate : null;
}

/** Resolve a LAN demo call id without allowing path/query injection. */
export function resolveCallId(search: string, fallback = "demo1"): string {
  return resolveExplicitCallId(search) ?? fallback;
}
