import type {
  ConsultationCardResponse,
  MvpEmotionResult,
} from "./types";

type JsonRecord = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(path: string, message: string): never {
  throw new Error(`Invalid mvp-1.0 response at ${path}: ${message}`);
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected object");
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, path: string, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(path, `expected keys ${wanted.join(", ")}`);
  }
}

function text(
  value: unknown,
  path: string,
  options: { max?: number; nullable?: boolean } = {}
): string | null {
  if (value === null && options.nullable) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "expected non-empty string");
  }
  if (options.max != null && value.length > options.max) {
    fail(path, `must be at most ${options.max} characters`);
  }
  return value;
}

function nullableText(value: unknown, path: string, max: number): string | null {
  if (value === null) return null;
  return text(value, path, { max }) as string;
}

function numberInRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum?: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    (maximum != null && value > maximum)
  ) {
    fail(
      path,
      `expected finite number in range ${minimum}..${maximum ?? "infinity"}`
    );
  }
  return value;
}

function nullableNumberInRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number
): number | null {
  if (value === null) return null;
  return numberInRange(value, path, minimum, maximum);
}

function parseEmotion(value: unknown): MvpEmotionResult {
  const emotion = record(value, "$.consultation_card.emotion");
  exactKeys(emotion, "$.consultation_card.emotion", [
    "status",
    "score",
    "level",
    "reason",
  ]);

  if (
    emotion.status !== "unavailable" &&
    emotion.status !== "completed"
  ) {
    fail("$.consultation_card.emotion.status", "unsupported status");
  }

  const reason = nullableText(
    emotion.reason,
    "$.consultation_card.emotion.reason",
    2000
  );
  if (emotion.status === "unavailable") {
    if (emotion.score !== null || emotion.level !== null) {
      fail(
        "$.consultation_card.emotion",
        "unavailable emotion must have null score and level"
      );
    }
    return {
      status: emotion.status,
      score: null,
      level: null,
      reason,
    };
  }

  if (
    emotion.level !== "stable" &&
    emotion.level !== "caution" &&
    emotion.level !== "elevated"
  ) {
    fail(
      "$.consultation_card.emotion.level",
      "expected stable, caution, or elevated"
    );
  }
  const score = numberInRange(
    emotion.score,
    "$.consultation_card.emotion.score",
    0,
    100
  );
  if (
    (emotion.level === "stable" && score > 33) ||
    (emotion.level === "caution" && !(score > 33 && score <= 66)) ||
    (emotion.level === "elevated" && score <= 66)
  ) {
    fail(
      "$.consultation_card.emotion",
      "score does not match the three-level temperature band"
    );
  }

  return {
    status: emotion.status,
    score,
    level: emotion.level,
    reason,
  };
}

/**
 * Runtime enforcement of database/contracts/mvp_call_response.schema.json.
 * TypeScript types disappear after build, so every real API response passes
 * through this boundary before it can update the 상담카드 UI.
 */
export function parseConsultationCardResponse(
  value: unknown
): ConsultationCardResponse {
  const response = record(value, "$");
  exactKeys(response, "$", [
    "schema_version",
    "call_id",
    "status",
    "source_channel",
    "audio_filename",
    "transcript",
    "consultation_card",
    "created_at",
  ]);

  if (response.schema_version !== "mvp-1.0") {
    fail("$.schema_version", "expected mvp-1.0");
  }
  if (
    typeof response.call_id !== "string" ||
    !UUID_PATTERN.test(response.call_id)
  ) {
    fail("$.call_id", "expected UUID");
  }
  if (
    response.status !== "processing" &&
    response.status !== "ready" &&
    response.status !== "failed"
  ) {
    fail("$.status", "unsupported status");
  }
  if (response.source_channel !== "voice") {
    fail("$.source_channel", "expected voice");
  }

  const audioFilename = text(response.audio_filename, "$.audio_filename", {
    max: 255,
  }) as string;
  if (
    typeof response.created_at !== "string" ||
    Number.isNaN(Date.parse(response.created_at))
  ) {
    fail("$.created_at", "expected ISO date-time string");
  }

  const transcript = record(response.transcript, "$.transcript");
  exactKeys(transcript, "$.transcript", [
    "text",
    "stt_model",
    "duration_sec",
  ]);

  const card = record(response.consultation_card, "$.consultation_card");
  exactKeys(card, "$.consultation_card", [
    "summary",
    "business_type",
    "department",
    "routing_reason",
    "incident_risk",
    "risk_reason",
    "routing_confidence",
    "emotion",
  ]);
  if (card.incident_risk !== "low" && card.incident_risk !== "high") {
    fail("$.consultation_card.incident_risk", "expected low or high");
  }

  const riskReason = nullableText(
    card.risk_reason,
    "$.consultation_card.risk_reason",
    2000
  );
  if (card.incident_risk === "high" && riskReason === null) {
    fail(
      "$.consultation_card.risk_reason",
      "high risk requires a non-empty reason"
    );
  }

  return {
    schema_version: response.schema_version,
    call_id: response.call_id,
    status: response.status,
    source_channel: response.source_channel,
    audio_filename: audioFilename,
    transcript: {
      text: text(transcript.text, "$.transcript.text") as string,
      stt_model: text(transcript.stt_model, "$.transcript.stt_model", {
        max: 100,
      }) as string,
      duration_sec: numberInRange(
        transcript.duration_sec,
        "$.transcript.duration_sec",
        0
      ),
    },
    consultation_card: {
      summary: text(card.summary, "$.consultation_card.summary", {
        max: 2000,
      }) as string,
      business_type: text(
        card.business_type,
        "$.consultation_card.business_type",
        { max: 200 }
      ) as string,
      department: text(card.department, "$.consultation_card.department", {
        max: 200,
      }) as string,
      routing_reason: text(
        card.routing_reason,
        "$.consultation_card.routing_reason",
        { max: 2000 }
      ) as string,
      incident_risk: card.incident_risk,
      risk_reason: riskReason,
      routing_confidence: nullableNumberInRange(
        card.routing_confidence,
        "$.consultation_card.routing_confidence",
        0,
        1
      ),
      emotion: parseEmotion(card.emotion),
    },
    created_at: response.created_at,
  };
}
