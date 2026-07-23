// pii-service (개인정보 격리 서버) 클라이언트.
//
// 개인정보(본인인증·고객·계좌·거래내역)는 AI 백엔드(VITE_API_BASE_URL, :8000)가 아니라
// **별도 격리 서버**(pii-service, :8100)에서만 온다. 상담사 인증 성공 이후에만 호출한다.
// → "AI는 대화 내용만 보고 민감정보 원문엔 손대지 않는다"는 아키텍처를 실제 배선으로 증명.

import { API_BASE_URL } from "./config";
import type { SheetData } from "../data/demoContent";

const env = import.meta.env;

/** pii-service 베이스 URL. 명시 env 우선 → 없으면 AI API 호스트의 8100 포트 → 없으면 localhost. */
function resolveBase(): string {
  const explicit = String(env.VITE_PII_API_BASE_URL ?? "").replace(/\/$/, "");
  if (explicit) return explicit;
  if (API_BASE_URL) return API_BASE_URL.replace(/:\d+$/, ":8100");
  return "http://localhost:8100";
}

export const PII_BASE_URL = resolveBase();

export interface VerifyResult {
  verified: boolean;
  customer_id: string | null;
}

export interface PiiCustomer {
  id: string;
  name: string;
  masked: string;
  phoneMasked: string;
  type: string;
}

export async function piiVerify(method: string, value: string): Promise<VerifyResult> {
  const res = await fetch(`${PII_BASE_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, value }),
  });
  if (!res.ok) throw new Error(`pii verify failed: ${res.status}`);
  return (await res.json()) as VerifyResult;
}

export async function piiCustomer(id: string): Promise<PiiCustomer> {
  const res = await fetch(`${PII_BASE_URL}/customers/${id}`);
  if (!res.ok) throw new Error(`pii customer failed: ${res.status}`);
  return (await res.json()) as PiiCustomer;
}

export async function piiAccounts(id: string): Promise<SheetData> {
  const res = await fetch(`${PII_BASE_URL}/customers/${id}/accounts`);
  if (!res.ok) throw new Error(`pii accounts failed: ${res.status}`);
  return (await res.json()) as SheetData;
}

export async function piiHistory(id: string): Promise<SheetData> {
  const res = await fetch(`${PII_BASE_URL}/customers/${id}/history`);
  if (!res.ok) throw new Error(`pii history failed: ${res.status}`);
  return (await res.json()) as SheetData;
}
