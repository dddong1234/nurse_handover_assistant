import { isHandoverApiResponse } from "./demo-adapter";
import type { HandoverApiResponse } from "./contracts";

export type HandoverRecord = Record<string, unknown>;

export type HandoverApiErrorCode =
  | "ABORTED"
  | "NETWORK_ERROR"
  | "REQUEST_SERIALIZATION"
  | "HTTP_ERROR"
  | "MALFORMED_RESPONSE"
  | "INVALID_RESPONSE"
  | "PATIENT_MISMATCH";

const ERROR_MESSAGES: Record<HandoverApiErrorCode, string> = {
  ABORTED: "인수인계 비교 요청이 취소되었습니다.",
  NETWORK_ERROR: "인수인계 비교 요청을 완료하지 못했습니다.",
  REQUEST_SERIALIZATION: "인수인계 비교 요청을 준비하지 못했습니다.",
  HTTP_ERROR: "인수인계 비교 요청을 완료하지 못했습니다.",
  MALFORMED_RESPONSE: "인수인계 비교 응답을 읽을 수 없습니다.",
  INVALID_RESPONSE: "인수인계 비교 응답을 검증하지 못했습니다.",
  PATIENT_MISMATCH: "인수인계 비교 응답의 환자 식별자가 일치하지 않습니다.",
};

export class HandoverApiError extends Error {
  readonly code: HandoverApiErrorCode;

  constructor(code: HandoverApiErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "HandoverApiError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function patientIdFromRecord(record: unknown): string | undefined {
  if (!isRecord(record)) return undefined;

  if (typeof record.patient_id === "string" && record.patient_id.length > 0) {
    return record.patient_id;
  }
  if (typeof record.id === "string" && record.id.length > 0) {
    return record.id;
  }
  if (isRecord(record.patient) && typeof record.patient.id === "string" && record.patient.id.length > 0) {
    return record.patient.id;
  }
  return undefined;
}

function isAbortError(error: unknown) {
  return isRecord(error) && error.name === "AbortError";
}

/**
 * Compare two raw patient snapshots using the stateless same-origin API.
 * The server response is validated before it is returned to the UI.
 */
export async function comparePatientRecords(
  previous: HandoverRecord | null,
  current: HandoverRecord,
  signal?: AbortSignal,
): Promise<HandoverApiResponse> {
  if (signal?.aborted) throw new HandoverApiError("ABORTED");

  let body: string;
  try {
    body = JSON.stringify({ previous, current, summaryMode: "ai" });
  } catch {
    throw new HandoverApiError("REQUEST_SERIALIZATION");
  }

  let response: Response;
  try {
    response = await fetch("/api/handover/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new HandoverApiError("ABORTED");
    }
    throw new HandoverApiError("NETWORK_ERROR");
  }

  if (signal?.aborted) throw new HandoverApiError("ABORTED");
  if (!response.ok) throw new HandoverApiError("HTTP_ERROR");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HandoverApiError("MALFORMED_RESPONSE");
  }

  if (signal?.aborted) throw new HandoverApiError("ABORTED");
  if (!isHandoverApiResponse(payload)) throw new HandoverApiError("INVALID_RESPONSE");

  const expectedPatientId = patientIdFromRecord(current);
  if (expectedPatientId && payload.comparison.patient.id !== expectedPatientId) {
    throw new HandoverApiError("PATIENT_MISMATCH");
  }

  return payload;
}
