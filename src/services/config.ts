// Runtime configuration for the service layer.
//
// Every AI capability (STT / summary / emotion) can run in one of two modes:
//   • mock  — deterministic, offline, used for the live demo (default)
//   • real  — POSTs to the backend at VITE_API_BASE_URL
//
// Flip the per-feature flags in `.env` once the backend endpoints exist.

const env = import.meta.env;

export const API_BASE_URL: string = (env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

const flag = (v: unknown) => String(v ?? "false").toLowerCase() === "true";

export const useReal = {
  stt: flag(env.VITE_USE_REAL_STT) && !!API_BASE_URL,
  summary: flag(env.VITE_USE_REAL_SUMMARY) && !!API_BASE_URL,
  emotion: flag(env.VITE_USE_REAL_EMOTION) && !!API_BASE_URL,
};

/** Small typed POST helper for the backend calls. */
export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}
