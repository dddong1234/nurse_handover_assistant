import { HandoverApiError, type HandoverRecord } from "./handover-api";
import {
  parseHandoverPeriodResponse,
  type HandoverPeriodApiResponse,
  type HandoverPeriodCoverageGap,
  type HandoverPeriodRequest,
  type PeriodSummaryMode,
} from "./handover-period-contracts";

export type { HandoverPeriodApiResponse, HandoverPeriodCoverageGap, HandoverPeriodRequest } from "./handover-period-contracts";
export type { CoverageGap, HandoverPeriodCompareRequest } from "./handover-period-contracts";
export type { HandoverRecord } from "./handover-api";
export { HandoverApiError } from "./handover-api";
export type HandoverPeriodRecord = HandoverRecord;
export type HandoverPeriodRequestOptions = Pick<RequestInit, "signal">;
export type HandoverPeriodSummaryMode = PeriodSummaryMode;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function patientIdFromRecords(records: ReadonlyArray<HandoverRecord>): string | undefined {
  if (records.length === 0) return undefined;
  const firstPatientId = records[0]?.patient_id;
  if (typeof firstPatientId !== "string" || firstPatientId.trim().length === 0) return undefined;
  if (
    records.some(
      (record) =>
        typeof record.patient_id !== "string" ||
        record.patient_id.trim().length === 0 ||
        record.patient_id !== firstPatientId,
    )
  ) {
    return undefined;
  }
  return firstPatientId;
}

/**
 * Compare an ordered set of patient snapshots using the stateless period API.
 * The browser sends only the approved request fields and never receives or
 * supplies provider credentials.
 */
export async function requestHandoverPeriodComparison(
  input: HandoverPeriodRequest,
  options: HandoverPeriodRequestOptions = {},
): Promise<HandoverPeriodApiResponse> {
  const signal = options.signal;
  if (signal?.aborted) throw new HandoverApiError("ABORTED");
  const patientId = patientIdFromRecords(input.records);
  if (!patientId) throw new HandoverApiError("REQUEST_SERIALIZATION");

  let body: string;
  try {
    body = JSON.stringify({
      reviewStartAt: input.reviewStartAt,
      records: input.records,
      coverageGaps: input.coverageGaps,
      summaryMode: input.summaryMode ?? "deterministic",
    });
  } catch {
    throw new HandoverApiError("REQUEST_SERIALIZATION");
  }

  let response: Response;
  try {
    response = await fetch("/api/handover/period-compare", {
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

  let parsed: HandoverPeriodApiResponse;
  try {
    parsed = parseHandoverPeriodResponse(payload);
  } catch {
    throw new HandoverApiError("INVALID_RESPONSE");
  }

  if (parsed.patient.id !== patientId) {
    throw new HandoverApiError("PATIENT_MISMATCH");
  }

  return parsed;
}

export const compareHandoverPeriod = requestHandoverPeriodComparison;
