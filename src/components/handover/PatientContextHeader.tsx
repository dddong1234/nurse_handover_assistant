import type { HandoverComparison } from "@/lib/contracts";
import type { HandoverPeriodApiResponse } from "@/lib/handover-period-contracts";

export type PatientContextScope = "shift" | "return";

export type PatientContextHeaderProps = {
  comparison: HandoverComparison;
  onOpenRecord?: () => void;
  scope?: PatientContextScope;
  period?: HandoverPeriodApiResponse["period"] | null;
  requestedStartAt?: string | null;
  periodCurrentCount?: number;
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

function returnDurationLabel(period: HandoverPeriodApiResponse["period"]) {
  const end = Date.parse(period.currentRecordedAt);
  const start = Date.parse(period.baselineRecordedAt ?? period.requestedStartAt);
  if (!Number.isFinite(end) || !Number.isFinite(start) || end <= start) return "복귀 인계";
  const days = Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
  return `${days}일 복귀 인계`;
}

export function PatientContextHeader({
  comparison,
  scope = "shift",
  period = null,
  requestedStartAt = null,
  periodCurrentCount = 0,
}: PatientContextHeaderProps) {
  const { patient, interval } = comparison;
  const returnMode = scope === "return";
  const displayedInterval = returnMode
    ? {
      previousRecordedAt: period?.baselineRecordedAt ?? requestedStartAt,
      currentRecordedAt: period?.currentRecordedAt ?? interval.currentRecordedAt,
    }
    : interval;
  const totalChangeCount = returnMode ? period?.eventCount ?? 0 : comparison.changes.length;
  const highPriorityChangeCount = comparison.changes.filter(
    (change) => change.reviewPriority === "high",
  ).length;
  const requestedStartDiffers = Boolean(returnMode && period && period.baselineRecordedAt !== period.requestedStartAt);

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
        </div>
        <div className="context-facts" aria-label="환자 기본 정보">
          <span className="fact-item"><strong className="mono">{patient.room}호</strong></span>
          <span className="fact-divider" aria-hidden="true" />
          <span className="fact-item">
            {formatSex(patient.sex)} · {patient.age === null ? "나이 정보 없음" : `${patient.age}세`}
          </span>
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

      <section className="shift-summary-strip" aria-labelledby="shift-summary-title">
        <div className="shift-summary-heading">
          <span className="shift-summary-mark" aria-hidden="true">↗</span>
          <div>
            <p className="field-label">{returnMode ? "복귀 기간 요약" : "교대 변화 요약"}</p>
            <h3 id="shift-summary-title">{returnMode && period ? returnDurationLabel(period) : returnMode ? "복귀 인계" : "이번 근무 변화"}</h3>
          </div>
        </div>
        <div className="shift-summary-interval" aria-label="비교 구간">
          <span className="shift-summary-interval-label">{returnMode && !period ? "요청 기준 구간" : "비교 구간"}</span>
          <span className="shift-summary-interval-value mono">
            <span className="shift-summary-point" title={displayedInterval.previousRecordedAt ?? undefined}>{formatTimestamp(displayedInterval.previousRecordedAt)}</span>
            <span className="shift-summary-arrow" aria-hidden="true">→</span>
            <span className="shift-summary-point" title={displayedInterval.currentRecordedAt ?? undefined}>{formatTimestamp(displayedInterval.currentRecordedAt)}</span>
          </span>
        </div>
        <div className="shift-summary-stats" aria-label="변화 집계">
          <span className="shift-summary-stat">
            <strong className="mono">총 {totalChangeCount}건</strong>
            <span>{returnMode ? "기간 사건" : "전체 변화"}</span>
          </span>
          <span className="shift-summary-stat shift-summary-stat-priority">
            <strong className="mono">{returnMode ? `현재 ${periodCurrentCount}건` : `중요 ${highPriorityChangeCount}건`}</strong>
            <span>{returnMode ? "현재 확인" : "먼저 확인"}</span>
          </span>
        </div>
      </section>
      {returnMode && period && !period.baselineRecordedAt ? (
        <p className="return-context-warning">선택한 마지막 근무 시각 이전의 기준 기록을 확인할 수 없습니다.</p>
      ) : requestedStartDiffers && period ? (
        <p className="return-context-warning">
          선택 시각 이전의 가장 가까운 기록 기준 · {formatTimestamp(period.baselineRecordedAt)}
        </p>
      ) : null}
    </section>
  );
}
