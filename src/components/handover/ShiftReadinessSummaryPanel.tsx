import type {
  ShiftReadinessItem,
  ShiftReadinessResponse,
} from "@/lib/shift-readiness-contracts";

import { FACT_STATUS_LABELS } from "./ShiftReadinessWorkspace";

export type ShiftReadinessSummaryPanelProps = {
  response: ShiftReadinessResponse | null;
  acknowledgedItemIds: readonly string[];
  manualHandoverNote: string;
  status: "idle" | "loading" | "success" | "error";
  errorMessage?: string | null;
  onManualHandoverNoteChange(value: string): void;
  onNavigateToItem(itemId: string): void;
  onRetry(): void;
};

type StatusAnnouncement = {
  role: "status" | "alert";
  tone: "loading" | "error" | "state";
  title: string;
  message: string;
};

function responseStatusAnnouncement(response: ShiftReadinessResponse): StatusAnnouncement | null {
  if (response.status === "no_baseline") {
    return {
      role: "status",
      tone: "state",
      title: "기준 기록 없음",
      message: "기준 기록이 없어 현재 기록에서 확인 가능한 항목만 집계합니다.",
    };
  }
  if (response.status === "no_items") {
    return {
      role: "status",
      tone: "state",
      title: "이번 근무에 표시할 항목 없음",
      message: "현재 응답에서 표시 규칙에 해당하는 항목을 찾지 못했습니다.",
    };
  }
  if (response.status === "partial") {
    return {
      role: "status",
      tone: "state",
      title: "부분 결과",
      message: response.dataWarnings.length
        ? response.dataWarnings.join(" ")
        : "일부 데이터 공백이 있어 확인 가능한 항목만 집계합니다.",
    };
  }
  return null;
}

function createRequestAnnouncement(
  status: ShiftReadinessSummaryPanelProps["status"],
  response: ShiftReadinessResponse | null,
  errorMessage: string | null | undefined,
): StatusAnnouncement | null {
  if (errorMessage || status === "error") {
    return {
      role: "alert",
      tone: "error",
      title: "근무 준비 요약",
      message: errorMessage ?? "근무 준비 요약을 불러오지 못했습니다.",
    };
  }
  if (status === "loading") {
    return {
      role: "status",
      tone: "loading",
      title: "근무 준비 요약",
      message: response
        ? "새 근무 준비 요약을 불러오는 중입니다. 현재 표시된 요약은 유지됩니다."
        : "근무 준비 요약을 불러오는 중입니다.",
    };
  }
  if (!response) {
    return {
      role: "status",
      tone: "state",
      title: "근무 준비 요약",
      message: "근무 준비 요약을 준비 중입니다.",
    };
  }
  return null;
}

