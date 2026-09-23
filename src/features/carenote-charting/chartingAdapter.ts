import type { ChartingPanelProps } from "@/lib/carenote/types";
import { analyzeLocalNurseFacts, CURRENT_DRAFT_EVIDENCE_ID } from "./legacy/localFactInterpreter";
import { isZonedIso } from "./time";

export const MISSING_FACT_PLACEHOLDER = "[직접 확인·작성 필요]";

// Match the entire supplied observation, not a recognized substring inside a larger note.
// Preserve its wording; do not infer who reported/observed it or any completed assessment/plan.
function suppliedSection(value: string): "S" | "O" | null {
  const text = value.trim();
  if (/[\r\n]/.test(text)) return null;
  if (/^(?:잘\s*잠|잘\s*잤음|잠\s*못\s*잠|잠\s*안\s*옴|오심\s*없음|(?:통증|NRS)\s*(?:[0-9]|10)\s*점)\.?$/i.test(text)) return "S";
  if (/^배액(?:량)?\s*\d+(?:\.\d+)?\s*(?:cc|mL)\.?$/i.test(text)) return "O";
  return null;
}

export function createChartingSuggestion(input: Pick<ChartingPanelProps, "patient" | "draft" | "evidence">) {
  if (!isZonedIso(input.draft.recordedAt)) return null;
  const section = suppliedSection(input.draft.text);
  if (!section) return null;
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
  const simpleEvidenceIds = new Set(evidence.filter((item) => suppliedSection(item.detail)).map((item) => item.id));
  const conflictIds = analysis.interpretation.conflict?.evidenceIds.filter((id) => simpleEvidenceIds.has(id)) ?? [];
  return {
    narrative: (["S", "O", "A", "P"] as const)
      .map((label) => label + ": " + (label === section ? input.draft.text.trim() : MISSING_FACT_PLACEHOLDER))
      .join("\n"),
    sourceEvidenceIds: analysis.interpretation.evidenceIds
      .filter((id) => id !== CURRENT_DRAFT_EVIDENCE_ID && simpleEvidenceIds.has(id)),
    reviewPrompts: analysis.interpretation.reviewPrompts ?? [],
    conflict: conflictIds.length && analysis.interpretation.conflict
      ? { ...analysis.interpretation.conflict, evidenceIds: conflictIds } : undefined,
  };
}
