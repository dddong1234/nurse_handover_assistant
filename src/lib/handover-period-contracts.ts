import type {
  HandoverChange,
  HandoverChangeCategory,
  HandoverChangeValue,
  HandoverSummary,
} from "./contracts";

export type PeriodClassification = "current" | "period_only" | "trend" | "record_event";
export type PeriodStatus = "ready" | "no_baseline" | "no_events" | "partial";
export type PeriodSummaryMode = "deterministic" | "ai";

export type PeriodInterval = {
  previousRecordedAt: string;
  currentRecordedAt: string;
};

export type PeriodEvent = {
  id: string;
  detectedAt: string;
  interval: PeriodInterval;
  classification: PeriodClassification;
  change: HandoverChange;
};

export type Period = {
  requestedStartAt: string;
  baselineRecordedAt: string | null;
  currentRecordedAt: string;
  snapshotCount: number;
  eventCount: number;
  status: PeriodStatus;
};

export type PeriodReviewItem = {
  id: string;
  category: HandoverChangeCategory;
  label: string;
  classification: PeriodClassification;
  eventIds: string[];
};

export type PeriodReviewGroups = {
  current: PeriodReviewItem[];
  periodOnly: PeriodReviewItem[];
  trends: PeriodReviewItem[];
  recordEvents: PeriodReviewItem[];
};

export type HandoverPeriodSummary = HandoverSummary;

export type HandoverPeriodApiResponse = {
  patient: {
    id: string;
    name: string;
    room: string;
    age: number | null;
    sex: string;
    diagnoses: string[];
  };
  period: Period;
  dataWarnings: string[];
  events: PeriodEvent[];
  reviewGroups: PeriodReviewGroups;
  summary: HandoverPeriodSummary;
};

export type HandoverPeriodResponse = HandoverPeriodApiResponse;
export type HandoverPeriodComparison = HandoverPeriodApiResponse;

export type HandoverPeriodCoverageGap = {
  from: string;
  to: string;
  code?: string | null;
};

export type CoverageGap = HandoverPeriodCoverageGap;
export type HandoverPeriodCompareRequest = HandoverPeriodRequest;

export type HandoverPeriodRequest = {
  reviewStartAt: string;
  records: ReadonlyArray<Record<string, unknown>>;
  coverageGaps: ReadonlyArray<HandoverPeriodCoverageGap>;
  summaryMode?: PeriodSummaryMode;
};

const PERIOD_CLASSIFICATIONS: readonly PeriodClassification[] = [
  "current",
  "period_only",
  "trend",
  "record_event",
];
const PERIOD_STATUSES: readonly PeriodStatus[] = [
  "ready",
  "no_baseline",
  "no_events",
  "partial",
];
const CHANGE_CATEGORIES: readonly HandoverChangeCategory[] = [
  "vitals",
  "medications",
  "diagnosis",
  "notes",
];
const CHANGE_TYPES = ["added", "removed", "modified"] as const;
const REVIEW_PRIORITIES = ["high", "medium", "low"] as const;
const SUMMARY_MODES: readonly PeriodSummaryMode[] = ["deterministic", "ai"];
const REVIEW_GROUP_NAMES = ["current", "periodOnly", "trends", "recordEvents"] as const;

type UnknownRecord = Record<string, unknown>;

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const calendarProbe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const calendarMatches =
    calendarProbe.getUTCFullYear() === year &&
    calendarProbe.getUTCMonth() === month - 1 &&
    calendarProbe.getUTCDate() === day &&
    calendarProbe.getUTCHours() === hour &&
    calendarProbe.getUTCMinutes() === minute &&
    calendarProbe.getUTCSeconds() === second;

  if (!calendarMatches || !Number.isFinite(Date.parse(value))) return false;
  if (offset !== "Z") {
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return false;
  }
  return true;
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function isStringArray(value: unknown, allowBlank = false): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => (allowBlank ? typeof item === "string" : isNonBlankString(item)))
  );
}

