import p001Sidecar from "../../data/shift-readiness/P001.json";
import p002Sidecar from "../../data/shift-readiness/P002.json";
import p003Sidecar from "../../data/shift-readiness/P003.json";
import p004Sidecar from "../../data/shift-readiness/P004.json";
import p005Sidecar from "../../data/shift-readiness/P005.json";

import type { DemoMedication, DemoPatientRecord } from "./demo-records";
import { getDemoTimeline } from "./demo-timelines";

export type ShiftWindow = {
  startsAt: string;
  endsAt: string;
};

export type Investigation = {
  id: string;
  kind: "lab" | "imaging";
  name: string;
  orderedAt: string;
  scheduledAt: string | null;
  status: "ordered" | "scheduled" | "in_progress" | "resulted" | "cancelled";
  resultedAt: string | null;
  resultSummary: string | null;
};

export type Device = {
  id: string;
  type: string;
  site: string;
  insertedAt: string;
  changeDueAt: string | null;
  status: "active" | "removal_ordered" | "removed";
  removedAt: string | null;
};

export type MedicationSchedule = {
  effectiveFrom: string | null;
  effectiveTo: string | null;
  orderStatus: "planned" | "active" | "stopped";
};

export type HandoffRequest = {
  id: string;
  topic: string;
  requestedAt: string;
  dueBy: string | null;
  sourceType: "physician_order" | "nursing_note";
  status: "open" | "communicated" | "cancelled";
};

export type ShiftReadinessRecord = Omit<DemoPatientRecord, "medications"> & {
  investigations: Investigation[];
  devices: Device[];
  medications: Array<DemoMedication & MedicationSchedule>;
  handoffRequests: HandoffRequest[];
};

export type ShiftReadinessContractErrorCode =
  | "UNKNOWN_PATIENT"
  | "INVALID_CORE_TIMELINE"
  | "INVALID_OPERATIONAL_METADATA"
  | "STALE_OPERATIONAL_METADATA";

export class ShiftReadinessContractError extends Error {
  readonly code: ShiftReadinessContractErrorCode;

  constructor(code: ShiftReadinessContractErrorCode, message: string) {
    super(message);
    this.name = "ShiftReadinessContractError";
    this.code = code;
  }
}

export const ShiftReadinessAdapterError = ShiftReadinessContractError;

type UnknownRecord = Record<string, unknown>;
type SidecarMedicationSchedule = {
  medicationName: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  orderStatus: MedicationSchedule["orderStatus"];
};
type SidecarState = {
  investigations: Investigation[];
  devices: Device[];
  medicationSchedules: SidecarMedicationSchedule[];
  handoffRequests: HandoffRequest[];
};
type ShiftReadinessSidecar = {
  patientId: string;
  defaultShift: ShiftWindow;
  states: Record<string, SidecarState>;
};

const PATIENT_IDS = ["P001", "P002", "P003", "P004", "P005"] as const;
const IMPORTED_SIDECARS: Readonly<Record<string, unknown>> = {
  P001: p001Sidecar,
  P002: p002Sidecar,
  P003: p003Sidecar,
  P004: p004Sidecar,
  P005: p005Sidecar,
};

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const INVESTIGATION_KINDS = ["lab", "imaging"] as const;
const INVESTIGATION_STATUSES = ["ordered", "scheduled", "in_progress", "resulted", "cancelled"] as const;
const DEVICE_STATUSES = ["active", "removal_ordered", "removed"] as const;
const MEDICATION_ORDER_STATUSES = ["planned", "active", "stopped"] as const;
const HANDOFF_SOURCE_TYPES = ["physician_order", "nursing_note"] as const;
const HANDOFF_STATUSES = ["open", "communicated", "cancelled"] as const;

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

function isUniqueIdArray(values: readonly { id: string }[]): boolean {
  return new Set(values.map((value) => value.id)).size === values.length;
}

