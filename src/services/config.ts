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
export const DATA_ACCESS_PURPOSE: string = String(
  env.VITE_DATA_ACCESS_PURPOSE ?? "consultation_preparation"
);

const flag = (v: unknown) => String(v ?? "false").toLowerCase() === "true";
let apiAccessToken: string | null = null;

/** Inject the signed-in user's short-lived token at runtime; never store it in Vite env. */
export function setApiAccessToken(token: string | null): void {
  apiAccessToken = token;
}

export const useReal = {
  stt: flag(env.VITE_USE_REAL_STT) && !!API_BASE_URL,
  emotion: flag(env.VITE_USE_REAL_EMOTION) && !!API_BASE_URL,
  data: flag(env.VITE_USE_REAL_DATA_API) && !!API_BASE_URL,
};

/** Typed GET helper supporting the OpenAPI bearer contract and session cookies. */
export async function getJSON<T>(
  path: string,
  headers: Record<string, string> = {}
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(apiAccessToken ? { Authorization: `Bearer ${apiAccessToken}` } : {}),
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

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
