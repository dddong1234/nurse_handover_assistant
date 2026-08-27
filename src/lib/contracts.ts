export type HandoverStatus = "ready" | "no_previous" | "no_changes" | "partial";

export type HandoverChangeCategory =
  | "vitals"
  | "medications"
  | "diagnosis"
  | "notes";

export type HandoverChangeType = "added" | "removed" | "modified";

export type HandoverReviewPriority = "high" | "medium" | "low";

export type HandoverMedicationValue = {
  name: string;
  route: string;
  frequency: string;
};

export type HandoverChangeValue = string | number | HandoverMedicationValue | null;

export type HandoverPatient = {
  id: string;
  name: string;
  room: string;
  age: number | null;
  sex: string;
  diagnoses: string[];
};

export type HandoverInterval = {
  previousRecordedAt: string | null;
  currentRecordedAt: string | null;
};

export type HandoverEvidence = {
  fieldPath: string;
  previousRecordedAt: string | null;
  currentRecordedAt: string | null;
};

export type HandoverChange = {
  id: string;
  category: HandoverChangeCategory;
  changeType: HandoverChangeType;
  reviewPriority: HandoverReviewPriority;
  label: string;
  previousValue: HandoverChangeValue;
  currentValue: HandoverChangeValue;
  delta: number | null;
  evidence: HandoverEvidence;
};

export type HandoverComparison = {
  patient: HandoverPatient;
  interval: HandoverInterval;
  status: HandoverStatus;
  dataWarnings: string[];
  changes: HandoverChange[];
};

export type HandoverSummaryItem = {
  text: string;
  evidenceIds: string[];
};

export type HandoverSummarySections = {
  situation: HandoverSummaryItem[];
  background: HandoverSummaryItem[];
  assessment: HandoverSummaryItem[];
  recommendation: HandoverSummaryItem[];
};

export type HandoverSummary = {
  mode: "deterministic" | "ai";
  sections: HandoverSummarySections;
  evidenceIds: string[];
  warnings: string[];
};

export type HandoverApiResponse = {
  comparison: HandoverComparison;
  summary: HandoverSummary;
};