function isInvestigation(value: unknown): value is Investigation {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, [
      "id",
      "kind",
      "name",
      "orderedAt",
      "scheduledAt",
      "status",
      "resultedAt",
      "resultSummary",
    ]) &&
    isNonBlankString(value.id) &&
    INVESTIGATION_KINDS.includes(value.kind as Investigation["kind"]) &&
    isNonBlankString(value.name) &&
    isIsoTimestamp(value.orderedAt) &&
    isNullableIsoTimestamp(value.scheduledAt) &&
    INVESTIGATION_STATUSES.includes(value.status as Investigation["status"]) &&
    isNullableIsoTimestamp(value.resultedAt) &&
    (value.resultSummary === null || isNonBlankString(value.resultSummary))
  );
}

function isDevice(value: unknown): value is Device {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["id", "type", "site", "insertedAt", "changeDueAt", "status", "removedAt"]) &&
    isNonBlankString(value.id) &&
    isNonBlankString(value.type) &&
    isNonBlankString(value.site) &&
    isIsoTimestamp(value.insertedAt) &&
    isNullableIsoTimestamp(value.changeDueAt) &&
    DEVICE_STATUSES.includes(value.status as Device["status"]) &&
    isNullableIsoTimestamp(value.removedAt)
  );
}

function isMedicationSchedule(value: unknown): value is SidecarMedicationSchedule {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["medicationName", "effectiveFrom", "effectiveTo", "orderStatus"]) &&
    isNonBlankString(value.medicationName) &&
    isNullableIsoTimestamp(value.effectiveFrom) &&
    isNullableIsoTimestamp(value.effectiveTo) &&
    MEDICATION_ORDER_STATUSES.includes(value.orderStatus as MedicationSchedule["orderStatus"])
  );
}

function isHandoffRequest(value: unknown): value is HandoffRequest {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["id", "topic", "requestedAt", "dueBy", "sourceType", "status"]) &&
    isNonBlankString(value.id) &&
    isNonBlankString(value.topic) &&
    isIsoTimestamp(value.requestedAt) &&
    isNullableIsoTimestamp(value.dueBy) &&
    HANDOFF_SOURCE_TYPES.includes(value.sourceType as HandoffRequest["sourceType"]) &&
    HANDOFF_STATUSES.includes(value.status as HandoffRequest["status"])
  );
}

function isShiftWindow(value: unknown): value is ShiftWindow {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["startsAt", "endsAt"]) &&
    isIsoTimestamp(value.startsAt) &&
    isIsoTimestamp(value.endsAt) &&
    Date.parse(value.startsAt) < Date.parse(value.endsAt)
  );
}

function isSidecarState(value: unknown): value is SidecarState {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["investigations", "devices", "medicationSchedules", "handoffRequests"]) ||
    !Array.isArray(value.investigations) ||
    !value.investigations.every(isInvestigation) ||
    !isUniqueIdArray(value.investigations) ||
    !Array.isArray(value.devices) ||
    !value.devices.every(isDevice) ||
    !isUniqueIdArray(value.devices) ||
    !Array.isArray(value.medicationSchedules) ||
    !value.medicationSchedules.every(isMedicationSchedule) ||
    !Array.isArray(value.handoffRequests) ||
    !value.handoffRequests.every(isHandoffRequest) ||
    !isUniqueIdArray(value.handoffRequests)
  ) {
    return false;
  }
  return new Set(value.medicationSchedules.map((schedule) => schedule.medicationName)).size ===
    value.medicationSchedules.length;
}

