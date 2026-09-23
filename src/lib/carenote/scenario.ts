import { getDemoTimeline, listDemoTimelinePatientIds } from "../demo-timelines";
import { buildShiftReadinessRecords, getDemoShiftWindow } from "../demo-shift-readiness";
import type { CareDraft, CareEvidence, CareNote } from "./types";

export const CARE_SCENARIO_VERSION = "carenote-ward-2026-07-v1";
// These explicitly assigned stays belong to the handover fixtures, not the unrelated charting patients.
const ENCOUNTERS: Record<string, string> = {
  P001: "care-stay-001", P002: "care-stay-002", P003: "care-stay-003", P004: "care-stay-004", P005: "care-stay-005",
};

export function getCareScenario(id: string) {
  const timeline = getDemoTimeline(id);
  const records = buildShiftReadinessRecords(id, timeline.snapshots);
  const current = records[records.length - 1];
  return {
    version: CARE_SCENARIO_VERSION,
    patient: { id, encounterId: ENCOUNTERS[id], name: current.name, room: current.room_no, age: current.age, sex: current.sex, diagnoses: current.diagnosis },
    records,
    reviewStartAt: timeline.defaultReturnStartAt,
    coverageGaps: timeline.coverageGaps,
    shift: getDemoShiftWindow(id),
  };
}
export type CareScenario = ReturnType<typeof getCareScenario>;
export const CARE_PATIENTS = listDemoTimelinePatientIds().map(id => getCareScenario(id).patient);

export const VITAL_LABELS: Record<string, { label: string; unit: string }> = {
  systolic: {label:"수축기 혈압",unit:"mmHg"}, diastolic:{label:"이완기 혈압",unit:"mmHg"},
  heartrate:{label:"맥박",unit:"회/분"},respiratory:{label:"호흡",unit:"회/분"},
  saturation:{label:"산소포화도",unit:"%"},body_temperature:{label:"체온",unit:"°C"},
};

export function buildCareEvidence(scenario: CareScenario, notes: CareNote[]): CareEvidence[] {
  const {patient} = scenario;
  const current = scenario.records[scenario.records.length - 1];
  const context = {patientId:patient.id,encounterId:patient.encounterId,recordedAt:current.updated_at};
  const vitals = Object.entries(current.vitals).map(([key,value]) => `${VITAL_LABELS[key]?.label ?? key} ${value}${VITAL_LABELS[key]?.unit ?? ""}`).join(" · ");
  return [
    { ...context, id:`${patient.encounterId}:vitals`,label:"최근 활력징후",text:vitals,category:"V/S" as const },
    ...current.notes.map((text,index) => ({...context,id:`${patient.encounterId}:note:${index}`,label:"기존 간호메모",text,category:"일반" as const})),
    ...notes.filter(n => n.patientId === patient.id && n.encounterId === patient.encounterId).map(n => ({...context,id:n.id,recordedAt:n.recordedAt,label:"이번 세션 간호기록",text:n.narrative,category:n.category})),
  ];
}

export function initialCareDraft(scenario: CareScenario): CareDraft {
  return {text:"",category:"일반",recordedAt:new Date(Date.parse(scenario.records.at(-1)!.updated_at)+60_000).toISOString()};
}

export function formatCareTime(value: string, withDate = false): string {
  return new Intl.DateTimeFormat("ko-KR", {timeZone:"Asia/Seoul",...(withDate ? {month:"2-digit",day:"2-digit"} as const : {}),hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
}
