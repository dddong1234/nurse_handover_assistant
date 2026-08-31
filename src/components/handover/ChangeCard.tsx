import { useEffect, useRef } from "react";
import type { HandoverChange, HandoverChangeValue } from "@/lib/contracts";

import { formatTimestamp } from "./PatientContextHeader";

export type ChangeCardProps = {
  change: HandoverChange;
  isFocused?: boolean;
  focusRequestId?: number;
};

const CATEGORY_LABELS: Record<HandoverChange["category"], string> = {
  vitals: "활력징후",
  medications: "투약",
  diagnosis: "진단",
  notes: "간호 메모",
};

const PRIORITY_LABELS: Record<HandoverChange["reviewPriority"], string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

export function formatValue(value: HandoverChangeValue) {
  if (value === null) return "기록 없음";
  if (typeof value === "object") {
    return `${value.name} · ${value.route} · ${value.frequency}`;
  }
  return String(value);
}

function formatDelta(delta: number | null) {
  if (delta === null) return "값 변경";
  if (Object.is(delta, -0)) return "차이 0";
  const sign = delta > 0 ? "+" : "";
  return `차이 ${sign}${delta}`;
}

function changeTypeLabel(change: HandoverChange) {
  if (change.changeType === "added") return "추가";
  if (change.changeType === "removed") {
    return change.category === "medications" ? "중단" : "삭제";
  }
  return "변경";
}

function changeTypeIcon(change: HandoverChange) {
  if (change.changeType === "added") return "+";
  if (change.changeType === "removed") return "−";
  return "↔";
}

export function ChangeCard({ change, isFocused = false, focusRequestId = 0 }: ChangeCardProps) {
  const previousValue = formatValue(change.previousValue);
  const currentValue = formatValue(change.currentValue);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isFocused) return;

    cardRef.current?.focus();
  }, [isFocused, focusRequestId]);

  return (
    <article
      ref={cardRef}
      className={`change-card change-record-row priority-border-${change.reviewPriority} ${isFocused ? "is-evidence-focused" : ""}`.trim()}
      id={`evidence-${change.id}`}
      data-testid="change-card"
      data-review-priority={change.reviewPriority}
      tabIndex={isFocused ? -1 : undefined}
      aria-current={isFocused ? "true" : undefined}
      aria-labelledby={`change-title-${change.id}`}
    >
      <div className="change-card-header">
        <div className="change-labels">
          <span className="category-label">{CATEGORY_LABELS[change.category]}</span>
          <span className={`type-label type-${change.changeType}`}>
            <span aria-hidden="true">{changeTypeIcon(change)}</span>
            {changeTypeLabel(change)}
          </span>
          <span className={`priority-label priority-${change.reviewPriority}`}>
            검토 우선순위 {PRIORITY_LABELS[change.reviewPriority]}
          </span>
        </div>
        <span className="change-field mono" title={change.evidence.fieldPath}>
          {change.evidence.fieldPath}
        </span>
      </div>

      <h4 id={`change-title-${change.id}`}>{change.label}</h4>

      <div className="change-values" aria-label={`${change.label} 이전과 현재 값`}>
        <div className="value-column previous-value">
          <span className="value-label">이전 값</span>
          <strong className="value-text mono">{previousValue}</strong>
          <span className="value-time mono">{formatTimestamp(change.evidence.previousRecordedAt)}</span>
        </div>
        <div className="shift-seam" aria-label={`${changeTypeLabel(change)} 방향, 이전 기록과 현재 기록 사이의 변화`}>
          <span className="seam-mark" aria-hidden="true" />
          <span>{changeTypeLabel(change)}</span>
        </div>
        <div className="value-column current-value">
          <span className="value-label">현재 값</span>
          <strong className="value-text mono">{currentValue}</strong>
          <span className="value-time mono">{formatTimestamp(change.evidence.currentRecordedAt)}</span>
        </div>
      </div>

      <div className="change-card-footer">
        <span className={`delta-label delta-${change.delta === null ? "neutral" : change.delta > 0 ? "positive" : "negative"}`}>
          {formatDelta(change.delta)}
        </span>
        <span className="evidence-id mono">근거 ID · {change.id}</span>
        <details
          className="evidence-details"
          id={`evidence-details-${change.id}`}
          open={isFocused || undefined}
        >
          <summary>근거 상세</summary>
          <div className="evidence-detail-grid">
            <span>원본 필드</span><strong className="mono">{change.evidence.fieldPath}</strong>
            <span>이전 기록 시각</span><strong className="mono">{formatTimestamp(change.evidence.previousRecordedAt)}</strong>
            <span>현재 기록 시각</span><strong className="mono">{formatTimestamp(change.evidence.currentRecordedAt)}</strong>
            <span>근거 ID</span><strong className="mono">{change.id}</strong>
          </div>
        </details>
      </div>
    </article>
  );
}
