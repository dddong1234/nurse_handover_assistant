import type { HandoverApiResponse, HandoverComparison } from "@/lib/contracts";

export type PatientQueueProps = {
  responses: HandoverApiResponse[];
  selectedPatientId: string;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSelectPatient: (patientId: string) => void;
};

function cannotCompare(comparison: HandoverComparison) {
  return (
    comparison.status === "no_previous" ||
    (comparison.status === "partial" && comparison.changes.length === 0)
  );
}

function queueStatusLabel(comparison: HandoverComparison) {
  if (comparison.status === "ready") return "변화 검출";
  if (comparison.status === "no_changes") return "변화 없음";
  if (comparison.status === "no_previous") return "비교 데이터 없음";
  return "데이터 부족";
}

function queueStatusTone(comparison: HandoverComparison) {
  if (comparison.status === "no_changes") return "status-stable";
  if (comparison.status === "no_previous") return "status-muted";
  return "status-watch";
}

function queueChangeLabel(comparison: HandoverComparison) {
  if (comparison.status === "no_previous") return "비교 불가";
  if (comparison.status === "partial" && comparison.changes.length === 0) return "비교 불가";
  return "건 변화";
}

export function filterPatientResponses(
  responses: HandoverApiResponse[],
  searchTerm: string,
) {
  const normalizedQuery = searchTerm.trim().toLocaleLowerCase();
  if (!normalizedQuery) return responses;

  return responses.filter(({ comparison }) => {
    const { patient } = comparison;
    return [patient.name, patient.id, patient.room].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
}

export function PatientQueue({
  responses,
  selectedPatientId,
  searchTerm,
  onSearchChange,
  onSelectPatient,
}: PatientQueueProps) {
  const filteredResponses = filterPatientResponses(responses, searchTerm);

  return (
    <aside className="patient-queue panel" aria-labelledby="patient-queue-title">
      <div className="queue-heading">
        <div>
          <p className="eyebrow">SHIFT / 07:00–15:00</p>
          <h2 id="patient-queue-title">환자 큐</h2>
        </div>
        <span className="queue-count mono">{filteredResponses.length.toString().padStart(2, "0")}</span>
      </div>

      <label className="search-field" htmlFor="patient-search">
        <span className="search-label">환자 검색</span>
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          id="patient-search"
          type="search"
          value={searchTerm}
          placeholder="이름 · 환자 ID · 병실"
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <kbd className="search-shortcut" aria-hidden="true">/</kbd>
      </label>

      <div className="queue-toolbar" aria-label="환자 큐 상태">
        <span><i className="status-dot dot-watch" aria-hidden="true" />변화 검출</span>
        <span><i className="status-dot dot-stable" aria-hidden="true" />변화 없음</span>
      </div>

      {filteredResponses.length === 0 ? (
        <div className="queue-empty" role="status" aria-live="polite">
          <strong>검색 결과가 없습니다.</strong>
          <span>이름, ID 또는 병실 번호를 확인하세요.</span>
        </div>
      ) : (
        <div className="queue-list" role="list" aria-label="환자 목록">
          {filteredResponses.map(({ comparison }) => {
            const highPriorityCount = comparison.changes.filter(
              (change) => change.reviewPriority === "high",
            ).length;
            const selected = comparison.patient.id === selectedPatientId;
            const { patient } = comparison;

            return (
              <div role="listitem" key={patient.id}>
                <button
                  type="button"
                  className={`queue-row ${selected ? "is-selected" : ""}`}
                  aria-current={selected ? "true" : undefined}
                  aria-label={`${patient.name}, ${patient.id}, ${patient.room}호`}
                  onClick={() => onSelectPatient(patient.id)}
                >
                  <span className="queue-row-top">
                    <span className="queue-room mono">{patient.room}호</span>
                    <span className={`queue-status ${queueStatusTone(comparison)}`}>
                      {queueStatusLabel(comparison)}
                    </span>
                  </span>
                  <span className="queue-patient-name">{patient.name}</span>
                  <span className="queue-diagnosis">
                    {patient.diagnoses[0] ?? "진단 정보 없음"}
                  </span>
                  <span className="queue-row-bottom">
                    <span className="queue-id mono">{patient.id}</span>
                    <span className="queue-change-count">
                      {cannotCompare(comparison) ? null : (
                        <strong className="mono">{comparison.changes.length}</strong>
                      )}
                      {queueChangeLabel(comparison)}
                      {highPriorityCount > 0 ? <em> · 중요 {highPriorityCount}</em> : null}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="queue-footnote">총 {responses.length}명 · 읽기 전용 데모</p>
    </aside>
  );
}