function ProgressSection({
  response,
  acknowledgedItemIds,
}: {
  response: ShiftReadinessResponse | null;
  acknowledgedItemIds: readonly string[];
}) {
  const total = response?.metrics.itemCount ?? null;
  const acknowledged = response
    ? response.items.filter((item) => acknowledgedItemIds.includes(item.id)).length
    : null;
  const unacknowledged = response && total !== null && acknowledged !== null
    ? Math.max(0, total - acknowledged)
    : null;

  return (
    <section className="shift-readiness-summary-progress" aria-labelledby="shift-readiness-progress-title">
      <header className="shift-readiness-summary-section-header">
        <h3 id="shift-readiness-progress-title">검토 진행</h3>
        <span className="shift-readiness-summary-progress-label">항목별 확인 표시</span>
      </header>
      <div
        className="shift-readiness-summary-progress-value"
        aria-label={response ? `확인함 ${acknowledged}개 중 ${total}개` : "검토 진행 정보를 사용할 수 없습니다."}
      >
        <strong className="mono">{response ? `${acknowledged}/${total}` : "—"}</strong>
        <span>확인함</span>
      </div>
      <p className="shift-readiness-summary-unreviewed" data-testid="shift-readiness-unreviewed-count">
        {response ? `미확인 ${unacknowledged}건` : "검토 진행 정보 없음"}
      </p>
      <div className="shift-readiness-summary-progress-track" aria-hidden="true">
        <span style={{ width: response && total ? `${Math.min(100, ((acknowledged ?? 0) / total) * 100)}%` : "0%" }} />
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  return (
    <div className={`shift-readiness-summary-metric shift-readiness-summary-metric-${tone}`}>
      <span>{label}</span>
      <strong className="mono" aria-label={value === null ? `${label} 데이터를 기다리는 중` : `${label} ${value}건`}>
        {value === null ? "—" : `${value}건`}
      </strong>
    </div>
  );
}

function MetricsSection({ response }: { response: ShiftReadinessResponse | null }) {
  const metrics = response?.metrics;
  return (
    <section className="shift-readiness-summary-metrics" aria-labelledby="shift-readiness-metrics-title">
      <header className="shift-readiness-summary-section-header">
        <h3 id="shift-readiness-metrics-title">근무 항목 지표</h3>
        <span className="shift-readiness-summary-metrics-helper">응답에 기록된 수</span>
      </header>
      <div className="shift-readiness-summary-metric-list">
        <Metric label="새 결과" value={metrics?.newResultCount ?? null} tone="new-result" />
        <Metric label="이번 근무 예정" value={metrics?.scheduledThisShiftCount ?? null} tone="scheduled" />
        <Metric label="결과 대기" value={metrics?.pendingResultCount ?? null} tone="pending" />
      </div>
    </section>
  );
}

function DeterministicBrief({ response }: { response: ShiftReadinessResponse | null }) {
  const items = response?.items ?? [];
  const metrics = response?.metrics;

  return (
    <section className="shift-readiness-summary-brief" aria-labelledby="shift-readiness-brief-title">
      <header className="shift-readiness-summary-section-header">
        <h3 id="shift-readiness-brief-title">기록 기반 요약</h3>
      </header>
      <p className="shift-readiness-summary-brief-copy">
        {response
          ? `기록된 ${items.length}개 항목 중 새 결과 ${metrics?.newResultCount ?? 0}건, 이번 근무 예정 ${metrics?.scheduledThisShiftCount ?? 0}건, 결과 대기 ${metrics?.pendingResultCount ?? 0}건입니다.`
          : "응답이 준비되면 기록된 항목 수를 표시합니다."}
      </p>
      <p className="shift-readiness-summary-brief-note">원본 항목과 사실 상태를 기준으로 표시합니다.</p>
      {items.length ? (
        <ul className="shift-readiness-summary-brief-items" aria-label="기록 기반 항목">
          {items.map((item) => (
            <li key={item.id}>
              <span className="shift-readiness-summary-brief-item-title">{item.title}</span>
              <span className="shift-readiness-summary-brief-item-status">{FACT_STATUS_LABELS[item.factStatus]}</span>
            </li>
          ))}
        </ul>
      ) : response ? (
        <p className="shift-readiness-summary-empty">이번 근무에 표시할 항목 없음</p>
      ) : (
        <p className="shift-readiness-summary-empty">응답이 준비되면 기록된 항목을 표시합니다.</p>
      )}
    </section>
  );
}

function UnacknowledgedLinks({
  items,
  acknowledgedItemIds,
  onNavigateToItem,
  hasResponse,
}: {
  items: readonly ShiftReadinessItem[];
  acknowledgedItemIds: readonly string[];
  onNavigateToItem: (itemId: string) => void;
  hasResponse: boolean;
}) {
  const unacknowledgedItems = items.filter((item) => !acknowledgedItemIds.includes(item.id));

  return (
    <section className="shift-readiness-summary-quick-links" aria-labelledby="shift-readiness-quick-links-title">
      <header className="shift-readiness-summary-section-header">
        <h3 id="shift-readiness-quick-links-title">미확인 항목</h3>
        <span className="shift-readiness-summary-quick-link-count mono">{unacknowledgedItems.length}건</span>
      </header>
      {unacknowledgedItems.length ? (
        <ul className="shift-readiness-summary-quick-link-list" aria-label="미확인 항목">
          {unacknowledgedItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="shift-readiness-summary-quick-link"
                data-item-id={item.id}
                onClick={() => onNavigateToItem(item.id)}
              >
                <span>{item.title}</span>
                <span className="shift-readiness-summary-quick-link-status">{FACT_STATUS_LABELS[item.factStatus]}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : hasResponse ? (
        <p className="shift-readiness-summary-empty">미확인 항목 없음</p>
      ) : (
        <p className="shift-readiness-summary-empty">응답이 준비되면 미확인 항목을 표시합니다.</p>
      )}
    </section>
  );
}

export function ShiftReadinessSummaryPanel({
  response,
  acknowledgedItemIds,
  manualHandoverNote,
  status,
  errorMessage = null,
  onManualHandoverNoteChange,
  onNavigateToItem,
  onRetry,
}: ShiftReadinessSummaryPanelProps) {
  const requestAnnouncement = createRequestAnnouncement(status, response, errorMessage);
  const responseAnnouncement = response ? responseStatusAnnouncement(response) : null;

  return (
    <aside
      className="shift-readiness-summary-panel panel"
      data-testid="shift-readiness-summary-panel"
      data-shift-readiness-status={response?.status ?? status}
      aria-labelledby="shift-readiness-summary-title"
      aria-busy={status === "loading"}
    >
      <header className="shift-readiness-summary-header">
        <div>
          <p className="eyebrow">RETURN HANDOVER · SUMMARY</p>
          <h2 id="shift-readiness-summary-title">복귀 기간 요약</h2>
        </div>
      </header>

      {requestAnnouncement ? (
        <div
          className={`shift-readiness-summary-status shift-readiness-summary-status-${requestAnnouncement.tone}`}
          role={requestAnnouncement.role}
          aria-label={requestAnnouncement.role === "alert" ? "근무 준비 요약 오류" : "근무 준비 요약 상태"}
          aria-live={requestAnnouncement.role === "alert" ? "assertive" : "polite"}
        >
          <strong>{requestAnnouncement.title}</strong>
          <span>{requestAnnouncement.message}</span>
          {responseAnnouncement ? (
            <span className="shift-readiness-summary-retained-response-state">
              <strong>{responseAnnouncement.title}</strong>
              <span>{responseAnnouncement.message}</span>
            </span>
          ) : null}
          {requestAnnouncement.role === "alert" ? (
            <button type="button" className="shift-readiness-summary-retry" onClick={onRetry}>다시 시도</button>
          ) : null}
        </div>
      ) : null}

      {!requestAnnouncement && responseAnnouncement ? (
        <div
          className={`shift-readiness-summary-status shift-readiness-summary-status-${responseAnnouncement.tone}`}
          role={responseAnnouncement.role}
          aria-label="응답 상태"
          aria-live="polite"
        >
          <strong>{responseAnnouncement.title}</strong>
          <span>{responseAnnouncement.message}</span>
        </div>
      ) : null}

      <div className="shift-readiness-summary-body">
        <ProgressSection response={response} acknowledgedItemIds={acknowledgedItemIds} />
        <MetricsSection response={response} />
        <DeterministicBrief response={response} />
        <UnacknowledgedLinks
          items={response?.items ?? []}
          acknowledgedItemIds={acknowledgedItemIds}
          onNavigateToItem={onNavigateToItem}
          hasResponse={Boolean(response)}
        />
        {response?.dataWarnings.length ? (
          <div className="shift-readiness-summary-warnings" role="note">
            <strong>데이터 주의</strong>
            <span>{response.dataWarnings.join(" ")}</span>
          </div>
        ) : null}
      </div>

      <section className="shift-readiness-summary-note" aria-labelledby="shift-readiness-note-title">
        <label id="shift-readiness-note-title" htmlFor="shift-readiness-note-input">인계 메모</label>
        <textarea
          id="shift-readiness-note-input"
          rows={4}
          value={manualHandoverNote}
          aria-label="인계 메모"
          placeholder="다음 근무에 전달할 메모를 입력하세요."
          onChange={(event) => onManualHandoverNoteChange(event.target.value)}
        />
        <p className="shift-readiness-summary-note-helper">이 메모는 현재 세션에서만 유지됩니다.</p>
      </section>
    </aside>
  );
}
