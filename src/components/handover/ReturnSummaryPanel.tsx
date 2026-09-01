import { useState } from "react";

import type { HandoverSummary, HandoverSummaryItem } from "@/lib/contracts";
import type { HandoverPeriodApiResponse, PeriodEvent } from "@/lib/handover-period-contracts";

export const RETURN_RECOMMENDATION_PLACEHOLDER = "간호사가 확인할 후속 항목을 입력하세요.";

type ReturnPanelStatus = "idle" | "loading" | "success" | "error";

export type ReturnSummaryPanelProps = {
  response: HandoverPeriodApiResponse | null;
  selectedEvidenceIds?: readonly string[];
  onToggleEvidence?: (eventId: string) => void;
  onEvidenceActivate: (eventId: string) => void;
  recommendation: string;
  onRecommendationChange: (value: string) => void;
  sourceConfirmed: boolean;
  onSourceConfirmedChange: (confirmed: boolean) => void;
  reviewed: boolean;
  onReviewComplete: () => void;
  status?: ReturnPanelStatus;
  errorMessage?: string | null;
  onRetry?: () => void;
};

const SECTION_LABELS: Record<keyof HandoverSummary["sections"], string> = {
  situation: "Situation",
  background: "Background",
  assessment: "Assessment",
  recommendation: "Recommendation",
};

const SECTION_KEYS: ReadonlyArray<keyof HandoverSummary["sections"]> = [
  "situation",
  "background",
  "assessment",
  "recommendation",
];

type EvidenceTogglePlan = Record<keyof HandoverSummary["sections"], boolean[][]>;

function createEvidenceTogglePlan(summary: HandoverSummary): EvidenceTogglePlan {
  const seenEvidenceIds = new Set<string>();
  const plan = {} as EvidenceTogglePlan;

  for (const section of SECTION_KEYS) {
    const sectionPlan: boolean[][] = [];
    for (const item of summary.sections[section]) {
      const itemPlan: boolean[] = [];
      for (const evidenceId of item.evidenceIds) {
        itemPlan.push(!seenEvidenceIds.has(evidenceId));
        seenEvidenceIds.add(evidenceId);
      }
      sectionPlan.push(itemPlan);
    }
    plan[section] = sectionPlan;
  }

  return plan;
}

const SUMMARY_WARNING_MESSAGES: Record<string, string> = {
  AI_KEY_UNAVAILABLE: "AI 연결 정보가 없어 규칙 요약을 표시합니다.",
  AI_FALLBACK_USED: "AI 요약을 사용할 수 없어 규칙 요약을 표시합니다.",
};

const DEFAULT_SUMMARY_WARNING = "추가 데이터 주의가 있습니다. 원본 기록을 확인하세요.";

function readableWarnings(warnings: readonly string[]): string[] {
  return [...new Set(warnings.map((warning) => SUMMARY_WARNING_MESSAGES[warning] ?? DEFAULT_SUMMARY_WARNING))];
}

function uniqueEventIds(events: readonly PeriodEvent[]): string[] {
  return [...new Set(events.map((event) => event.id))];
}

