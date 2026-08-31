import type {
  HandoverComparison,
  HandoverSummary,
  HandoverSummaryItem,
} from "@/lib/contracts";

export const RECOMMENDATION_PLACEHOLDER = "간호사가 확인할 후속 항목을 입력하세요.";

const SECTION_LABELS: Record<keyof HandoverSummary["sections"], string> = {
  situation: "Situation",
  background: "Background",
  assessment: "Assessment",
  recommendation: "Recommendation",
};

const SUMMARY_SECTION_KEYS: (keyof HandoverSummary["sections"])[] = [
  "situation",
  "background",
  "assessment",
  "recommendation",
];

const SUMMARY_WARNING_MESSAGES: Record<string, string> = {
  AI_KEY_UNAVAILABLE: "AI 연결 정보가 없어 규칙 요약을 표시합니다.",
  AI_FALLBACK_USED: "AI 요약을 사용할 수 없어 규칙 요약을 표시합니다.",
};
const DEFAULT_SUMMARY_WARNING = "일부 원본 항목을 확인해야 합니다.";

function readableSummaryWarnings(warnings: readonly string[]) {
  return [
    ...new Set(
      warnings.map((warning) =>
        Object.prototype.hasOwnProperty.call(SUMMARY_WARNING_MESSAGES, warning)
          ? SUMMARY_WARNING_MESSAGES[warning]
          : DEFAULT_SUMMARY_WARNING,
      ),
    ),
  ];
}

type EvidenceTogglePlan = Record<keyof HandoverSummary["sections"], boolean[][]>;

