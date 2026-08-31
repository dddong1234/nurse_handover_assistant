import p001Timeline from "../../data/timelines/P001.json";
import p002Timeline from "../../data/timelines/P002.json";
import p003Timeline from "../../data/timelines/P003.json";
import p004Timeline from "../../data/timelines/P004.json";
import p005Timeline from "../../data/timelines/P005.json";

import type { DemoPatientRecord } from "./demo-records";
import { isDemoPatientRecord } from "./record-drafts";

export type DemoCoverageGap = {
  from: string;
  to: string;
  code?: string | null;
};

export type DemoRecordTimeline = {
  readonly patientId: string;
  readonly defaultReturnStartAt: string;
  readonly snapshots: readonly DemoPatientRecord[];
  readonly coverageGaps: readonly DemoCoverageGap[];
};

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

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCoverageGap(value: unknown): value is DemoCoverageGap {
  if (!isPlainObject(value)) return false;
  const hasCode = Object.prototype.hasOwnProperty.call(value, "code");
  if (!hasExactKeys(value, hasCode ? ["from", "to", "code"] : ["from", "to"])) return false;
  return (
    isIsoTimestamp(value.from) &&
    isIsoTimestamp(value.to) &&
    (value.code === undefined || value.code === null || isNonBlankString(value.code))
  );
}

function isDemoRecordTimelineValue(value: unknown): value is DemoRecordTimeline {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["patientId", "defaultReturnStartAt", "snapshots", "coverageGaps"]) ||
    !isNonBlankString(value.patientId) ||
    !isIsoTimestamp(value.defaultReturnStartAt) ||
    !Array.isArray(value.snapshots) ||
    value.snapshots.length === 0 ||
    !value.snapshots.every(isDemoPatientRecord) ||
    !Array.isArray(value.coverageGaps) ||
    !value.coverageGaps.every(isCoverageGap)
  ) {
    return false;
  }

  const snapshots = value.snapshots as DemoPatientRecord[];
  if (snapshots.some((snapshot) => snapshot.patient_id !== value.patientId)) return false;
  if (!snapshots.some((snapshot) => snapshot.updated_at === value.defaultReturnStartAt)) return false;
  return snapshots.every((snapshot, index) => {
    const previous = snapshots[index - 1];
    return !previous || Date.parse(previous.updated_at) < Date.parse(snapshot.updated_at);
  });
}

function cloneTimeline(timeline: DemoRecordTimeline): DemoRecordTimeline {
  return structuredClone(timeline);
}

const importedTimelines: Readonly<Record<string, unknown>> = {
  P001: p001Timeline,
  P002: p002Timeline,
  P003: p003Timeline,
  P004: p004Timeline,
  P005: p005Timeline,
};

const validatedTimelines: Record<string, DemoRecordTimeline> = {};
for (const [patientId, timeline] of Object.entries(importedTimelines)) {
  if (!isDemoRecordTimelineValue(timeline) || timeline.patientId !== patientId) {
    throw new Error(`데모 타임라인 ${patientId}의 계약이 올바르지 않습니다.`);
  }
  validatedTimelines[patientId] = timeline;
}

/** Validated, read-only-in-practice timeline fixtures used by the browser demo. */
export const DEMO_RECORD_TIMELINES: Readonly<Record<string, DemoRecordTimeline>> = validatedTimelines;

export const demoRecordTimelines = DEMO_RECORD_TIMELINES;

export function isDemoRecordTimeline(value: unknown): value is DemoRecordTimeline {
  return isDemoRecordTimelineValue(value);
}

export function getDemoTimeline(patientId: string): DemoRecordTimeline {
  const timeline = DEMO_RECORD_TIMELINES[patientId];
  if (!timeline) throw new Error(`데모 타임라인을 찾을 수 없습니다: ${patientId}`);
  return cloneTimeline(timeline);
}

export function listReturnStartOptions(patientId: string): string[] {
  return getDemoTimeline(patientId).snapshots.map((snapshot) => snapshot.updated_at);
}

export function listDemoTimelinePatientIds(): string[] {
  return Object.keys(DEMO_RECORD_TIMELINES);
}

