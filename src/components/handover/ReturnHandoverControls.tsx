"use client";

import type { KeyboardEvent } from "react";

import { formatTimestamp } from "./PatientContextHeader";

export type ReturnHandoverScope = "shift" | "return";

export type ReturnHandoverControlsProps = {
  scope: ReturnHandoverScope;
  reviewStartAt: string;
  availableStartTimes: readonly string[];
  onScopeChange: (scope: ReturnHandoverScope) => void;
  onStartAtChange: (value: string) => void;
  disabled?: boolean;
};

const SCOPE_TABS: readonly ReturnHandoverScope[] = ["shift", "return"];

function scopeTabId(scope: ReturnHandoverScope) {
  return `handover-scope-${scope}-tab`;
}

/** The scope selector is deliberately separate from the comparison/record tabs. */
export function ReturnHandoverControls({
  scope,
  reviewStartAt,
  availableStartTimes,
  onScopeChange,
  onStartAtChange,
  disabled = false,
}: ReturnHandoverControlsProps) {
  function handleScopeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = SCOPE_TABS.indexOf(scope);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % SCOPE_TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + SCOPE_TABS.length) % SCOPE_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = SCOPE_TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextScope = SCOPE_TABS[nextIndex];
    onScopeChange(nextScope);
    document.getElementById(scopeTabId(nextScope))?.focus();
  }

  return (
    <div className="return-handover-controls">
      <fieldset className="handover-scope-selector" role="tablist" aria-label="인수인계 범위" aria-orientation="horizontal">
        <legend>인수인계 범위</legend>
        <button
          id={scopeTabId("shift")}
          type="button"
          role="tab"
          aria-selected={scope === "shift"}
          aria-controls="comparison-panel"
          tabIndex={scope === "shift" ? 0 : -1}
          disabled={disabled}
          onClick={() => onScopeChange("shift")}
          onKeyDown={handleScopeKeyDown}
        >
          직전 교대
        </button>
        <button
          id={scopeTabId("return")}
          type="button"
          role="tab"
          aria-selected={scope === "return"}
          aria-controls="comparison-panel"
          tabIndex={scope === "return" ? 0 : -1}
          disabled={disabled}
          onClick={() => onScopeChange("return")}
          onKeyDown={handleScopeKeyDown}
        >
          휴무 복귀
        </button>
      </fieldset>

      {scope === "return" ? (
        <label className="return-start-selector">
          마지막 근무 시각
          <select
            aria-label="마지막 근무 시각"
            value={reviewStartAt}
            disabled={disabled || availableStartTimes.length === 0}
            onChange={(event) => onStartAtChange(event.target.value)}
          >
            {availableStartTimes.map((timestamp) => (
              <option key={timestamp} value={timestamp}>
                {formatTimestamp(timestamp)} · {timestamp}
              </option>
            ))}
            {availableStartTimes.length === 0 ? <option value="">사용 가능한 기록이 없습니다.</option> : null}
          </select>
          <span className="return-start-hint">실제 기록 기준 · {formatTimestamp(reviewStartAt)}</span>
        </label>
      ) : null}
    </div>
  );
}
