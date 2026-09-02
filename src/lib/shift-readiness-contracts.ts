import type {
  HandoverPeriodApiResponse,
  HandoverPeriodCoverageGap,
} from "./handover-period-contracts";
import type {
  ShiftReadinessRecord,
  ShiftWindow,
} from "./demo-shift-readiness";

export type ShiftReadinessDomain =
  | "patient_status"
  | "investigation"
  | "line_device"
  | "medication"
  | "communication";

export type ShiftReadinessFactStatus =
  | "new_result"
  | "scheduled_this_shift"
  | "pending_result"
  | "recent_change"
  | "explicit_follow_up";

export type ShiftReadinessRuleCode =
  | "STATUS_PERIOD_CHANGE"
  | "INVESTIGATION_NEW_RESULT"
  | "INVESTIGATION_SCHEDULED_SHIFT"
  | "INVESTIGATION_PENDING"
  | "DEVICE_DUE_SHIFT"
  | "DEVICE_RECENT_CHANGE"
  | "MEDICATION_EFFECTIVE_SHIFT"
  | "MEDICATION_RECENT_CHANGE"
  | "COMMUNICATION_EXPLICIT_OPEN";

export type ShiftReadinessStatus = "available" | "no_baseline" | "no_items" | "partial";

export type ShiftReadinessSourceRef = {
  recordedAt: string;
  path: string;
  label: string;
  periodEventId?: string;
};

export type ShiftReadinessItem = {
  id: string;
  patientId: string;
  domain: ShiftReadinessDomain;
  factStatus: ShiftReadinessFactStatus;
  title: string;
  detail: string;
  relevantAt: string | null;
  sourceRefs: ShiftReadinessSourceRef[];
  ruleCode: ShiftReadinessRuleCode;
};

export type ShiftReadinessGroups = {
  patientStatus: string[];
  investigations: string[];
  lineDevices: string[];
  medications: string[];
  communications: string[];
};

export type ShiftReadinessResponse = {
  patient: HandoverPeriodApiResponse["patient"];
  reviewPeriod: {
    requestedStartAt: string;
    baselineRecordedAt: string | null;
    currentRecordedAt: string;
  };
  shift: ShiftWindow;
  status: ShiftReadinessStatus;
  dataWarnings: string[];
  items: ShiftReadinessItem[];
  groups: ShiftReadinessGroups;
  metrics: {
    itemCount: number;
    newResultCount: number;
    scheduledThisShiftCount: number;
    pendingResultCount: number;
    domainCounts: Record<ShiftReadinessDomain, number>;
  };
};

export type ShiftReadinessRequest = {
  reviewStartAt: string;
  shift: ShiftWindow;
  records: ShiftReadinessRecord[];
  coverageGaps: HandoverPeriodCoverageGap[];
};