function validateSidecar(patientId: string, value: unknown): ShiftReadinessSidecar {
  const timeline = getDemoTimeline(patientId);
  const canonicalTimestamps = timeline.snapshots.map((snapshot) => snapshot.updated_at);
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["patientId", "defaultShift", "states"]) ||
    value.patientId !== patientId ||
    !isShiftWindow(value.defaultShift) ||
    !isPlainObject(value.states) ||
    Object.keys(value.states).length !== canonicalTimestamps.length ||
    Object.keys(value.states).some((timestamp) => !canonicalTimestamps.includes(timestamp)) ||
    canonicalTimestamps.some((timestamp) => !Object.prototype.hasOwnProperty.call(value.states, timestamp))
  ) {
    throw new ShiftReadinessContractError(
      "INVALID_OPERATIONAL_METADATA",
      `데모 Shift Readiness sidecar ${patientId}의 계약이 올바르지 않습니다.`,
    );
  }

  for (const timestamp of canonicalTimestamps) {
    if (!isSidecarState(value.states[timestamp])) {
      throw new ShiftReadinessContractError(
        "INVALID_OPERATIONAL_METADATA",
        `데모 Shift Readiness sidecar ${patientId}의 상태가 올바르지 않습니다.`,
      );
    }
    const state = value.states[timestamp] as SidecarState;
    const coreRecord = timeline.snapshots.find((snapshot) => snapshot.updated_at === timestamp);
    if (!coreRecord) {
      throw new ShiftReadinessContractError(
        "INVALID_OPERATIONAL_METADATA",
        `데모 Shift Readiness sidecar ${patientId}의 시각을 찾을 수 없습니다.`,
      );
    }
    const medicationNames = new Set(coreRecord.medications.map((medication) => medication.name));
    if (state.medicationSchedules.some((schedule) => !medicationNames.has(schedule.medicationName))) {
      throw new ShiftReadinessContractError(
        "INVALID_OPERATIONAL_METADATA",
        `데모 Shift Readiness sidecar ${patientId}의 투약 metadata가 core 기록과 일치하지 않습니다.`,
      );
    }
  }

  return value as ShiftReadinessSidecar;
}

const VALIDATED_SIDECARS: Readonly<Record<string, ShiftReadinessSidecar>> = Object.fromEntries(
  PATIENT_IDS.map((patientId) => [patientId, validateSidecar(patientId, IMPORTED_SIDECARS[patientId])]),
);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function throwCoreContract(message: string): never {
  throw new ShiftReadinessContractError("INVALID_CORE_TIMELINE", message);
}

function validateCoreRecords(
  patientId: string,
  coreRecords: readonly DemoPatientRecord[],
): { canonical: ReturnType<typeof getDemoTimeline>; records: DemoPatientRecord[] } {
  const timeline = getDemoTimeline(patientId);
  if (!Array.isArray(coreRecords) || coreRecords.length !== timeline.snapshots.length) {
    return throwCoreContract(`환자 ${patientId}의 core timeline은 8개 slot이어야 합니다.`);
  }
  if (!coreRecords.every((record) => record && typeof record === "object")) {
    return throwCoreContract(`환자 ${patientId}의 core timeline record가 올바르지 않습니다.`);
  }

  if (!coreRecords.every((record) => isDemoPatientRecordLike(record) && record.patient_id === patientId)) {
    return throwCoreContract(`환자 ${patientId}의 core timeline patient 또는 record가 올바르지 않습니다.`);
  }

  let records: DemoPatientRecord[];
  try {
    records = coreRecords.map((record) => clone(record));
  } catch {
    return throwCoreContract(`환자 ${patientId}의 core timeline을 복제하지 못했습니다.`);
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const canonical = timeline.snapshots[index];
    if (!record || !canonical) return throwCoreContract(`환자 ${patientId}의 core slot이 없습니다.`);
    if (index < records.length - 1 && JSON.stringify(record) !== JSON.stringify(canonical)) {
      return throwCoreContract(`환자 ${patientId}의 historical core slot이 변경되었습니다.`);
    }
    if (index === records.length - 1 && Date.parse(record.updated_at) <= Date.parse(records[index - 1]!.updated_at)) {
      return throwCoreContract(`환자 ${patientId}의 current core timestamp가 순서를 벗어났습니다.`);
    }
  }

  const timestamps = records.map((record) => record.updated_at);
  if (new Set(timestamps).size !== timestamps.length) {
    return throwCoreContract(`환자 ${patientId}의 core timestamp가 중복되었습니다.`);
  }
  return { canonical: timeline, records };
}

