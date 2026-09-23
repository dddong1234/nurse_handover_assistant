import type { ChartingPanelProps } from "@/lib/carenote/types";
import { analyzeLocalNurseFacts, CURRENT_DRAFT_EVIDENCE_ID } from "./legacy/localFactInterpreter";
import { isZonedIso } from "./time";

// Match the entire supplied observation, not a recognized substring inside a larger note.
// Phrase only that fact; never infer its reporter, performed care, assessment or plan.
function phraseSuppliedFact(value: string): { section: "S" | "O"; sentence: string } | null {
  const text = value.trim();
  if (/[\r\n]/.test(text)) return null;
  if (/^잘\s*(?:잠|잤음)\.?$/.test(text)) return { section: "S", sentence: "잘 잤음." };
  if (/^잠\s*(?:못\s*잠|안\s*옴)\.?$/.test(text)) return { section: "S", sentence: "잠을 이루기 어려움." };
  if (/^오심\s*없음\.?$/.test(text)) return { section: "S", sentence: "오심 없음." };
  const pain = /^(통증|NRS)\s*([0-9]|10)\s*점\.?$/i.exec(text);
  if (pain) return { section: "S", sentence: pain[1].toUpperCase() === "NRS"
    ? `통증 NRS ${pain[2]}점.` : `통증 정도 ${pain[2]}점.` };
  const drain = /^배액(?:량)?\s*(\d+(?:\.\d+)?)\s*(cc|mL)\.?$/i.exec(text);
  if (drain) return { section: "O", sentence: `배액량 ${drain[1]}${drain[2]}.` };
  return null;
}

export function createChartingSuggestion(input: Pick<ChartingPanelProps, "patient" | "draft" | "evidence">) {
  if (!isZonedIso(input.draft.recordedAt)) return null;
  const fact = phraseSuppliedFact(input.draft.text);
  if (!fact) return null;
  const draftTime = Date.parse(input.draft.recordedAt);
  const evidence = input.evidence
    .filter((item) => item.patientId === input.patient.id && item.encounterId === input.patient.encounterId
      && isZonedIso(item.recordedAt) && Date.parse(item.recordedAt) <= draftTime)
    .map((item) => ({
      id: item.id, timestamp: item.recordedAt, category: item.category,
      label: item.label, detail: item.text, subjective: "",
    }));
  const request = { draftText: input.draft.text, category: input.draft.category, evidence };
  const analysis = analyzeLocalNurseFacts(request);
  if (analysis.status !== "recognized") return null;
  const simpleEvidenceIds = new Set(evidence.filter((item) => phraseSuppliedFact(item.detail)).map((item) => item.id));
  const conflictIds = analysis.interpretation.conflict?.evidenceIds.filter((id) => simpleEvidenceIds.has(id)) ?? [];
  return {
    narrative: fact.section + ": " + fact.sentence,
    sourceText: input.draft.text,
    sourceEvidenceIds: analysis.interpretation.evidenceIds
      .filter((id) => id !== CURRENT_DRAFT_EVIDENCE_ID && simpleEvidenceIds.has(id)),
    reviewPrompts: analysis.interpretation.reviewPrompts ?? [],
    conflict: conflictIds.length && analysis.interpretation.conflict
      ? { ...analysis.interpretation.conflict, evidenceIds: conflictIds } : undefined,
  };
}
