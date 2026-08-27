"use client";

import { useState } from "react";
import type {
  HandoverApiResponse,
  HandoverComparison,
  HandoverSummary,
  HandoverSummaryItem,
} from "@/lib/contracts";

import { ComparisonWorkspace } from "./ComparisonWorkspace";
import { PatientContextHeader } from "./PatientContextHeader";
import { PatientQueue } from "./PatientQueue";

export type HandoverWorkspaceProps = {
  data: HandoverApiResponse[];
};

const SECTION_LABELS: Record<keyof HandoverSummary["sections"], string> = {
  situation: "Situation",
  background: "Background",
  assessment: "Assessment",
  recommendation: "Recommendation",
};

const RECOMMENDATION_PLACEHOLDER = "간호사가 확인할 후속 항목을 입력하세요.";

function cannotCompare(comparison: HandoverComparison) {
  return (
    comparison.status === "no_previous" ||
    (comparison.status === "partial" && comparison.changes.length === 0)
  );
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
              <span className="summary-bullet" aria-hidden="true">
                {section === "recommendation" ? "□" : "•"}
              </span>
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
  const coverage = totalChanges ? Math.min(100, (evidenceCount / totalChanges) * 100) : 0;

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
        <div className="integrity-track"><span style={{ width: `${coverage}%` }} /></div>
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
          <input type="checkbox" disabled />
          <span className="custom-checkbox" aria-hidden="true">✓</span>
          <span>원본 기록을 확인했습니다 <small className="control-note">다음 단계에서 활성화</small></span>
        </label>
        <button type="button" className="review-button" disabled>
          <span aria-hidden="true">→</span>
          검토 완료 · 다음 단계에서 활성화
        </button>
      </div>
      <p className="safety-note">가상 데이터 · 의사결정 보조가 아님</p>
    </aside>
  );
}

export function HandoverWorkspace({ data }: HandoverWorkspaceProps) {
  const validResponses = data.filter(
    (response) => Boolean(response?.comparison?.patient?.id && response.comparison.patient.name),
  );
  const firstValidResponse = validResponses[0];
  const firstValidPatientId = firstValidResponse?.comparison.patient.id ?? "";
  const [selectedPatientId, setSelectedPatientId] = useState(firstValidPatientId);
  const [searchTerm, setSearchTerm] = useState("");

  if (!firstValidResponse) {
    return (
      <main className="workspace-empty" aria-labelledby="workspace-empty-title">
        <h1 id="workspace-empty-title">환자 비교 데이터가 없습니다.</h1>
        <p>읽기 전용 데모 응답을 확인할 수 없습니다.</p>
        <p className="safety-note">가상 데이터 · 의사결정 보조가 아님</p>
      </main>
    );
  }

  const selectedResponse = validResponses.find(
    ({ comparison }) => comparison.patient.id === selectedPatientId,
  ) ?? firstValidResponse;

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
          responses={validResponses}
          selectedPatientId={selectedResponse.comparison.patient.id}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onSelectPatient={setSelectedPatientId}
        />
        <main className="comparison-workspace" aria-live="polite">
          <PatientContextHeader comparison={selectedResponse.comparison} />
          <ComparisonWorkspace comparison={selectedResponse.comparison} />
        </main>
        <SummaryPanel
          comparison={selectedResponse.comparison}
          summary={selectedResponse.summary}
        />
      </div>
    </div>
  );
}
