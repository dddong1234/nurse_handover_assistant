import type { DemoPatientRecord } from "./demo-records";

export const RECORD_DRAFTS_STORAGE_KEY = "nurse-handover:record-drafts:v1";

export type StorageBoundary = Pick<Storage, "getItem" | "setItem">;
export type RecordDrafts = Record<string, DemoPatientRecord>;

type UnknownRecord = Record<string, unknown>;

const RECORD_KEYS = [
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
const VITAL_KEYS = [
  "systolic",
  "diastolic",
  "heartrate",
  "respiratory",
  "saturation",
  "body_temperature",
] as const;
const MEDICATION_KEYS = ["name", "route", "frequency"] as const;

function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]) {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    actualKeys.every((key) => keys.includes(key))
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonBlankString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonBlankString);
}

function isNumericRecord(value: unknown): value is Record<string, number> {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, VITAL_KEYS) &&
    Object.values(value).every(isFiniteNumber)
  );
}

function isMedication(value: unknown): value is DemoPatientRecord["medications"][number] {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, MEDICATION_KEYS) &&
    isNonBlankString(value.name) &&
    isNonBlankString(value.route) &&
    isNonBlankString(value.frequency)
  );
}

function isValidTimestamp(value: unknown): value is string {
  if (!isNonBlankString(value)) return false;

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
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

  return calendarMatches && Number.isFinite(Date.parse(value));
}

export function isDemoPatientRecord(value: unknown): value is DemoPatientRecord {
  if (!isPlainObject(value) || !hasExactKeys(value, RECORD_KEYS)) return false;

  return (
    isNonBlankString(value.patient_id) &&
    isNonBlankString(value.name) &&
    isNonBlankString(value.room_no) &&
    isFiniteNumber(value.age) &&
    isNonBlankString(value.sex) &&
    isStringArray(value.diagnosis) &&
    isNumericRecord(value.vitals) &&
    Array.isArray(value.medications) &&
    value.medications.every(isMedication) &&
    isStringArray(value.notes) &&
    isValidTimestamp(value.updated_at)
  );
}

export function cloneDemoRecord(record: DemoPatientRecord): DemoPatientRecord {
  return structuredClone(record);
}

export function loadRecordDrafts(storage: Pick<Storage, "getItem">): RecordDrafts {
  const serialized = storage.getItem(RECORD_DRAFTS_STORAGE_KEY);
  if (!serialized) return {};

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isPlainObject(parsed)) return {};

    const drafts: RecordDrafts = {};
    for (const [patientId, value] of Object.entries(parsed)) {
      if (isDemoPatientRecord(value) && value.patient_id === patientId) {
        drafts[patientId] = cloneDemoRecord(value);
      }
    }
    return drafts;
  } catch {
    return {};
  }
}

export function persistRecordDraft(storage: StorageBoundary, record: DemoPatientRecord): void {
  if (!isDemoPatientRecord(record)) return;

  const drafts = loadRecordDrafts(storage);
  const clonedRecord = cloneDemoRecord(record);
  drafts[clonedRecord.patient_id] = clonedRecord;
  storage.setItem(RECORD_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

export function removeRecordDraft(storage: StorageBoundary, patientId: string): void {
  const drafts = loadRecordDrafts(storage);
  delete drafts[patientId];
  storage.setItem(RECORD_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}