export type RequestShiftReadinessOptions = {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export const SHIFT_READINESS_DOMAINS: readonly ShiftReadinessDomain[] = [
  "patient_status",
  "investigation",
  "line_device",
  "medication",
  "communication",
];

export const SHIFT_READINESS_FACT_STATUSES: readonly ShiftReadinessFactStatus[] = [
  "new_result",
  "scheduled_this_shift",
  "pending_result",
  "recent_change",
  "explicit_follow_up",
];

export const SHIFT_READINESS_RULE_CODES: readonly ShiftReadinessRuleCode[] = [
  "STATUS_PERIOD_CHANGE",
  "INVESTIGATION_NEW_RESULT",
  "INVESTIGATION_SCHEDULED_SHIFT",
  "INVESTIGATION_PENDING",
  "DEVICE_DUE_SHIFT",
  "DEVICE_RECENT_CHANGE",
  "MEDICATION_EFFECTIVE_SHIFT",
  "MEDICATION_RECENT_CHANGE",
  "COMMUNICATION_EXPLICIT_OPEN",
];

export const SHIFT_READINESS_STATUSES: readonly ShiftReadinessStatus[] = [
  "available",
  "no_baseline",
  "no_items",
  "partial",
];

const GROUP_NAMES = [
  "patientStatus",
  "investigations",
  "lineDevices",
  "medications",
  "communications",
] as const;

const DOMAIN_GROUPS: Record<ShiftReadinessDomain, (typeof GROUP_NAMES)[number]> = {
  patient_status: "patientStatus",
  investigation: "investigations",
  line_device: "lineDevices",
  medication: "medications",
  communication: "communications",
};

const DIRECT_COLLECTIONS: Partial<Record<ShiftReadinessDomain, DirectCollection>> = {
  investigation: "investigations",
  line_device: "devices",
  medication: "medications",
  communication: "handoffRequests",
};

type DirectCollection = "investigations" | "devices" | "medications" | "handoffRequests";
type UnknownRecord = Record<string, unknown>;

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DIRECT_SELECTOR =
  /^(investigations|devices|medications|handoffRequests)\[(id|name)=([^\[\]]+)\]$/;
const FIELD_PATH =
  /^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[(?:"(?:[^"\\]|\\.)*")\]))+$/;

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
  return isFiniteNumber(value) && Number.isSafeInteger(value);
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
  if (
    calendarProbe.getUTCFullYear() !== year ||
    calendarProbe.getUTCMonth() !== month - 1 ||
    calendarProbe.getUTCDate() !== day ||
    calendarProbe.getUTCHours() !== hour ||
    calendarProbe.getUTCMinutes() !== minute ||
    calendarProbe.getUTCSeconds() !== second ||
    !Number.isFinite(Date.parse(value))
  ) {
    return false;
  }

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

function isReviewPeriod(value: unknown): value is ShiftReadinessResponse["reviewPeriod"] {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["requestedStartAt", "baselineRecordedAt", "currentRecordedAt"]) &&
    isIsoTimestamp(value.requestedStartAt) &&
    isNullableIsoTimestamp(value.baselineRecordedAt) &&
    isIsoTimestamp(value.currentRecordedAt)
  );
}

function isShift(value: unknown): value is ShiftWindow {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["startsAt", "endsAt"]) &&
    isIsoTimestamp(value.startsAt) &&
    isIsoTimestamp(value.endsAt) &&
    Date.parse(value.startsAt) < Date.parse(value.endsAt)
  );
}