function isDemoPatientRecordLike(value: unknown): value is DemoPatientRecord {
  if (!isPlainObject(value)) return false;
  const keys = [
    "patient_id",
    "name",
    "room_no",
    "age",
    "sex",
    "diagnosis",
    "vitals",
    "medications",
    "notes",
    "updated_at",
  ] as const;
  if (!hasExactKeys(value, keys)) return false;
  if (
    !isNonBlankString(value.patient_id) ||
    !isNonBlankString(value.name) ||
    !isNonBlankString(value.room_no) ||
    typeof value.age !== "number" ||
    !Number.isFinite(value.age) ||
    !isNonBlankString(value.sex) ||
    !Array.isArray(value.diagnosis) ||
    !value.diagnosis.every(isNonBlankString) ||
    !isPlainObject(value.vitals) ||
    !Array.isArray(value.medications) ||
    !value.medications.every(isDemoMedication) ||
    !Array.isArray(value.notes) ||
    !value.notes.every(isNonBlankString) ||
    !isIsoTimestamp(value.updated_at)
  ) {
    return false;
  }
  const vitalKeys = ["systolic", "diastolic", "heartrate", "respiratory", "saturation", "body_temperature"];
  return (
    hasExactKeys(value.vitals, vitalKeys) &&
    Object.values(value.vitals).every((vital) => typeof vital === "number" && Number.isFinite(vital))
  );
}

function isDemoMedication(value: unknown): value is DemoMedication {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["name", "route", "frequency"]) &&
    isNonBlankString(value.name) &&
    isNonBlankString(value.route) &&
    isNonBlankString(value.frequency)
  );
}

function mergeRecord(
  record: DemoPatientRecord,
  state: SidecarState,
  patientId: string,
): ShiftReadinessRecord {
  const schedulesByName = new Map(state.medicationSchedules.map((schedule) => [schedule.medicationName, schedule]));
  const medicationNames = new Set(record.medications.map((medication) => medication.name));
  for (const schedule of state.medicationSchedules) {
    if (!medicationNames.has(schedule.medicationName)) {
      throw new ShiftReadinessContractError(
        "STALE_OPERATIONAL_METADATA",
        `환자 ${patientId}의 ${schedule.medicationName} 투약 metadata가 현재 core 기록에 없습니다.`,
      );
    }
  }

  const medications = record.medications.map((medication) => {
    const schedule = schedulesByName.get(medication.name);
    return {
      ...clone(medication),
      ...(schedule
        ? {
            effectiveFrom: schedule.effectiveFrom,
            effectiveTo: schedule.effectiveTo,
            orderStatus: schedule.orderStatus,
          }
        : {
            effectiveFrom: null,
            effectiveTo: null,
            orderStatus: "planned" as const,
          }),
    };
  });

  return {
    ...clone(record),
    investigations: clone(state.investigations),
    devices: clone(state.devices),
    medications,
    handoffRequests: clone(state.handoffRequests),
  };
}

export function getDemoShiftWindow(patientId: string): ShiftWindow {
  const sidecar = VALIDATED_SIDECARS[patientId];
  if (!sidecar) {
    throw new ShiftReadinessContractError(
      "UNKNOWN_PATIENT",
      `데모 Shift Readiness 환자를 찾을 수 없습니다: ${patientId}`,
    );
  }
  return clone(sidecar.defaultShift);
}

export function buildShiftReadinessRecords(
  patientId: string,
  coreRecords: readonly DemoPatientRecord[],
): ShiftReadinessRecord[] {
  const sidecar = VALIDATED_SIDECARS[patientId];
  if (!sidecar) {
    throw new ShiftReadinessContractError(
      "UNKNOWN_PATIENT",
      `데모 Shift Readiness 환자를 찾을 수 없습니다: ${patientId}`,
    );
  }

  const { canonical, records } = validateCoreRecords(patientId, coreRecords);
  return records.map((record, index) => {
    const canonicalTimestamp = canonical.snapshots[index]?.updated_at;
    if (!canonicalTimestamp) {
      throw new ShiftReadinessContractError(
        "INVALID_CORE_TIMELINE",
        `환자 ${patientId}의 canonical slot을 찾을 수 없습니다.`,
      );
    }
    const state = sidecar.states[canonicalTimestamp];
    if (!state) {
      throw new ShiftReadinessContractError(
        "INVALID_OPERATIONAL_METADATA",
        `환자 ${patientId}의 operational state를 찾을 수 없습니다.`,
      );
    }
    return mergeRecord(record, state, patientId);
  });
}