function isMedicationValue(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["name", "route", "frequency"]) &&
    isNonBlankString(value.name) &&
    isNonBlankString(value.route) &&
    isNonBlankString(value.frequency)
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
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "id",
      "category",
      "changeType",
      "reviewPriority",
      "label",
      "previousValue",
      "currentValue",
      "delta",
      "evidence",
    ])
  ) {
    return false;
  }

  const evidence = value.evidence;
  return (
    isNonBlankString(value.id) &&
    CHANGE_CATEGORIES.includes(value.category as HandoverChangeCategory) &&
    CHANGE_TYPES.includes(value.changeType as (typeof CHANGE_TYPES)[number]) &&
    REVIEW_PRIORITIES.includes(value.reviewPriority as (typeof REVIEW_PRIORITIES)[number]) &&
    isNonBlankString(value.label) &&
    isChangeValue(value.previousValue) &&
    isChangeValue(value.currentValue) &&
    (value.delta === null || isFiniteNumber(value.delta)) &&
    isPlainObject(evidence) &&
    hasExactKeys(evidence, ["fieldPath", "previousRecordedAt", "currentRecordedAt"]) &&
    isNonBlankString(evidence.fieldPath) &&
    isNullableIsoTimestamp(evidence.previousRecordedAt) &&
    isNullableIsoTimestamp(evidence.currentRecordedAt)
  );
}

function isSummaryItem(value: unknown): value is HandoverSummary["sections"]["situation"][number] {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["text", "evidenceIds"]) &&
    isNonBlankString(value.text) &&
    isStringArray(value.evidenceIds)
  );
}

function isSummary(value: unknown): value is HandoverSummary {
  if (!isPlainObject(value) || !hasExactKeys(value, ["mode", "sections", "evidenceIds", "warnings"])) {
    return false;
  }

  const sections = value.sections;
  return (
    SUMMARY_MODES.includes(value.mode as PeriodSummaryMode) &&
    isPlainObject(sections) &&
    hasExactKeys(sections, ["situation", "background", "assessment", "recommendation"]) &&
    [sections.situation, sections.background, sections.assessment, sections.recommendation].every(
      (items) => Array.isArray(items) && items.every(isSummaryItem),
    ) &&
    isStringArray(value.evidenceIds) &&
    isStringArray(value.warnings, true)
  );
}

function isPeriodEvent(value: unknown): value is PeriodEvent {
  if (!isPlainObject(value) || !hasExactKeys(value, ["id", "detectedAt", "interval", "classification", "change"])) {
    return false;
  }

  const interval = value.interval;
  return (
    isNonBlankString(value.id) &&
    isIsoTimestamp(value.detectedAt) &&
    isPlainObject(interval) &&
    hasExactKeys(interval, ["previousRecordedAt", "currentRecordedAt"]) &&
    isIsoTimestamp(interval.previousRecordedAt) &&
    isIsoTimestamp(interval.currentRecordedAt) &&
    PERIOD_CLASSIFICATIONS.includes(value.classification as PeriodClassification) &&
    isChange(value.change)
  );
}

function isPeriodReviewItem(value: unknown): value is PeriodReviewItem {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["id", "category", "label", "classification", "eventIds"]) &&
    isNonBlankString(value.id) &&
    CHANGE_CATEGORIES.includes(value.category as HandoverChangeCategory) &&
    isNonBlankString(value.label) &&
    PERIOD_CLASSIFICATIONS.includes(value.classification as PeriodClassification) &&
    isStringArray(value.eventIds)
  );
}

function isPatient(value: unknown): value is HandoverPeriodApiResponse["patient"] {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["id", "name", "room", "age", "sex", "diagnoses"]) &&
    isNonBlankString(value.id) &&
    isNonBlankString(value.name) &&
    isNonBlankString(value.room) &&
    (value.age === null || (isFiniteNumber(value.age) && value.age >= 0)) &&
    isNonBlankString(value.sex) &&
    isStringArray(value.diagnoses)
  );
}

