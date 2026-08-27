import { DEMO_WORKSPACE_DATA } from "./demo-workspace-data";
import type {
  HandoverApiResponse,
  HandoverChange,
  HandoverChangeValue,
  HandoverSummary,
} from "./contracts";

const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_TIMESTAMP.test(value);
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function isMedicationValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["name", "route", "frequency"]) &&
    typeof value.name === "string" &&
    typeof value.route === "string" &&
    typeof value.frequency === "string"
  );
}

function isChangeValue(value: unknown): value is HandoverChangeValue {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    isMedicationValue(value)
  );
}

function isChange(value: unknown): value is HandoverChange {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id",
    "category",
    "changeType",
    "reviewPriority",
    "label",
    "previousValue",
    "currentValue",
    "delta",
    "evidence",
  ])) {
    return false;
  }

  const evidence = value.evidence;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.category === "vitals" ||
      value.category === "medications" ||
      value.category === "diagnosis" ||
      value.category === "notes") &&
    (value.changeType === "added" ||
      value.changeType === "removed" ||
      value.changeType === "modified") &&
    (value.reviewPriority === "high" ||
      value.reviewPriority === "medium" ||
      value.reviewPriority === "low") &&
    typeof value.label === "string" &&
    isChangeValue(value.previousValue) &&
    isChangeValue(value.currentValue) &&
    (value.delta === null ||
      (typeof value.delta === "number" && Number.isFinite(value.delta))) &&
    isRecord(evidence) &&
    hasOnlyKeys(evidence, [
      "fieldPath",
      "previousRecordedAt",
      "currentRecordedAt",
    ]) &&
    typeof evidence.fieldPath === "string" &&
    evidence.fieldPath.length > 0 &&
    isNullableIsoTimestamp(evidence.previousRecordedAt) &&
    isNullableIsoTimestamp(evidence.currentRecordedAt)
  );
}

function isSummaryItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["text", "evidenceIds"]) &&
    typeof value.text === "string" &&
    Array.isArray(value.evidenceIds) &&
    value.evidenceIds.every((id) => typeof id === "string")
  );
}

function isSummary(value: unknown): value is HandoverSummary {
  if (!isRecord(value) || !hasOnlyKeys(value, ["mode", "sections", "evidenceIds", "warnings"])) {
    return false;
  }

  const sections = value.sections;
  return (
    (value.mode === "deterministic" || value.mode === "ai") &&
    isRecord(sections) &&
    hasOnlyKeys(sections, ["situation", "background", "assessment", "recommendation"]) &&
    [sections.situation, sections.background, sections.assessment, sections.recommendation].every(
      (items) => Array.isArray(items) && items.every(isSummaryItem),
    ) &&
    Array.isArray(value.evidenceIds) &&
    value.evidenceIds.every((id) => typeof id === "string") &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === "string")
  );
}

function validateResponse(value: unknown, index: number): asserts value is HandoverApiResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["comparison", "summary"])) {
    throw new Error(`데모 응답 ${index + 1}의 최상위 계약이 올바르지 않습니다.`);
  }

  const comparison = value.comparison;
  if (
    !isRecord(comparison) ||
    !hasOnlyKeys(comparison, ["patient", "interval", "status", "dataWarnings", "changes"])
  ) {
    throw new Error(`데모 응답 ${index + 1}의 comparison 계약이 올바르지 않습니다.`);
  }

  const patient = comparison.patient;
  const interval = comparison.interval;
  const changes = comparison.changes;
  const patientValid =
    isRecord(patient) &&
    hasOnlyKeys(patient, ["id", "name", "room", "age", "sex", "diagnoses"]) &&
    typeof patient.id === "string" &&
    typeof patient.name === "string" &&
    typeof patient.room === "string" &&
    (patient.age === null || typeof patient.age === "number") &&
    typeof patient.sex === "string" &&
    Array.isArray(patient.diagnoses) &&
    patient.diagnoses.every((diagnosis) => typeof diagnosis === "string");
  const intervalValid =
    isRecord(interval) &&
    hasOnlyKeys(interval, ["previousRecordedAt", "currentRecordedAt"]) &&
    isNullableIsoTimestamp(interval.previousRecordedAt) &&
    isNullableIsoTimestamp(interval.currentRecordedAt);
  const changesValid = Array.isArray(changes) && changes.every(isChange);

  if (
    !patientValid ||
    !intervalValid ||
    !(
      comparison.status === "ready" ||
      comparison.status === "no_previous" ||
      comparison.status === "no_changes" ||
      comparison.status === "partial"
    ) ||
    !Array.isArray(comparison.dataWarnings) ||
    !comparison.dataWarnings.every((warning) => typeof warning === "string") ||
    !changesValid ||
    new Set(changes.map((change) => change.id)).size !== changes.length
  ) {
    throw new Error(`데모 응답 ${index + 1}의 comparison 값이 올바르지 않습니다.`);
  }

  if (!isSummary(value.summary)) {
    throw new Error(`데모 응답 ${index + 1}의 summary 계약이 올바르지 않습니다.`);
  }

  const changeIds = changes.map((change) => change.id);
  if (
    value.summary.evidenceIds.length !== changeIds.length ||
    value.summary.evidenceIds.some((id, evidenceIndex) => id !== changeIds[evidenceIndex])
  ) {
    throw new Error(`데모 응답 ${index + 1}의 근거 ID 순서가 comparison과 다릅니다.`);
  }
}

export function isHandoverApiResponse(value: unknown): value is HandoverApiResponse {
  try {
    validateResponse(value, 0);
    return true;
  } catch {
    return false;
  }
}

function cloneResponse(response: HandoverApiResponse): HandoverApiResponse {
  return JSON.parse(JSON.stringify(response)) as HandoverApiResponse;
}

/**
 * Present immutable-in-practice copies of the checked-in responses.
 * No filesystem, network, or browser persistence is used by this adapter.
 */
export function buildDemoWorkspaceData(): HandoverApiResponse[] {
  DEMO_WORKSPACE_DATA.forEach(validateResponse);
  return DEMO_WORKSPACE_DATA.map(cloneResponse);
}
