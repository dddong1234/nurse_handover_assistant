import { formatTimestamp } from "./PatientContextHeader";

export type ClinicalHeaderProps = {
  currentRecordedAt: string | null;
};

export function ClinicalHeader({ currentRecordedAt }: ClinicalHeaderProps) {
  return (
    <header className="clinical-header">
      <div className="clinical-header-brand">
        <span className="clinical-header-product">NURSE HANDOVER</span>
        <span className="clinical-header-divider" aria-hidden="true">·</span>
        <span className="clinical-header-mode">SHIFT REVIEW</span>
      </div>
      <span className="clinical-header-context">일반병동 · DAY 07:00–15:00</span>
      <div className="clinical-header-status">
        <span className="clinical-header-recorded-at mono">{formatTimestamp(currentRecordedAt)}</span>
        <span className="clinical-header-user">RN · 근무중</span>
      </div>
    </header>
  );
}
