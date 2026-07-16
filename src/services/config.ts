// Runtime configuration for the service layer.
//
// External capabilities can run in mock or real mode:
//   • mock  — deterministic, offline, used for the live demo (default)
//   • real  — POSTs to the backend at VITE_API_BASE_URL
//
// Flip the per-feature flags in `.env` once the backend endpoints exist.

const env = import.meta.env;

export const API_BASE_URL: string = (env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
export const DATA_API_PREFIX: string = `/${String(env.VITE_DATA_API_PREFIX ?? "/api/v1")}`
  .replace(/\/+/g, "/")
  .replace(/\/$/, "");
const flag = (v: unknown) => String(v ?? "false").toLowerCase() === "true";

export const useReal = {
  data: flag(env.VITE_USE_REAL_DATA_API) && !!API_BASE_URL,
};

/** Typed GET helper for the active MVP API. */
export async function getJSON<T>(
  path: string
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}
