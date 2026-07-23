import type { DemoEnvelope } from "./demoBus";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

/** Stable identity shared by local loopback, BroadcastChannel, and WS echo copies. */
export function demoEnvelopeKey(envelope: DemoEnvelope): string {
  return stableJson({
    type: envelope.type,
    payload: envelope.payload,
    ts: envelope.ts,
    seq: envelope.seq,
    source: envelope.source,
  });
}

/** Fixed-memory insertion-ordered set used by the hybrid relay transport. */
export class BoundedEnvelopeKeys {
  private readonly values = new Set<string>();
  private readonly order: string[] = [];
  private readonly limit: number;

  constructor(limit = 2_048) {
    this.limit = limit;
  }

  /** Returns true only for the first copy currently retained. */
  remember(key: string): boolean {
    if (this.values.has(key)) return false;
    this.values.add(key);
    this.order.push(key);
    while (this.order.length > this.limit) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.values.delete(oldest);
    }
    return true;
  }
}
