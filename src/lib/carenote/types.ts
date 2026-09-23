export type CareCategory = "V/S" | "PRN" | "일반";

export type CareEvidence = {
  id: string;
  patientId: string;
  encounterId: string;
  recordedAt: string;
  label: string;
  text: string;
  category: CareCategory;
};

export type CareNote = {
  id: string;
  patientId: string;
  encounterId: string;
  recordedAt: string;
  category: CareCategory;
  narrative: string;
  sourceEvidenceIds: string[];
  signatureState: "signed-fixture" | "unsigned-demo";
  revision: number;
};

export type CareDraft = { text: string; recordedAt: string; category: CareCategory };
export type CareNoteInput = Pick<CareNote, "narrative" | "recordedAt" | "category" | "sourceEvidenceIds">;

export type ChartingPanelProps = {
  patient: { id: string; encounterId: string; name: string };
  evidence: CareEvidence[];
  notes: CareNote[];
  draft: CareDraft;
  onDraftChange: (draft: CareDraft) => void;
  onAddNote: (input: CareNoteInput) => void;
  onOpenEvidence: (id: string) => void;
};