function isCanonicalRfc3986Selector(value: string): boolean {
  const match = DIRECT_SELECTOR.exec(value);
  if (!match) return false;
  const [, collection, selector, encodedValue] = match;
  if (
    (collection === "medications" && selector !== "name") ||
    (collection !== "medications" && selector !== "id") ||
    !encodedValue
  ) {
    return false;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedValue);
  } catch {
    return false;
  }
  if (!isNonBlankString(decoded)) return false;

  let canonical: string;
  try {
    canonical = encodeURIComponent(decoded).replace(/[!'()*]/g, (character) => {
      return `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
    });
  } catch {
    return false;
  }
  return encodedValue === canonical;
}

function directCollection(value: string): DirectCollection | null {
  const match = DIRECT_SELECTOR.exec(value);
  if (!match || !isCanonicalRfc3986Selector(value)) return null;
  return match[1] as DirectCollection;
}

function isSourceRef(value: unknown, domain: ShiftReadinessDomain): value is ShiftReadinessSourceRef {
  if (!isPlainObject(value)) return false;
  const hasPeriodEventId = Object.prototype.hasOwnProperty.call(value, "periodEventId");
  const expectedKeys = hasPeriodEventId
    ? ["recordedAt", "path", "label", "periodEventId"]
    : ["recordedAt", "path", "label"];
  if (
    !hasExactKeys(value, expectedKeys) ||
    !isIsoTimestamp(value.recordedAt) ||
    !isNonBlankString(value.path) ||
    !isNonBlankString(value.label)
  ) {
    return false;
  }

  if (hasPeriodEventId) {
    if (!isNonBlankString(value.periodEventId) || isCanonicalRfc3986Selector(value.path)) return false;
    return FIELD_PATH.test(value.path);
  }

  if (!isCanonicalRfc3986Selector(value.path)) return false;
  const collection = directCollection(value.path);
  const expectedCollection = DIRECT_COLLECTIONS[domain];
  return collection !== null && expectedCollection === collection;
}

const EXPECTED_FACT_STATUS: Record<ShiftReadinessRuleCode, ShiftReadinessFactStatus> = {
  STATUS_PERIOD_CHANGE: "recent_change",
  INVESTIGATION_NEW_RESULT: "new_result",
  INVESTIGATION_SCHEDULED_SHIFT: "scheduled_this_shift",
  INVESTIGATION_PENDING: "pending_result",
  DEVICE_DUE_SHIFT: "scheduled_this_shift",
  DEVICE_RECENT_CHANGE: "recent_change",
  MEDICATION_EFFECTIVE_SHIFT: "scheduled_this_shift",
  MEDICATION_RECENT_CHANGE: "recent_change",
  COMMUNICATION_EXPLICIT_OPEN: "explicit_follow_up",
};

const EXPECTED_DOMAIN: Record<ShiftReadinessRuleCode, ShiftReadinessDomain> = {
  STATUS_PERIOD_CHANGE: "patient_status",
  INVESTIGATION_NEW_RESULT: "investigation",
  INVESTIGATION_SCHEDULED_SHIFT: "investigation",
  INVESTIGATION_PENDING: "investigation",
  DEVICE_DUE_SHIFT: "line_device",
  DEVICE_RECENT_CHANGE: "line_device",
  MEDICATION_EFFECTIVE_SHIFT: "medication",
  MEDICATION_RECENT_CHANGE: "medication",
  COMMUNICATION_EXPLICIT_OPEN: "communication",
};

function isShiftReadinessItem(value: unknown): value is ShiftReadinessItem {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "id",
      "patientId",
      "domain",
      "factStatus",
      "title",
      "detail",
      "relevantAt",
      "sourceRefs",
      "ruleCode",
    ]) ||
    !isNonBlankString(value.id) ||
    !isNonBlankString(value.patientId) ||
    !SHIFT_READINESS_DOMAINS.includes(value.domain as ShiftReadinessDomain) ||
    !SHIFT_READINESS_FACT_STATUSES.includes(value.factStatus as ShiftReadinessFactStatus) ||
    !isNonBlankString(value.title) ||
    !isNonBlankString(value.detail) ||
    !isNullableIsoTimestamp(value.relevantAt) ||
    !Array.isArray(value.sourceRefs) ||
    value.sourceRefs.length === 0 ||
    !SHIFT_READINESS_RULE_CODES.includes(value.ruleCode as ShiftReadinessRuleCode)
  ) {
    return false;
  }

  const ruleCode = value.ruleCode as ShiftReadinessRuleCode;
  const domain = value.domain as ShiftReadinessDomain;
  return (
    value.factStatus === EXPECTED_FACT_STATUS[ruleCode] &&
    domain === EXPECTED_DOMAIN[ruleCode] &&
    value.sourceRefs.every((ref) => isSourceRef(ref, domain))
  );
}

function isGroups(value: unknown): value is ShiftReadinessGroups {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, GROUP_NAMES) &&
    GROUP_NAMES.every(
      (groupName) => Array.isArray(value[groupName]) && value[groupName].every(isNonBlankString),
    )
  );
}

function isMetrics(value: unknown): value is ShiftReadinessResponse["metrics"] {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "itemCount",
      "newResultCount",
      "scheduledThisShiftCount",
      "pendingResultCount",
      "domainCounts",
    ]) ||
    !isFiniteInteger(value.itemCount) ||
    value.itemCount < 0 ||
    !isFiniteInteger(value.newResultCount) ||
    value.newResultCount < 0 ||
    !isFiniteInteger(value.scheduledThisShiftCount) ||
    value.scheduledThisShiftCount < 0 ||
    !isFiniteInteger(value.pendingResultCount) ||
    value.pendingResultCount < 0 ||
    !isPlainObject(value.domainCounts) ||
    !hasExactKeys(value.domainCounts, SHIFT_READINESS_DOMAINS)
  ) {
    return false;
  }
  const domainCounts = value.domainCounts;
  if (!isPlainObject(domainCounts)) return false;
  return SHIFT_READINESS_DOMAINS.every((domain) => {
    const count = domainCounts[domain];
    return isFiniteInteger(count) && count >= 0;
  });
}

function validateGroupIntegrity(
  items: readonly ShiftReadinessItem[],
  groups: ShiftReadinessGroups,
): boolean {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const membership = new Map<string, number>();

  for (const domain of SHIFT_READINESS_DOMAINS) {
    const groupName = DOMAIN_GROUPS[domain];
    for (const itemId of groups[groupName]) {
      const item = itemsById.get(itemId);
      if (!item || item.domain !== domain) return false;
      membership.set(itemId, (membership.get(itemId) ?? 0) + 1);
    }
  }

  return items.every((item) => membership.get(item.id) === 1) && membership.size === items.length;
}

function validateMetricIntegrity(
  items: readonly ShiftReadinessItem[],
  groups: ShiftReadinessGroups,
  metrics: ShiftReadinessResponse["metrics"],
): boolean {
  if (metrics.itemCount !== items.length) return false;
  if (metrics.newResultCount !== items.filter((item) => item.factStatus === "new_result").length) {
    return false;
  }
  if (
    metrics.scheduledThisShiftCount !==
    items.filter((item) => item.factStatus === "scheduled_this_shift").length
  ) {
    return false;
  }
  if (
    metrics.pendingResultCount !== items.filter((item) => item.factStatus === "pending_result").length
  ) {
    return false;
  }

  return SHIFT_READINESS_DOMAINS.every((domain) => {
    const groupName = DOMAIN_GROUPS[domain];
    return metrics.domainCounts[domain] === groups[groupName].length;
  });
}

function isResponse(value: unknown): value is ShiftReadinessResponse {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "patient",
      "reviewPeriod",
      "shift",
      "status",
      "dataWarnings",
      "items",
      "groups",
      "metrics",
    ]) ||
    !isPatient(value.patient) ||
    !isReviewPeriod(value.reviewPeriod) ||
    !isShift(value.shift) ||
    !SHIFT_READINESS_STATUSES.includes(value.status as ShiftReadinessStatus) ||
    !isStringArray(value.dataWarnings, true) ||
    !Array.isArray(value.items) ||
    !value.items.every(isShiftReadinessItem) ||
    !isGroups(value.groups) ||
    !isMetrics(value.metrics)
  ) {
    return false;
  }

  const patient = value.patient;
  const reviewPeriod = value.reviewPeriod;
  const items = value.items;
  if (new Set(items.map((item) => item.id)).size !== items.length) return false;
  if (!isPatient(patient) || !isReviewPeriod(reviewPeriod)) return false;
  if (items.some((item) => item.patientId !== patient.id)) return false;
  if (!validateGroupIntegrity(items, value.groups)) return false;
  if (!validateMetricIntegrity(items, value.groups, value.metrics)) return false;
  if (value.status === "no_items" && items.length !== 0) return false;
  if (value.status === "available" && items.length === 0) return false;
  if (value.status === "no_baseline" && reviewPeriod.baselineRecordedAt !== null) return false;
  return true;
}

/** Return true only for a complete, reference-safe Shift Readiness response. */
export function isShiftReadinessResponse(value: unknown): value is ShiftReadinessResponse {
  return isResponse(value);
}

/** Parse an unknown server payload at the browser boundary. */
export function parseShiftReadinessResponse(value: unknown): ShiftReadinessResponse {
  if (!isResponse(value)) {
    throw new Error("Shift Readiness 응답의 계약이 올바르지 않습니다.");
  }
  return value;
}

export type { HandoverPeriodCoverageGap, ShiftReadinessRecord, ShiftWindow };
