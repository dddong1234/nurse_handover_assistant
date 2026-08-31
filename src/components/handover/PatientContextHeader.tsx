import type { HandoverComparison } from "@/lib/contracts";

export type PatientContextHeaderProps = {
  comparison: HandoverComparison;
  onOpenRecord?: () => void;
};

export function formatSex(sex: string) {
  if (sex === "M") return "남(M)";
  if (sex === "F") return "여(F)";
  return sex || "성별 정보 없음";
}

export function formatTimestamp(timestamp: string | null) {
  if (!timestamp) return "기록 없음";
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return timestamp;
  return `${match[2]}/${match[3]} ${match[4]}:${match[5]}`;
}

export function PatientContextHeader({ comparison, onOpenRecord }: PatientContextHeaderProps) {
  const { patient, interval } = comparison;
  const totalChangeCount = comparison.changes.length;
  const highPriorityChangeCount = comparison.changes.filter(
    (change) => change.reviewPriority === "high",
  ).length;

  return (
    <section className="patient-context panel" aria-label="환자 컨텍스트">
      <div className="context-main">
        <div className="context-title-row">
          <span className="context-marker" aria-hidden="true">↗</span>
          <div>
            <p className="eyebrow">선택 환자 · 현재 선택</p>
            <h2 id="patient-context-title">{patient.name}</h2>
          </div>
          <span className="context-id mono">{patient.id}</span>
          {onOpenRecord ? (
            <button type="button" className="record-open-button" onClick={onOpenRecord}>
              원본 기록
            </button>
          ) : null}
        </div>
        <div className="context-facts" aria-label="환자 기본 정보">
          <span className="fact-item"><strong className="mono">{patient.room}호</strong></span>
          <span className="fact-divider" aria-hidden="true" />
          <span className="fact-item">
            {formatSex(patient.sex)} · {patient.age === null ? "나이 정보 없음" : `${patient.age}세`}
          </span>
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

      <section className="shift-summary-strip" aria-labelledby="shift-summary-title" aria-live="polite">
        <div className="shift-summary-heading">
          <span className="shift-summary-mark" aria-hidden="true">↗</span>
          <div>
            <p className="field-label">교대 변화 요약</p>
            <h3 id="shift-summary-title">이번 근무 변화</h3>
          </div>
        </div>
        <div className="shift-summary-interval" aria-label="비교 구간">
          <span className="shift-summary-interval-label">비교 구간</span>
          <span className="shift-summary-interval-value mono">
            <span className="shift-summary-point">{formatTimestamp(interval.previousRecordedAt)}</span>
            <span className="shift-summary-arrow" aria-hidden="true">→</span>
            <span className="shift-summary-point">{formatTimestamp(interval.currentRecordedAt)}</span>
          </span>
        </div>
        <div className="shift-summary-stats" aria-label="변화 집계">
          <span className="shift-summary-stat">
            <strong className="mono">총 {totalChangeCount}건</strong>
            <span>전체 변화</span>
          </span>
          <span className="shift-summary-stat shift-summary-stat-priority">
            <strong className="mono">중요 {highPriorityChangeCount}건</strong>
            <span>먼저 확인</span>
          </span>
        </div>
      </section>
    </section>
  );
}
