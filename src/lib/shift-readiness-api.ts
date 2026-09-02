import { HandoverApiError } from "./handover-api";
import {
  parseShiftReadinessResponse,
  type RequestShiftReadinessOptions,
  type ShiftReadinessRequest,
  type ShiftReadinessResponse,
} from "./shift-readiness-contracts";
import type { ShiftReadinessRecord } from "./demo-shift-readiness";

export { HandoverApiError } from "./handover-api";
export type {
  RequestShiftReadinessOptions,
  ShiftReadinessRequest,
  ShiftReadinessResponse,
} from "./shift-readiness-contracts";
export type { ShiftReadinessRecord } from "./demo-shift-readiness";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function patientIdFromRecords(records: readonly ShiftReadinessRecord[]): string | undefined {
  if (!Array.isArray(records) || records.length === 0) return undefined;
  const firstRecord = records[0];
  const firstPatientId = isRecord(firstRecord) ? firstRecord.patient_id : undefined;
  if (typeof firstPatientId !== "string" || firstPatientId.trim().length === 0) return undefined;
  if (
    records.some((record) => {
      if (!isRecord(record)) return true;
      return (
        typeof record.patient_id !== "string" ||
        record.patient_id.trim().length === 0 ||
        record.patient_id !== firstPatientId
      );
    })
  ) {
    return undefined;
  }
  return firstPatientId;
}

/**
 * Request a stateless Shift Readiness projection using only the approved
 * browser payload. Provider credentials never cross this boundary.
 */
export async function requestShiftReadinessComparison(
  input: ShiftReadinessRequest,
  options: RequestShiftReadinessOptions = {},
): Promise<ShiftReadinessResponse> {
  const signal = options.signal;
  if (signal?.aborted) throw new HandoverApiError("ABORTED");

  let patientId: string | undefined;
  let body: string;
  try {
    patientId = patientIdFromRecords(input.records);
    if (!patientId) throw new Error("invalid patient records");
    const serialized = JSON.stringify({
      reviewStartAt: input.reviewStartAt,
      shift: input.shift,
      records: input.records,
      coverageGaps: input.coverageGaps,
    });
    if (typeof serialized !== "string") throw new Error("request did not serialize");
    body = serialized;
  } catch {
    throw new HandoverApiError("REQUEST_SERIALIZATION");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl("/api/handover/shift-readiness", {
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
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new HandoverApiError("ABORTED");
    }
    throw new HandoverApiError("MALFORMED_RESPONSE");
  }

  if (signal?.aborted) throw new HandoverApiError("ABORTED");

  let parsed: ShiftReadinessResponse;
  try {
    parsed = parseShiftReadinessResponse(payload);
  } catch {
    throw new HandoverApiError("INVALID_RESPONSE");
  }

  if (parsed.patient.id !== patientId) {
    throw new HandoverApiError("PATIENT_MISMATCH");
  }
  return parsed;
}

export const requestShiftReadiness = requestShiftReadinessComparison;
