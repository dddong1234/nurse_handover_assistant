import { formatTimestamp } from "./PatientContextHeader";
import styles from "./OnboardingTour.module.css";

export type ClinicalHeaderProps = {
  currentRecordedAt: string | null;
  onOpenGuide?: () => void;
};

export function ClinicalHeader({ currentRecordedAt, onOpenGuide }: ClinicalHeaderProps) {
  return (
    <header className="clinical-header" aria-label="임상 작업 컨텍스트">
      <div className="clinical-header-brand">
        <span className="clinical-header-product">NURSE HANDOVER</span>
        <span className="clinical-header-divider" aria-hidden="true">·</span>
        <span className="clinical-header-mode">SHIFT REVIEW</span>
      </div>
      <span className="clinical-header-context">
        <span>일반병동 · DAY 07:00–15:00</span>
        {onOpenGuide ? (
          <button
            type="button"
            className={styles.headerGuide}
            data-tour-replay="true"
            onClick={onOpenGuide}
          >
            화면 안내
          </button>
        ) : null}
      </span>
      <div className="clinical-header-status">
        <span className="clinical-header-recorded-at mono">{formatTimestamp(currentRecordedAt)}</span>
        <span className="clinical-header-user">RN · 근무중</span>
      </div>
    </header>
  );
}
