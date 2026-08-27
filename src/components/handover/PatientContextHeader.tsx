import type { HandoverComparison } from "@/lib/contracts";

export type PatientContextHeaderProps = {
  comparison: HandoverComparison;
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

export function PatientContextHeader({ comparison }: PatientContextHeaderProps) {
  const { patient, interval } = comparison;

  return (
    <section className="patient-context panel" aria-label="환자 컨텍스트">
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
