import type {
  HandoverApiResponse,
  HandoverChange,
  HandoverChangeValue,
  HandoverComparison,
  HandoverSummary,
  HandoverSummaryItem,
} from "@/lib/contracts";

type HandoverWorkspaceProps = {
  data: HandoverApiResponse[];
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

const SECTION_LABELS: Record<keyof HandoverSummary["sections"], string> = {
  situation: "Situation",
  background: "Background",
  assessment: "Assessment",
  recommendation: "Recommendation",
};

const RECOMMENDATION_PLACEHOLDER = "간호사가 확인할 후속 항목을 입력하세요.";

function formatSex(sex: string) {
  if (sex === "M") return "남(M)";
  if (sex === "F") return "여(F)";
  return sex || "성별 정보 없음";
}

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) return "기록 없음";
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return timestamp;
  return `${match[2]}/${match[3]} ${match[4]}:${match[5]}`;
}

function formatValue(value: HandoverChangeValue) {
  if (value === null) return "기록 없음";
  if (typeof value === "object") {
    return `${value.route} · ${value.frequency}`;
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

function statusLabel(comparison: HandoverComparison) {
  if (comparison.status === "no_previous") return "비교 없음";
  if (comparison.status === "no_changes") return "변화 없음";
  if (comparison.status === "partial") return "데이터 부족";
  return "검토 필요";
}

function queueStatusLabel(comparison: HandoverComparison) {
  if (comparison.status === "ready") return "미검토";
  if (comparison.status === "no_changes") return "변화 없음";
  if (comparison.status === "no_previous") return "비교 없음";
  return "데이터 부족";
}

function queueStatusTone(comparison: HandoverComparison) {
  if (comparison.status === "no_changes") return "status-stable";
  if (comparison.status === "no_previous") return "status-muted";
  return "status-watch";
}

function comparisonCountLabel(comparison: HandoverComparison) {
  if (comparison.status === "no_previous") return "비교 불가";
  if (comparison.status === "partial" && comparison.changes.length === 0) return "비교 불가";
  return `${comparison.changes.length.toString().padStart(2, "0")}건`;
}

function queueChangeLabel(comparison: HandoverComparison) {
  if (comparison.status === "no_previous") return "비교 불가";
  if (comparison.status === "partial" && comparison.changes.length === 0) return "비교 불가";
  return "건 변화";
}

function cannotCompare(comparison: HandoverComparison) {
  return comparison.status === "no_previous" ||
    (comparison.status === "partial" && comparison.changes.length === 0);
}

function priorityTone(priority: HandoverChange["reviewPriority"]) {
  return `priority-${priority}`;
}

function EvidenceLinks({ evidenceIds }: { evidenceIds: string[] }) {
  if (evidenceIds.length === 0) return null;
  return (
    <span className="evidence-links" aria-label="연결된 근거">
      {evidenceIds.map((evidenceId) => (
        <a
          className="evidence-link mono"
          href={`#evidence-${evidenceId}`}
          key={evidenceId}
          title={evidenceId}
        >
          근거 {evidenceId.slice(0, 14)}…
        </a>
      ))}
    </span>
  );
}

function PatientQueue({
  responses,
}: {
  responses: HandoverApiResponse[];
}) {
  return (
    <aside className="patient-queue panel" aria-labelledby="patient-queue-title">
      <div className="queue-heading">
        <div>
          <p className="eyebrow">SHIFT / 07:00–15:00</p>
          <h2 id="patient-queue-title">환자 큐</h2>
        </div>
        <span className="queue-count mono">{responses.length.toString().padStart(2, "0")}</span>
      </div>

      <label className="search-field" htmlFor="patient-search">
        <span className="sr-only">환자 이름, ID, 병실 검색</span>
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          id="patient-search"
          type="search"
          placeholder="이름 · ID · 병실 검색"
          aria-label="환자 검색 (다음 단계에서 활성화)"
          readOnly
        />
        <kbd className="search-shortcut">/</kbd>
      </label>

      <div className="queue-toolbar" aria-label="환자 큐 상태">
        <span><i className="status-dot dot-watch" />미검토 변화</span>
        <span><i className="status-dot dot-stable" />변화 없음</span>
      </div>

      <div className="queue-list" role="list">
        {responses.map(({ comparison }, index) => {
            const highPriorityCount = comparison.changes.filter(
              (change) => change.reviewPriority === "high",
            ).length;
            const selected = index === 0;
            return (
              <div
                role="listitem"
                className={`queue-row ${selected ? "is-selected" : ""}`}
                key={comparison.patient.id}
                aria-current={selected ? "true" : undefined}
              >
                <span className="queue-row-top">
                  <span className="queue-room mono">{comparison.patient.room}호</span>
                  <span className={`queue-status ${queueStatusTone(comparison)}`}>
                    {queueStatusLabel(comparison)}
                  </span>
                </span>
                <span className="queue-patient-name">{comparison.patient.name}</span>
                <span className="queue-diagnosis">{comparison.patient.diagnoses[0] ?? "진단 정보 없음"}</span>
                <span className="queue-row-bottom">
                  <span className="queue-id mono">{comparison.patient.id}</span>
                  <span className="queue-change-count">
                    {cannotCompare(comparison) ? null : (
                      <strong className="mono">{comparison.changes.length}</strong>
                    )}{queueChangeLabel(comparison)}
                    {highPriorityCount > 0 ? <em> · 중요 {highPriorityCount}</em> : null}
                  </span>
                </span>
              </div>
            );
          })}
      </div>
      <p className="queue-footnote">총 {responses.length}명 · 읽기 전용 데모</p>
    </aside>
  );
}

function PatientContext({ comparison }: { comparison: HandoverComparison }) {
  const { patient, interval } = comparison;
  return (
    <section className="patient-context panel" aria-labelledby="patient-context-title">
      <div className="context-main">
        <div className="context-title-row">
          <span className="context-marker" aria-hidden="true">↗</span>
          <div>
            <p className="eyebrow">SELECTED PATIENT / 현재 선택</p>
            <h2 id="patient-context-title">{patient.name}</h2>
          </div>
          <span className="context-id mono">{patient.id}</span>
        </div>
        <div className="context-facts" aria-label="환자 기본 정보">
          <span className="fact-item"><strong className="mono">{patient.room}호</strong></span>
          <span className="fact-divider" aria-hidden="true" />
          <span className="fact-item">{formatSex(patient.sex)} · {patient.age === null ? "나이 정보 없음" : `${patient.age}세`}</span>
          <span className="fact-divider" aria-hidden="true" />
          <span className="fact-item muted-fact">알레르기 데이터 없음</span>
        </div>
      </div>
      <div className="context-diagnoses">
        <span className="field-label">주요 진단</span>
        <div className="tag-list">
          {patient.diagnoses.length ? (
            patient.diagnoses.map((diagnosis) => (
              <span className="small-tag" key={diagnosis}>{diagnosis}</span>
            ))
          ) : (
            <span className="muted-fact">진단 정보 없음</span>
          )}
        </div>
      </div>
      <div className="context-interval">
        <span className="field-label">비교 기준 시각</span>
        <div className="interval-values">
          <span className="interval-point">
            <span>이전 기록</span>
            <strong className="mono">{formatTimestamp(interval.previousRecordedAt)}</strong>
          </span>
          <span className="interval-arrow" aria-hidden="true">→</span>
          <span className="interval-point current-point">
            <span>현재 기록</span>
            <strong className="mono">{formatTimestamp(interval.currentRecordedAt)}</strong>
          </span>
        </div>
      </div>
    </section>
  );
}

function ChangeCard({ change }: { change: HandoverChange }) {
  const previousValue = formatValue(change.previousValue);
  const currentValue = formatValue(change.currentValue);
  return (
    <article
      className={`change-card priority-border-${change.reviewPriority}`}
      id={`evidence-${change.id}`}
      aria-labelledby={`change-title-${change.id}`}
    >
      <div className="change-card-header">
        <div className="change-labels">
          <span className="category-label">{CATEGORY_LABELS[change.category]}</span>
          <span className={`type-label type-${change.changeType}`}>
            <span aria-hidden="true">{change.changeType === "added" ? "+" : change.changeType === "removed" ? "−" : "↔"}</span>
            {changeTypeLabel(change)}
          </span>
          <span className={`priority-label ${priorityTone(change.reviewPriority)}`}>
            검토 우선순위 {PRIORITY_LABELS[change.reviewPriority]}
          </span>
        </div>
        <span className="change-field mono">{change.evidence.fieldPath}</span>
      </div>

      <h4 id={`change-title-${change.id}`}>{change.label}</h4>

      <div className="change-values" aria-label={`${change.label} 이전과 현재 값`}>
        <div className="value-column previous-value">
          <span className="value-label">이전</span>
          <strong className="value-text mono">{previousValue}</strong>
          <span className="value-time mono">{formatTimestamp(change.evidence.previousRecordedAt)}</span>
        </div>
        <div className="shift-seam" aria-label="이전 기록과 현재 기록 사이의 변화">
          <span className="seam-mark" aria-hidden="true" />
          <span>변화</span>
        </div>
        <div className="value-column current-value">
          <span className="value-label">현재</span>
          <strong className="value-text mono">{currentValue}</strong>
          <span className="value-time mono">{formatTimestamp(change.evidence.currentRecordedAt)}</span>
        </div>
      </div>

      <div className="change-card-footer">
        <span className={`delta-label delta-${change.delta === null ? "neutral" : change.delta > 0 ? "positive" : "negative"}`}>
          {formatDelta(change.delta)}
        </span>
        <details className="evidence-details">
          <summary>근거 상세 <span className="mono">{change.id.slice(0, 18)}…</span></summary>
          <div className="evidence-detail-grid">
            <span>원본 필드</span><strong className="mono">{change.evidence.fieldPath}</strong>
            <span>양쪽 기록 시각</span><strong className="mono">{formatTimestamp(change.evidence.previousRecordedAt)} → {formatTimestamp(change.evidence.currentRecordedAt)}</strong>
            <span>근거 ID</span><strong className="mono">{change.id}</strong>
          </div>
        </details>
      </div>
    </article>
  );
}

function ComparisonPanel({ comparison }: { comparison: HandoverComparison }) {
  const importantChanges = comparison.changes.filter((change) => change.reviewPriority === "high");
  const regularChanges = comparison.changes.filter((change) => change.reviewPriority !== "high");
  return (
    <section className="comparison-panel panel" aria-labelledby="comparison-title">
      <header className="section-header comparison-header">
        <div>
          <p className="eyebrow">EVIDENCE REVIEW / RECORD DELTA</p>
          <h2 id="comparison-title">변화 검토</h2>
        </div>
        <div className="comparison-status">
          <span className={`status-symbol status-${comparison.status}`} aria-hidden="true">{comparison.status === "ready" ? "!" : "·"}</span>
          <span>{statusLabel(comparison)}</span>
          <strong className="mono">{comparisonCountLabel(comparison)}</strong>
        </div>
      </header>

      <div className="seam-legend" aria-label="Shift Seam 안내">
        <span className="legend-side">이전 기록</span>
        <span className="legend-seam"><i aria-hidden="true" /> SHIFT SEAM · 시간축</span>
        <span className="legend-side">현재 기록</span>
      </div>

      {comparison.dataWarnings.length > 0 ? (
        <div className="warning-banner" role="status">
          <strong>데이터 부족</strong>
          <span>확인할 수 없는 필드: {comparison.dataWarnings.join(", ")}</span>
        </div>
      ) : null}

      {comparison.status === "no_previous" ? (
        <div className="comparison-empty">
          <span className="empty-symbol empty-no-previous" aria-hidden="true">∅</span>
          <h3>비교할 이전 기록이 없습니다.</h3>
          <p>현재 기록 시각 <strong className="mono">{formatTimestamp(comparison.interval.currentRecordedAt)}</strong>을 확인하세요.</p>
        </div>
      ) : comparison.status === "partial" && comparison.changes.length === 0 ? (
        <div className="comparison-empty">
          <span className="empty-symbol empty-partial" aria-hidden="true">!</span>
          <h3>데이터 부족으로 완전한 비교를 수행하지 못했습니다.</h3>
          <p>누락된 필드를 확인한 뒤 원본 기록을 다시 검토하세요.</p>
        </div>
      ) : comparison.status === "no_changes" ? (
        <div className="comparison-empty">
          <span className="empty-symbol empty-no-changes" aria-hidden="true">✓</span>
          <h3>두 기록 사이에서 검출된 변화가 없습니다.</h3>
          <p>비교 기준 시각과 원본 기록을 확인했습니다.</p>
        </div>
      ) : (
        <div className="change-groups">
          {importantChanges.length > 0 ? (
            <section className="change-group" aria-labelledby="important-changes-title">
              <div className="group-heading">
                <span className="group-rule group-rule-watch" />
                <h3 id="important-changes-title">중요 변화</h3>
                <span className="group-count mono">{importantChanges.length}</span>
                <span className="group-helper">먼저 확인할 항목</span>
              </div>
              <div className="change-list">
                {importantChanges.map((change) => <ChangeCard change={change} key={change.id} />)}
              </div>
            </section>
          ) : null}
          {regularChanges.length > 0 ? (
            <section className="change-group" aria-labelledby="regular-changes-title">
              <div className="group-heading">
                <span className="group-rule group-rule-muted" />
                <h3 id="regular-changes-title">일반 변화</h3>
                <span className="group-count mono">{regularChanges.length}</span>
                <span className="group-helper">원본 근거와 함께 확인</span>
              </div>
              <div className="change-list">
                {regularChanges.map((change) => <ChangeCard change={change} key={change.id} />)}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </section>
  );
}

function SummarySection({
  section,
  items,
}: {
  section: keyof HandoverSummary["sections"];
  items: HandoverSummaryItem[];
}) {
  return (
    <section className={`summary-section summary-${section}`} aria-labelledby={`summary-${section}-title`}>
      <div className="summary-section-heading">
        <h3 id={`summary-${section}-title`}>{SECTION_LABELS[section]}</h3>
        <span className="summary-section-rule" aria-hidden="true" />
        <span className="mono summary-item-count">{items.length.toString().padStart(2, "0")}</span>
      </div>
      {items.length === 0 ? (
        <p className="summary-empty">해당 구간 변화 없음</p>
      ) : (
        <ul className="summary-list">
          {items.map((item, index) => (
            <li className="summary-item" key={`${section}-${item.text}-${index}`}>
              <span className="summary-bullet" aria-hidden="true">{section === "recommendation" ? "□" : "•"}</span>
              <div className="summary-item-copy">
                <p>{section === "recommendation" ? RECOMMENDATION_PLACEHOLDER : item.text}</p>
                <EvidenceLinks evidenceIds={item.evidenceIds} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {section === "recommendation" ? (
        <>
          <textarea
            className="recommendation-input"
            placeholder={RECOMMENDATION_PLACEHOLDER}
            aria-label="간호사가 확인할 후속 항목"
            aria-readonly="true"
            rows={3}
            readOnly
          />
          <p className="control-note recommendation-note">다음 단계에서 입력을 활성화합니다.</p>
        </>
      ) : null}
    </section>
  );
}

function SummaryPanel({
  comparison,
  summary,
}: {
  comparison: HandoverComparison;
  summary: HandoverSummary;
}) {
  const totalChanges = comparison.changes.length;
  const evidenceCount = summary.evidenceIds.length;
  return (
    <aside className="summary-panel panel" aria-labelledby="summary-title">
      <header className="section-header summary-header">
        <div>
          <p className="eyebrow">HANDOVER DRAFT / SBAR</p>
          <h2 id="summary-title">인수인계 초안</h2>
        </div>
        <span className={`source-tag source-${summary.mode}`}>
          {summary.mode === "deterministic" ? "deterministic" : "AI 문장화"}
        </span>
      </header>

      <div className="summary-integrity" aria-label="근거 포함률">
        <div className="integrity-heading">
          <span>근거 포함률</span>
          <strong className="mono">{cannotCompare(comparison) ? "비교 불가" : `${evidenceCount}/${totalChanges}`}</strong>
        </div>
        <div className="integrity-track"><span style={{ width: `${totalChanges ? (evidenceCount / totalChanges) * 100 : 0}%` }} /></div>
        <p>검출된 변화 요약은 원본 변화 ID에 연결됩니다.</p>
      </div>

      <div className="summary-body">
        <SummarySection section="situation" items={summary.sections.situation} />
        <SummarySection section="background" items={summary.sections.background} />
        <SummarySection section="assessment" items={summary.sections.assessment} />
        <SummarySection section="recommendation" items={summary.sections.recommendation} />
      </div>

      {summary.warnings.length > 0 ? (
        <div className="summary-warning" role="status">
          <strong>요약 주의</strong>
          <span>{summary.warnings.join(", ")}</span>
        </div>
      ) : null}

      <div className="review-footer">
        <label className="review-check">
          <input
            type="checkbox"
            disabled
          />
          <span className="custom-checkbox" aria-hidden="true">✓</span>
          <span>원본 기록을 확인했습니다 <small className="control-note">다음 단계에서 활성화</small></span>
        </label>
        <button
          type="button"
          className="review-button"
          disabled
        >
          <span aria-hidden="true">→</span>
          검토 완료 · 다음 단계에서 활성화
        </button>
      </div>
      <p className="safety-note">가상 데이터 · 의사결정 보조가 아님</p>
    </aside>
  );
}

export function HandoverWorkspace({ data }: HandoverWorkspaceProps) {
  const selectedResponse = data[0];

  if (!selectedResponse) {
    return (
      <main className="workspace-empty" aria-labelledby="workspace-empty-title">
        <h1 id="workspace-empty-title">환자 비교 데이터가 없습니다.</h1>
        <p>읽기 전용 데모 응답을 확인할 수 없습니다.</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="utility-bar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">/</span>
          <div>
            <p className="brand-kicker">NURSE HANDOVER</p>
            <h1>교대 인수인계 작업공간</h1>
          </div>
        </div>
        <div className="utility-meta">
          <span className="utility-context">일반 성인병동 · 교대 검토</span>
          <span className="utility-separator" aria-hidden="true" />
          <span className="safety-note">가상 데이터 · 의사결정 보조가 아님</span>
          <span className="utility-clock mono">07/02 09:45</span>
        </div>
      </header>

      <div className="workspace-shell">
        <PatientQueue
          responses={data}
        />
        <main className="comparison-workspace" aria-live="polite">
          <PatientContext comparison={selectedResponse.comparison} />
          <ComparisonPanel comparison={selectedResponse.comparison} />
        </main>
        <SummaryPanel
          comparison={selectedResponse.comparison}
          summary={selectedResponse.summary}
        />
      </div>
    </div>
  );
}
