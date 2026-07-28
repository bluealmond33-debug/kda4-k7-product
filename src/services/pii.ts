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

/**
 * 응답 제한 시간 — **없으면 무대에서 조용히 멈춘다.**
 *
 * 이 주소는 설정(.env)에서 오고, 데모 노트북이 다른 와이파이에 붙으면 어제의 LAN IP가
 * 오늘은 아무도 없는 주소가 된다. 그때 fetch는 실패하는 게 아니라 **매달린다**(SYN 타임아웃
 * 수십 초). 실제로 본인확인이 여기서 걸려 "대조를 눌러도 아무 일이 없는" 상태가 났다 —
 * 화면에는 오류도 안 뜨므로 상담사는 무엇이 잘못됐는지 알 수 없다.
 *
 * 그래서 못 붙으면 **빨리 실패**한다. 호출한 쪽은 실패를 이미 다룰 줄 안다(본인확인은
 * 로컬 대조로 폴백, 계좌·이력은 정적 표로 폴백). 느린 성공보다 빠른 폴백이 낫다.
 */
const TIMEOUT_MS = 2500;

function withTimeout(init: RequestInit = {}): RequestInit {
  return { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) };
}

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
  const res = await fetch(
    `${PII_BASE_URL}/verify`,
    withTimeout({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, value }),
    })
  );
  if (!res.ok) throw new Error(`pii verify failed: ${res.status}`);
  return (await res.json()) as VerifyResult;
}

export async function piiCustomer(id: string): Promise<PiiCustomer> {
  const res = await fetch(`${PII_BASE_URL}/customers/${id}`, withTimeout());
  if (!res.ok) throw new Error(`pii customer failed: ${res.status}`);
  return (await res.json()) as PiiCustomer;
}

export async function piiAccounts(id: string): Promise<SheetData> {
  const res = await fetch(`${PII_BASE_URL}/customers/${id}/accounts`, withTimeout());
  if (!res.ok) throw new Error(`pii accounts failed: ${res.status}`);
  return (await res.json()) as SheetData;
}

export async function piiHistory(id: string): Promise<SheetData> {
  const res = await fetch(`${PII_BASE_URL}/customers/${id}/history`, withTimeout());
  if (!res.ok) throw new Error(`pii history failed: ${res.status}`);
  return (await res.json()) as SheetData;
}