function isPeriod(value: unknown): value is Period {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      "requestedStartAt",
      "baselineRecordedAt",
      "currentRecordedAt",
      "snapshotCount",
      "eventCount",
      "status",
    ]) &&
    isIsoTimestamp(value.requestedStartAt) &&
    isNullableIsoTimestamp(value.baselineRecordedAt) &&
    isIsoTimestamp(value.currentRecordedAt) &&
    isFiniteInteger(value.snapshotCount) &&
    value.snapshotCount > 0 &&
    isFiniteInteger(value.eventCount) &&
    value.eventCount >= 0 &&
    PERIOD_STATUSES.includes(value.status as PeriodStatus)
  );
}

function hasOnlyKnownEventIds(ids: readonly string[], knownIds: ReadonlySet<string>): boolean {
  return ids.every((id) => knownIds.has(id));
}

function isPeriodResponse(value: unknown): value is HandoverPeriodApiResponse {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["patient", "period", "dataWarnings", "events", "reviewGroups", "summary"])
  ) {
    return false;
  }
  if (!isPatient(value.patient) || !isPeriod(value.period) || !isStringArray(value.dataWarnings, true)) {
    return false;
  }
  if (!Array.isArray(value.events) || !value.events.every(isPeriodEvent)) return false;
  if (value.period.eventCount !== value.events.length) return false;
  if (new Set(value.events.map((event) => event.id)).size !== value.events.length) return false;

  const knownEventIds = new Set(value.events.map((event) => event.id));
  const reviewGroups = value.reviewGroups;
  if (
    !isPlainObject(reviewGroups) ||
    !hasExactKeys(reviewGroups, REVIEW_GROUP_NAMES) ||
    !REVIEW_GROUP_NAMES.every((groupName) => {
      const items = reviewGroups[groupName];
      return Array.isArray(items) && items.every(isPeriodReviewItem);
    })
  ) {
    return false;
  }

  for (const groupName of REVIEW_GROUP_NAMES) {
    for (const item of reviewGroups[groupName] as PeriodReviewItem[]) {
      if (!item.eventIds.length || !hasOnlyKnownEventIds(item.eventIds, knownEventIds)) return false;
    }
  }

  if (!isSummary(value.summary)) return false;
  if (!hasOnlyKnownEventIds(value.summary.evidenceIds, knownEventIds)) return false;
  const sectionItems = Object.values(value.summary.sections).flat();
  return sectionItems.every((item) => hasOnlyKnownEventIds(item.evidenceIds, knownEventIds));
}

/** Return true only for a complete, reference-safe period comparison response. */
export function isHandoverPeriodApiResponse(value: unknown): value is HandoverPeriodApiResponse {
  return isPeriodResponse(value);
}

/** Parse a server response at the browser boundary, rejecting malformed or dangling data. */
export function parseHandoverPeriodResponse(value: unknown): HandoverPeriodApiResponse {
  if (!isPeriodResponse(value)) {
    throw new Error("인수인계 기간 비교 응답의 계약이 올바르지 않습니다.");
  }
  return value;
}

/** Assert a response contract for callers that prefer an assertion signature. */
export function assertHandoverPeriodApiResponse(
  value: unknown,
): asserts value is HandoverPeriodApiResponse {
  parseHandoverPeriodResponse(value);
}

export const isHandoverPeriodResponse = isHandoverPeriodApiResponse;
export const parseHandoverPeriodApiResponse = parseHandoverPeriodResponse;
export const validateHandoverPeriodResponse = isHandoverPeriodApiResponse;
export const validateHandoverPeriodApiResponse = isHandoverPeriodApiResponse;

export type { HandoverChange, HandoverChangeCategory, HandoverChangeValue, HandoverSummary };
