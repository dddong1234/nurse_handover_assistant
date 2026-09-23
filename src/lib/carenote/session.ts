import type { CareNote, CareNoteInput } from "./types";
import { buildCareEvidence, type CareScenario } from "./scenario";

function timestamp(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const parsed = Date.parse(value);
  if (!match || !Number.isFinite(parsed) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0,10) !== match[1]) {
    throw new Error("날짜와 시간대를 포함한 올바른 기록 시각을 입력해 주세요.");
  }
  return parsed;
}

function validateNotes(scenario: CareScenario, notes: CareNote[]) {
  for (const note of notes) {
    if (note.patientId !== scenario.patient.id || note.encounterId !== scenario.patient.encounterId) throw new Error("선택 환자의 입원 기록과 일치하지 않습니다.");
    const at = timestamp(note.recordedAt);
    if (at <= Date.parse(scenario.records.at(-1)!.updated_at) || at > Date.parse(scenario.shift.endsAt)) throw new Error("최근 원본 기록 이후부터 이번 근무 종료 시각까지 입력해 주세요.");
  }
}

export function appendSessionNote(scenario: CareScenario, notes: CareNote[], input: CareNoteInput): CareNote[] {
  validateNotes(scenario, notes);
  if (!input.narrative.trim() || input.narrative.length > 10_000) throw new Error("간호기록은 1~10,000자로 입력해 주세요.");
  if (notes.length >= 100) throw new Error("이번 데모 세션의 기록 한도에 도달했습니다.");
  if (!["일반","V/S","PRN"].includes(input.category)) throw new Error("기록 분류를 선택해 주세요.");
  const inputAt = timestamp(input.recordedAt);
  const available = new Map(buildCareEvidence(scenario, notes).map(e => [e.id, e]));
  if (input.sourceEvidenceIds.some(id => !available.has(id))) throw new Error("선택 환자의 근거만 연결할 수 있습니다.");
  if (input.sourceEvidenceIds.some(id => timestamp(available.get(id)!.recordedAt) > inputAt)) throw new Error("근거의 시각은 작성 기록보다 나중일 수 없습니다.");
  const revision = notes.length + 1;
  const note: CareNote = {...input,narrative:input.narrative.trim(),sourceEvidenceIds:[...new Set(input.sourceEvidenceIds)],id:`${scenario.patient.encounterId}:session:${revision}`,patientId:scenario.patient.id,encounterId:scenario.patient.encounterId,signatureState:"unsigned-demo",revision};
  validateNotes(scenario, [note]);
  return [...notes,note];
}

export function projectSessionRecords(scenario: CareScenario, notes: CareNote[]) {
  validateNotes(scenario, notes);
  const records = structuredClone(scenario.records);
  const sorted = [...notes].sort((a,b) => timestamp(a.recordedAt)-timestamp(b.recordedAt) || a.revision-b.revision);
  for (const note of sorted) {
    const last = records[records.length-1];
    if (timestamp(last.updated_at) === timestamp(note.recordedAt)) {
      last.notes.push(note.narrative);
    } else {
      records.push({...structuredClone(last),updated_at:note.recordedAt,notes:[...last.notes,note.narrative]});
    }
  }
  return records;
}
