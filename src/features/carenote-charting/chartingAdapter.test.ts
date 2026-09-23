import { describe, expect, it } from "vitest";
import { createChartingSuggestion } from "./chartingAdapter";
import type { CareEvidence } from "@/lib/carenote/types";

const patient = { id: "p1", encounterId: "e1", name: "합성 환자" };
const draft = { text: "잠 못잠", recordedAt: "2026-09-23T22:00:00+09:00", category: "PRN" as const };
const dose: CareEvidence = { id: "dose", patientId: "p1", encounterId: "e1",
  recordedAt: "2026-09-23T21:00:00+09:00", category: "PRN",
  label: "합성 투약", text: "Stilnox 10mg PO 투약함." };

describe("CareNote charting adapter", () => {
  it.each([
    ["잘잠", "S: 잘 잤음."],
    ["잠 못잠", "S: 잠을 이루기 어려움."],
    ["통증 3점", "S: 통증 정도 3점."],
    ["오심 없음", "S: 오심 없음."],
  ])("does not fill additional current facts from historical evidence for %s", (text, expected) => {
    for (const evidence of [[], [dose, { ...dose, id: "old-vs", category: "V/S" as const, text: "BP 110/70 mmHg" }]]) {
      const result = createChartingSuggestion({ patient, draft: { ...draft, text }, evidence });
      expect(result?.narrative).toBe(expected);
      expect(result?.sourceText).toBe(text);
    }
  });
  it.each([
    ["배액 30cc", "O: 배액량 30cc."],
    ["통증 3점", "S: 통증 정도 3점."],
    ["오심 없음", "S: 오심 없음."],
    ["잘잠", "S: 잘 잤음."],
    ["잠 못잠", "S: 잠을 이루기 어려움."],
    ["잠 안옴", "S: 잠을 이루기 어려움."],
    ["NRS 3점", "S: 통증 NRS 3점."],
  ])("phrases %s without inventing unprovided facts or demanding empty sections", (text, expected) => {
    const result = createChartingSuggestion({ patient, draft: { ...draft, text }, evidence: [] });
    expect(result?.narrative).toBe(expected);
    expect(result?.sourceText).toBe(text);
    expect(result?.narrative).not.toMatch(/호소|말함|관찰|확인함|계획|투약|직접 확인/);
  });
  it.each([
    "보행 3회 시행함", "복도 한바퀴", "통증 3점 아니고 7점", "통증 3점 아님",
    "호흡곤란 있음. 오심 없음", "잘잠. 통증 3점", "오심 없음\n호흡곤란 있음",
    "배액 30cc 아님", "배액 -30cc", "통증 3.5점", "잘잠은 아님",
  ])("preserves unsupported compound, negated or count-bearing input rather than partially replacing it: %s", (text) => {
    expect(createChartingSuggestion({ patient, draft: { ...draft, text }, evidence: [dose] })).toBeNull();
  });
  it("never links a future pain note as support for an earlier draft", () => {
    const result = createChartingSuggestion({ patient,
      draft: { ...draft, text: "통증 3점", recordedAt: "2026-09-23T10:00:00+09:00" },
      evidence: [{ ...dose, id: "future-pain", text: "통증 3점", recordedAt: "2026-09-23T11:00:00+09:00" }],
    });
    expect(result?.sourceEvidenceIds).toEqual([]);
  });
  it("does not use future conflict or medication evidence for review", () => {
    const result = createChartingSuggestion({ patient, draft, evidence: [
      { ...dose, recordedAt: "2026-09-23T22:01:00+09:00" },
      { ...dose, id: "future-sleep", text: "잘잠", recordedAt: "2026-09-23T22:02:00+09:00" },
    ] });
    expect(result?.reviewPrompts).toEqual([]);
    expect(result?.conflict).toBeUndefined();
  });
  it("does not let a future response suppress a current missing-response prompt", () => {
    const result = createChartingSuggestion({ patient, draft, evidence: [
      dose, { ...dose, id: "future-response", text: "투약 후 잘 잠.", recordedAt: "2026-09-23T23:00:00+09:00" },
    ] });
    expect(result?.reviewPrompts[0]?.evidenceIds).toEqual(["dose"]);
  });
  it("allows same-instant evidence using epoch time across timezone offsets", () => {
    const result = createChartingSuggestion({ patient, draft: { ...draft, text: "통증 3점" }, evidence: [
      { ...dose, id: "equal", text: "통증 3점", recordedAt: "2026-09-23T13:00:00Z" },
      { ...dose, id: "next-day", text: "통증 3점", recordedAt: "2026-09-24T00:00:00+09:00" },
    ] });
    expect(result?.sourceEvidenceIds).toEqual(["equal"]);
  });
  it("does not use undated or impossible-date evidence in a review prompt", () => {
    const result = createChartingSuggestion({ patient, draft, evidence: [
      { ...dose, recordedAt: "21:00" }, { ...dose, id: "impossible", recordedAt: "2026-02-30T21:00:00+09:00" },
    ] });
    expect(result?.reviewPrompts).toEqual([]);
  });
  it("does not suggest for a draft missing its explicit date and timezone", () => {
    expect(createChartingSuggestion({ patient, draft: { ...draft, recordedAt: "22:00" }, evidence: [dose] })).toBeNull();
  });
  it("excludes different patients and admissions from review and supporting evidence", () => {
    const result = createChartingSuggestion({ patient, draft, evidence: [
      { ...dose, patientId: "p2" }, { ...dose, encounterId: "e2", id: "other-stay" },
    ] });
    expect(result?.reviewPrompts).toEqual([]);
    expect(result?.sourceEvidenceIds).toEqual([]);
  });
  it.each(["호흡 불편 호소함", "진단 필요", "통증 100점", "복도 보행 예정", ""])(
    "does not recycle historical sleep facts for unsupported or unsafe input: %s", (text) => {
      expect(createChartingSuggestion({ patient, draft: { ...draft, text }, evidence: [dose] })).toBeNull();
    });
  it("keeps missing-response review separate from narrative and excludes the virtual draft evidence ID", () => {
    const result = createChartingSuggestion({ patient, draft, evidence: [dose] });
    expect(result?.reviewPrompts[0]?.evidenceIds).toEqual(["dose"]);
    expect(result?.narrative).not.toContain("찾지 못했습니다");
    expect(result?.sourceEvidenceIds).not.toContain("current-draft");
  });
  it("structures the current sleep fact without copying an unrelated historical narrative", () => {
    const result = createChartingSuggestion({
      patient: { id: "p1", encounterId: "e1", name: "합성 환자" },
      draft: { text: "잘잠", recordedAt: "2026-09-23T22:00:00+09:00", category: "PRN" },
      evidence: [],
    });
    expect(result?.narrative).toBe("S: 잘 잤음.");
    expect(result?.sourceEvidenceIds).toEqual([]);
  });
});