function EvidenceLinks({
  evidenceIds,
  contextLabel,
  showToggleByIndex,
  selectedEvidenceIds,
  onToggleEvidence,
  onEvidenceActivate,
  disabled,
  hidden = false,
}: {
  evidenceIds: readonly string[];
  contextLabel: string;
  showToggleByIndex: readonly boolean[];
  selectedEvidenceIds: ReadonlySet<string>;
  onToggleEvidence?: (eventId: string) => void;
  onEvidenceActivate: (eventId: string) => void;
  disabled: boolean;
  hidden?: boolean;
}) {
  if (!evidenceIds.length) return null;
  return (
    <div className="return-summary-evidence-links" aria-label="연결된 기간 사건" hidden={hidden}>
      {evidenceIds.map((eventId, index) => {
        const included = selectedEvidenceIds.has(eventId);
        const showToggle = showToggleByIndex[index] ?? false;
        return (
          <span className={`return-summary-evidence ${included ? "is-included" : "is-excluded"}`} key={`${eventId}-${index}`}>
            {onToggleEvidence && showToggle ? (
              <button
                type="button"
                className="return-summary-evidence-toggle"
                aria-label={`${contextLabel} · 근거 ${index + 1} ${included ? "포함됨" : "제외됨"}`}
                aria-pressed={included}
                disabled={disabled}
                onClick={() => onToggleEvidence(eventId)}
              >
                {included ? "✓" : "○"}
              </button>
            ) : null}
            <button
              type="button"
              className="return-summary-evidence-link mono"
              disabled={disabled && !included}
              onClick={() => onEvidenceActivate(eventId)}
            >
              근거 {index + 1}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function EvidenceDisclosure({
  evidenceIds,
  contextLabel,
  showToggleByIndex,
  selectedEvidenceIds,
  onToggleEvidence,
  onEvidenceActivate,
  disabled,
}: {
  evidenceIds: readonly string[];
  contextLabel: string;
  showToggleByIndex: readonly boolean[];
  selectedEvidenceIds: ReadonlySet<string>;
  onToggleEvidence?: (eventId: string) => void;
  onEvidenceActivate: (eventId: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!evidenceIds.length) return null;

  return (
    <details className="return-summary-evidence-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary role="button">{`근거 ${evidenceIds.length}건`}</summary>
      <EvidenceLinks
        evidenceIds={evidenceIds}
        contextLabel={contextLabel}
        showToggleByIndex={showToggleByIndex}
        selectedEvidenceIds={selectedEvidenceIds}
        onToggleEvidence={onToggleEvidence}
        onEvidenceActivate={onEvidenceActivate}
        disabled={disabled}
        hidden={!open}
      />
    </details>
  );
}

function SummarySection({
  section,
  items,
  selectedEvidenceIds,
  evidenceTogglePlan,
  onToggleEvidence,
  onEvidenceActivate,
  controlsDisabled,
}: {
  section: keyof HandoverSummary["sections"];
  items: HandoverSummaryItem[];
  selectedEvidenceIds: ReadonlySet<string>;
  evidenceTogglePlan: readonly boolean[][];
  onToggleEvidence?: (eventId: string) => void;
  onEvidenceActivate: (eventId: string) => void;
  controlsDisabled: boolean;
}) {
  const recommendation = section === "recommendation";
  return (
    <section
      className={`return-summary-section return-summary-block return-summary-block-${section} return-summary-${section}`}
      data-summary-section={section}
      data-testid={section === "situation" ? "return-period-response" : undefined}
      aria-labelledby={`return-summary-section-${section}`}
    >
      <header className="return-summary-section-heading">
        <h3 id={`return-summary-section-${section}`}>{SECTION_LABELS[section]}</h3>
        <span className="return-summary-section-rule" aria-hidden="true" />
        <span className="mono return-summary-item-count">{items.length.toString().padStart(2, "0")}</span>
      </header>
      {recommendation ? (
        items.length ? (
          <ul className="return-summary-items">
            {items.map((item, index) => (
              <SummaryItem
                key={`${section}-${item.text}-${index}`}
                item={item}
                contextLabel={`${SECTION_LABELS[section]} ${index + 1}`}
                evidenceTogglePlan={evidenceTogglePlan[index] ?? []}
                selectedEvidenceIds={selectedEvidenceIds}
                onToggleEvidence={onToggleEvidence}
                onEvidenceActivate={onEvidenceActivate}
                controlsDisabled={controlsDisabled}
              />
            ))}
          </ul>
        ) : <p className="return-summary-empty">간호사가 확인할 후속 항목을 입력하세요.</p>
      ) : items.length ? (
        <ul className="return-summary-items">
          {items.map((item, index) => (
            <SummaryItem
              key={`${section}-${item.text}-${index}`}
              item={item}
              contextLabel={`${SECTION_LABELS[section]} ${index + 1}`}
              evidenceTogglePlan={evidenceTogglePlan[index] ?? []}
              selectedEvidenceIds={selectedEvidenceIds}
              onToggleEvidence={onToggleEvidence}
              onEvidenceActivate={onEvidenceActivate}
              controlsDisabled={controlsDisabled}
            />
          ))}
        </ul>
      ) : <p className="return-summary-empty">해당 구간 변화 없음</p>}
    </section>
  );
}

function SummaryItem({
  item,
  contextLabel,
  evidenceTogglePlan,
  selectedEvidenceIds,
  onToggleEvidence,
  onEvidenceActivate,
  controlsDisabled,
}: {
  item: HandoverSummaryItem;
  contextLabel: string;
  evidenceTogglePlan: readonly boolean[];
  selectedEvidenceIds: ReadonlySet<string>;
  onToggleEvidence?: (eventId: string) => void;
  onEvidenceActivate: (eventId: string) => void;
  controlsDisabled: boolean;
}) {
  return (
    <li className="return-summary-item">
      <span className="return-summary-bullet" aria-hidden="true">•</span>
      <div>
        <p>{item.text}</p>
        <EvidenceDisclosure
          evidenceIds={item.evidenceIds}
          contextLabel={contextLabel}
          showToggleByIndex={evidenceTogglePlan}
          selectedEvidenceIds={selectedEvidenceIds}
          onToggleEvidence={onToggleEvidence}
          onEvidenceActivate={onEvidenceActivate}
          disabled={controlsDisabled}
        />
      </div>
    </li>
  );
}

function PeriodStateMessage({ status }: { status: HandoverPeriodApiResponse["period"]["status"] | null }) {
  if (status === "no_baseline") return <p className="return-summary-state">기준 기록 없음</p>;
  if (status === "no_events") return <p className="return-summary-state">해당 기간에 검출된 변화가 없습니다.</p>;
  if (status === "partial") return <p className="return-summary-state">부분 결과</p>;
  return null;
}

export function ReturnSummaryPanel({
  response,
  selectedEvidenceIds = [],
  onToggleEvidence,
  onEvidenceActivate,
  recommendation,
  onRecommendationChange,
  sourceConfirmed,
  onSourceConfirmedChange,
  reviewed,
  onReviewComplete,
  status = response ? "success" : "idle",
  errorMessage = null,
  onRetry,
}: ReturnSummaryPanelProps) {
  const events = response?.events ?? [];
  const eventIds = new Set(events.map((event) => event.id));
  const selectedIds = new Set(selectedEvidenceIds.filter((eventId) => eventIds.has(eventId)));
  const currentCount = response?.reviewGroups.current.reduce((total, item) => total + item.eventIds.length, 0) ?? 0;
  const periodOnlyCount = response?.reviewGroups.periodOnly.reduce((total, item) => total + item.eventIds.length, 0) ?? 0;
  const total = response?.period.eventCount ?? events.length;
  const coverageCount = selectedIds.size;
  const canMutate = Boolean(response) && status !== "loading" && !reviewed;
  const warningMessages = response ? readableWarnings([...response.dataWarnings, ...response.summary.warnings]) : [];
  const summary = response?.summary;
  const evidenceTogglePlan = summary ? createEvidenceTogglePlan(summary) : null;

  return (
    <aside
      className="summary-panel panel return-handover-summary"
      data-testid="return-summary-panel"
      aria-labelledby="return-summary-title"
      aria-busy={status === "loading"}
    >
      <header className="section-header summary-header return-summary-header">
        <div>
          <p className="eyebrow">복귀 인계 · PERIOD REVIEW</p>
          <h2 id="return-summary-title">복귀 인계 검토</h2>
        </div>
        {summary ? <span className="source-tag">{summary.mode === "ai" ? "AI 요약" : "규칙 요약"}</span> : null}
      </header>

      <p className="summary-rail-intro">기간 사건의 원본 근거를 확인하고 SBAR 초안을 검토한 뒤 확인을 완료합니다.</p>

      {status === "loading" ? (
        <div className="summary-warning summary-loading">
          <strong>기간 비교</strong>
          <span>{response ? "새 기간 결과를 불러오는 중입니다. 현재 결과를 유지합니다." : "기간 비교를 불러오는 중입니다."}</span>
        </div>
      ) : null}
      {status === "error" || errorMessage ? (
        <div className="summary-warning return-summary-error">
          <strong>기간 비교</strong>
          <span>{errorMessage ?? "기간 비교를 불러오지 못했습니다."}</span>
          {onRetry ? <button type="button" onClick={onRetry}>다시 시도</button> : null}
        </div>
      ) : null}

      <div className="return-summary-metrics" aria-label="기간 사건 집계">
        <div className="return-summary-metric">
          <span>기간 사건 총수</span>
          <strong className="mono return-summary-metric-value">{total}건</strong>
        </div>
        <div className="return-summary-metric">
          <span>현재 확인</span>
          <strong className="mono return-summary-metric-value">{currentCount}건</strong>
        </div>
        <div className="return-summary-metric">
          <span>기간 중 변경</span>
          <strong className="mono return-summary-metric-value">{periodOnlyCount}건</strong>
        </div>
        <div className="return-summary-metric return-summary-metric-wide">
          <span>근거 포함률</span>
          <strong className="mono return-summary-metric-value">{coverageCount}/{total}</strong>
        </div>
      </div>

      <div className="return-summary-integrity" aria-label="근거 포함률">
        <div className="integrity-track"><span style={{ width: `${total ? Math.min(100, (coverageCount / total) * 100) : 0}%` }} /></div>
        <p>기간 사건 {uniqueEventIds(events).length}건은 원본 snapshot 구간과 연결됩니다.</p>
      </div>

      {!response ? (
        <div className="return-summary-empty-state">
          {status === "loading" ? "기간 비교를 불러오는 중입니다." : errorMessage ?? "기간 비교를 준비 중입니다."}
          {status === "error" && onRetry ? <button type="button" onClick={onRetry}>다시 시도</button> : null}
        </div>
      ) : (
        <>
          <PeriodStateMessage status={response.period.status} />
          <div className="return-summary-body">
            {summary ? SECTION_KEYS.map((section) => (
              <SummarySection
                key={section}
                section={section}
                items={summary.sections[section]}
                selectedEvidenceIds={selectedIds}
                evidenceTogglePlan={evidenceTogglePlan?.[section] ?? []}
                onToggleEvidence={onToggleEvidence}
                onEvidenceActivate={onEvidenceActivate}
                controlsDisabled={!canMutate}
              />
            )) : null}
          </div>
        </>
      )}

      <section className="return-summary-recommendation-control" aria-labelledby="return-recommendation-input-title">
        <label id="return-recommendation-input-title" htmlFor="return-recommendation-input">간호사가 확인할 후속 항목</label>
        <textarea
          id="return-recommendation-input"
          aria-label="간호사가 확인할 후속 항목"
          rows={3}
          placeholder={RETURN_RECOMMENDATION_PLACEHOLDER}
          value={recommendation}
          disabled={!canMutate}
          onChange={(event) => onRecommendationChange(event.target.value)}
        />
        <p className="control-note">자동 권고 없이 간호사가 직접 기록합니다.</p>
      </section>

      {warningMessages.length ? (
        <div className="summary-warning return-summary-warnings">
          <strong>데이터 주의</strong>
          <span>{warningMessages.join(" ")}</span>
        </div>
      ) : null}

      <div className="review-footer return-review-footer">
        <label className={`review-check ${reviewed ? "is-reviewed" : ""}`}>
          <input
            type="checkbox"
            checked={sourceConfirmed}
            disabled={!canMutate}
            onChange={(event) => onSourceConfirmedChange(event.target.checked)}
          />
          <span className="custom-checkbox" aria-hidden="true">✓</span>
          <span>원본 기록을 확인했습니다</span>
        </label>
        <button
          type="button"
          className={`review-button ${reviewed ? "is-reviewed" : ""}`}
          disabled={!canMutate || !sourceConfirmed}
          onClick={onReviewComplete}
        >
          {reviewed ? "검토 완료" : "검토 완료"}
        </button>
      </div>
    </aside>
  );
}
