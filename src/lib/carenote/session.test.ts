import { describe, expect, it } from "vitest";
import { getCareScenario, buildCareEvidence } from "./scenario";
import { appendSessionNote, projectSessionRecords } from "./session";

const input = { narrative: "S: 통증 3점 호소함.\nO: 통증 NRS 3점 확인함.\nA: 통증 상태 기록함.\nP: 관찰 내용 기록함.", recordedAt: "2026-07-02T10:00:00+09:00", category: "일반" as const, sourceEvidenceIds: [] };

describe("CareNote session boundary", () => {
  it("projects an explicitly added note without changing vitals, orders or original records", () => {
    const scenario = getCareScenario("P004");
    const original = structuredClone(scenario.records);
    const notes = appendSessionNote(scenario, [], input);
    const records = projectSessionRecords(scenario, notes);
    expect(notes[0].signatureState).toBe("unsigned-demo");
    expect(notes[0].patientId).toBe("P004");
    expect(records.at(-1)?.notes).toContain(input.narrative);
    expect(records.at(-1)?.updated_at).toBe("2026-07-02T10:00:00+09:00");
    expect(records.at(-1)?.vitals).toEqual(original.at(-1)?.vitals);
    expect(records.at(-1)?.medications).toEqual(original.at(-1)?.medications);
    expect(scenario.records).toEqual(original);
  });
  it("rejects notes or evidence belonging to another patient or encounter", () => {
    const a = getCareScenario("P004");
    const b = getCareScenario("P001");
    const notes = appendSessionNote(a, [], input);
    expect(() => projectSessionRecords(b, notes)).toThrow();
    expect(() => appendSessionNote(a, [], {...input,sourceEvidenceIds:[buildCareEvidence(b, [])[0].id]})).toThrow();
    expect(() => projectSessionRecords(a, [{...notes[0],encounterId:"another-stay"}])).toThrow();
  });
  it("rejects unknown dates, backdating, and times beyond this shift", () => {
    const scenario = getCareScenario("P004");
    for (const recordedAt of ["10:00", "2026-07-01T10:00:00+09:00", "2026-07-02T23:00:00+09:00", "2026-02-30T10:00:00+09:00"]) {
      expect(() => appendSessionNote(scenario, [], {...input,recordedAt})).toThrow();
    }
  });
  it("groups notes at the same timestamp into one later snapshot", () => {
    const scenario = getCareScenario("P004");
    const notes = appendSessionNote(scenario, appendSessionNote(scenario, [], input), {...input,narrative:"S: 오심 없음.\nO: 오심 호소 없음.\nA: 상태 기록함.\nP: 관찰함."});
    const records = projectSessionRecords(scenario, notes);
    expect(records.length).toBe(scenario.records.length + 1);
    expect(records.at(-1)?.notes.slice(-2)).toEqual([input.narrative,notes[1].narrative]);
    expect(notes[0].id).not.toBe(notes[1].id);
  });
  it("rejects future provenance while allowing an independent earlier observation", () => {
    const scenario = getCareScenario("P004");
    const later = appendSessionNote(scenario, [], { ...input, recordedAt: "2026-07-02T11:00:00+09:00" });
    expect(() => appendSessionNote(scenario, later, { ...input, sourceEvidenceIds: [later[0].id] })).toThrow(/근거.*시각/);
    expect(appendSessionNote(scenario, later, input)).toHaveLength(2);
  });
  it("keeps dated evidence tied to its patient and maps every note source", () => {
    const scenario = getCareScenario("P004");
    const evidence = buildCareEvidence(scenario, []);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every(e => e.patientId === "P004" && e.encounterId === scenario.patient.encounterId && e.recordedAt.includes("T"))).toBe(true);
    const notes = appendSessionNote(scenario, [], {...input,sourceEvidenceIds:[evidence[0].id]});
    expect(notes[0].sourceEvidenceIds).toEqual([evidence[0].id]);
    expect(buildCareEvidence(scenario, notes).find(e => e.id === notes[0].id)?.text).toBe(input.narrative);
  });
});