function createEvidenceTogglePlan(summary: HandoverSummary): EvidenceTogglePlan {
  const seenEvidenceIds = new Set<string>();
  const plan = {} as EvidenceTogglePlan;

  for (const section of SUMMARY_SECTION_KEYS) {
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

export type SummaryPanelProps = {
  comparison: HandoverComparison;
  summary: HandoverSummary;
  selectedEvidenceIds: string[];
  onToggleEvidence: (evidenceId: string) => void;
  onEvidenceActivate: (evidenceId: string) => void;
  recommendation: string;
  onRecommendationChange: (value: string) => void;
  sourceConfirmed: boolean;
  onSourceConfirmedChange: (confirmed: boolean) => void;
  reviewed: boolean;
  onReviewComplete: () => void;
  apiPending?: boolean;
  fallbackMessage?: string | null;
};

function cannotCompare(comparison: HandoverComparison) {
  return (
    comparison.status === "no_previous" ||
    (comparison.status === "partial" && comparison.changes.length === 0)
  );
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

function EvidenceLinks({
  evidenceIds,
  showToggleByIndex,
  selectedEvidenceIds,
  onToggleEvidence,
  onEvidenceActivate,
  controlsDisabled,
}: {
  evidenceIds: string[];
  showToggleByIndex: readonly boolean[];
  selectedEvidenceIds: Set<string>;
  onToggleEvidence: (evidenceId: string) => void;
  onEvidenceActivate: (evidenceId: string) => void;
  controlsDisabled: boolean;
}) {
  if (evidenceIds.length === 0) return null;

  return (
    <span className="evidence-links" aria-label="연결된 근거">
      {evidenceIds.map((evidenceId, evidenceIndex) => {
        const included = selectedEvidenceIds.has(evidenceId);
        const showToggle = showToggleByIndex[evidenceIndex] ?? false;
        const evidenceLabel = `근거 ${evidenceIndex + 1}`;

        return (
          <span className={`evidence-reference ${included ? "is-included" : "is-excluded"}`} key={`${evidenceId}-${evidenceIndex}`}>
            {showToggle ? (
              <button
                type="button"
                className="evidence-toggle"
                aria-label={`근거 ${evidenceId} ${included ? "포함됨" : "제외됨"}`}
                aria-pressed={included}
                disabled={controlsDisabled}
                onClick={() => onToggleEvidence(evidenceId)}
              >
                <span aria-hidden="true">{included ? "✓" : "○"}</span>
              </button>
            ) : null}
            <a
              className={`evidence-link mono ${included ? "is-included" : "is-excluded"}`}
              aria-label={`${evidenceLabel} · 원본 ID ${evidenceId}`}
              href={`#evidence-${evidenceId}`}
              title={evidenceId}
              onClick={(event) => {
                event.preventDefault();
                onEvidenceActivate(evidenceId);
              }}
            >
              {evidenceLabel}
            </a>
          </span>
        );
      })}
    </span>
  );
}

function EvidenceDisclosure({
  evidenceIds,
  showToggleByIndex,
  selectedEvidenceIds,
  onToggleEvidence,
  onEvidenceActivate,
  controlsDisabled,
}: {
  evidenceIds: string[];
  showToggleByIndex: readonly boolean[];
  selectedEvidenceIds: Set<string>;
  onToggleEvidence: (evidenceId: string) => void;
  onEvidenceActivate: (evidenceId: string) => void;
  controlsDisabled: boolean;
}) {
  if (evidenceIds.length === 0) return null;

  return (
    <details className="summary-evidence-disclosure">
      <summary role="button">{`근거 ${evidenceIds.length}건`}</summary>
      <EvidenceLinks
        evidenceIds={evidenceIds}
        showToggleByIndex={showToggleByIndex}
        selectedEvidenceIds={selectedEvidenceIds}
        onToggleEvidence={onToggleEvidence}
        onEvidenceActivate={onEvidenceActivate}
        controlsDisabled={controlsDisabled}
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
  recommendation,
  onRecommendationChange,
}: {
  section: keyof HandoverSummary["sections"];
  items: HandoverSummaryItem[];
  selectedEvidenceIds: Set<string>;
  evidenceTogglePlan: readonly boolean[][];
  onToggleEvidence: (evidenceId: string) => void;
  onEvidenceActivate: (evidenceId: string) => void;
  controlsDisabled: boolean;
  recommendation: string;
  onRecommendationChange: (value: string) => void;
}) {
  const isRecommendation = section === "recommendation";

  return (
    <section className={`summary-section summary-${section}`} aria-labelledby={`summary-${section}-title`}>
      <div className="summary-section-heading">
        <h3 id={`summary-${section}-title`}>{SECTION_LABELS[section]}</h3>
        <span className="summary-section-rule" aria-hidden="true" />
        <span className="mono summary-item-count">{items.length.toString().padStart(2, "0")}</span>
      </div>

      {isRecommendation ? (
        <>
          <p className="summary-empty recommendation-guidance">{RECOMMENDATION_PLACEHOLDER}</p>
          <textarea
            className="recommendation-input"
            value={recommendation}
            placeholder={RECOMMENDATION_PLACEHOLDER}
            aria-label="간호사가 확인할 후속 항목"
            rows={3}
            disabled={controlsDisabled}
            onChange={(event) => onRecommendationChange(event.target.value)}
          />
          <p className="control-note recommendation-note">자동 권고 없이 간호사가 직접 기록합니다.</p>
          {items.some((item) => item.evidenceIds.length > 0) ? (
            <div className="summary-list recommendation-evidence-list">
              {items.map((item, index) => (
                <div className="summary-item" key={`${section}-${item.text}-${index}`}>
                  <span className="summary-bullet" aria-hidden="true">□</span>
                  <div className="summary-item-copy">
                    <p>{item.text}</p>
                    <EvidenceDisclosure
                      evidenceIds={item.evidenceIds}
                      showToggleByIndex={evidenceTogglePlan[index] ?? []}
                      selectedEvidenceIds={selectedEvidenceIds}
                      onToggleEvidence={onToggleEvidence}
                      onEvidenceActivate={onEvidenceActivate}
                      controlsDisabled={controlsDisabled}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : items.length === 0 ? (
        <p className="summary-empty">해당 구간 변화 없음</p>
      ) : (
        <ul className="summary-list">
          {items.map((item, index) => (
            <li className="summary-item" key={`${section}-${item.text}-${index}`}>
              <span className="summary-bullet" aria-hidden="true">•</span>
              <div className="summary-item-copy">
                <p>{item.text}</p>
                <EvidenceDisclosure
                  evidenceIds={item.evidenceIds}
                  showToggleByIndex={evidenceTogglePlan[index] ?? []}
                  selectedEvidenceIds={selectedEvidenceIds}
                  onToggleEvidence={onToggleEvidence}
                  onEvidenceActivate={onEvidenceActivate}
                  controlsDisabled={controlsDisabled}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SummaryPanel({
  comparison,
  summary,
  selectedEvidenceIds,
  onToggleEvidence,
  onEvidenceActivate,
  recommendation,
  onRecommendationChange,
  sourceConfirmed,
  onSourceConfirmedChange,
  reviewed,
  onReviewComplete,
  apiPending = false,
  fallbackMessage,
}: SummaryPanelProps) {
  const changeIds = uniqueIds(comparison.changes.map((change) => change.id));
  const selectedEvidence = new Set(selectedEvidenceIds);
  const evidenceCount = changeIds.filter((changeId) => selectedEvidence.has(changeId)).length;
  const totalChanges = comparison.changes.length;
  const coverage = totalChanges ? Math.min(100, (evidenceCount / totalChanges) * 100) : 0;
  const evidenceTogglePlan = createEvidenceTogglePlan(summary);
  const readableWarnings = readableSummaryWarnings(summary.warnings);

  return (
    <aside className="summary-panel panel" data-testid="summary-panel" aria-labelledby="summary-title">
      <header className="section-header summary-header">
        <div>
          <p className="eyebrow">인계 검토 · SBAR</p>
          <h2 id="summary-title">인계 검토</h2>
        </div>
        <span className={`source-tag source-${summary.mode}`}>
          {summary.mode === "ai" ? "AI 요약" : "규칙 요약"}
        </span>
      </header>

      <p className="summary-rail-intro">근거 범위를 확인하고 SBAR 초안을 검토한 뒤 원본 기록 확인으로 마무리합니다.</p>

      {fallbackMessage ? (
        <div className="summary-warning fallback-warning" role="status">
          <strong>서버 연결</strong>
          <span>{fallbackMessage}</span>
        </div>
      ) : null}

      {apiPending ? (
        <div className="summary-warning summary-loading" role="status" aria-live="polite">
          <strong>서버 요약</strong>
          <span>서버 요약을 불러오는 중입니다.</span>
        </div>
      ) : null}

      <div className="summary-integrity" aria-label="근거 포함률">
        <div className="integrity-heading">
          <span>근거 포함률</span>
          <strong className="mono">{cannotCompare(comparison) ? "비교 불가" : `${evidenceCount}/${totalChanges}`}</strong>
        </div>
        <div className="integrity-track"><span style={{ width: `${coverage}%` }} /></div>
        <p>검출된 변화 요약은 원본 변화 ID에 연결됩니다.</p>
      </div>

      <div className="summary-body">
        <SummarySection
          section="situation"
          items={summary.sections.situation}
          selectedEvidenceIds={selectedEvidence}
          evidenceTogglePlan={evidenceTogglePlan.situation}
          onToggleEvidence={onToggleEvidence}
          onEvidenceActivate={onEvidenceActivate}
          controlsDisabled={reviewed || apiPending}
          recommendation={recommendation}
          onRecommendationChange={onRecommendationChange}
        />
        <SummarySection
          section="background"
          items={summary.sections.background}
          selectedEvidenceIds={selectedEvidence}
          evidenceTogglePlan={evidenceTogglePlan.background}
          onToggleEvidence={onToggleEvidence}
          onEvidenceActivate={onEvidenceActivate}
          controlsDisabled={reviewed || apiPending}
          recommendation={recommendation}
          onRecommendationChange={onRecommendationChange}
        />
        <SummarySection
          section="assessment"
          items={summary.sections.assessment}
          selectedEvidenceIds={selectedEvidence}
          evidenceTogglePlan={evidenceTogglePlan.assessment}
          onToggleEvidence={onToggleEvidence}
          onEvidenceActivate={onEvidenceActivate}
          controlsDisabled={reviewed || apiPending}
          recommendation={recommendation}
          onRecommendationChange={onRecommendationChange}
        />
        <SummarySection
          section="recommendation"
          items={summary.sections.recommendation}
          selectedEvidenceIds={selectedEvidence}
          evidenceTogglePlan={evidenceTogglePlan.recommendation}
          onToggleEvidence={onToggleEvidence}
          onEvidenceActivate={onEvidenceActivate}
          controlsDisabled={reviewed || apiPending}
          recommendation={recommendation}
          onRecommendationChange={onRecommendationChange}
        />
      </div>

      {readableWarnings.length > 0 ? (
        <div className="summary-warning" role="status">
          <strong>요약 주의</strong>
          <span>{readableWarnings.join(" ")}</span>
        </div>
      ) : null}

      <div className="review-footer">
        <label className={`review-check ${reviewed ? "is-reviewed" : ""}`}>
          <input
            type="checkbox"
            checked={sourceConfirmed}
            disabled={reviewed || apiPending}
            onChange={(event) => onSourceConfirmedChange(event.target.checked)}
          />
          <span className="custom-checkbox" aria-hidden="true">✓</span>
          <span>원본 기록을 확인했습니다</span>
        </label>
        <button
          type="button"
          className={`review-button ${reviewed ? "is-reviewed" : ""}`}
          disabled={!sourceConfirmed || reviewed || apiPending}
          onClick={onReviewComplete}
        >
          <span aria-hidden="true">{reviewed ? "✓" : "→"}</span>
          {reviewed ? "검토 완료" : "검토 완료"}
        </button>
      </div>
    </aside>
  );
}
