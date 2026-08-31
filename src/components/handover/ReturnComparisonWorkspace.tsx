import type { HandoverChangeValue } from "@/lib/contracts";
import type {
  HandoverPeriodApiResponse,
  PeriodClassification,
  PeriodEvent,
  PeriodReviewItem,
} from "@/lib/handover-period-contracts";

import { formatTimestamp } from "./PatientContextHeader";

export type ReturnComparisonWorkspaceProps = {
  response: HandoverPeriodApiResponse | null;
  onOpenEvidence: (eventId: string) => void;
  loading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
};

const CATEGORY_LABELS: Record<PeriodEvent["change"]["category"], string> = {
  vitals: "활력징후",
  medications: "투약",
  diagnosis: "진단",
  notes: "간호 메모",
};

const SECTION_DEFINITIONS: ReadonlyArray<{
  key: "current" | "periodOnly" | "trends" | "recordEvents";
  title: string;
  helper: string;
}> = [
  { key: "current", title: "현재도 유효한 변화", helper: "현재 기록에 남아 있는 변화" },
  { key: "periodOnly", title: "기간 중 발생 후 변경된 사항", helper: "기간 중 기록되었으나 현재 기록에는 남아 있지 않은 변화" },
  { key: "trends", title: "활력징후 추세", helper: "시간순 기록값" },
  { key: "recordEvents", title: "전체 타임라인", helper: "날짜와 기록 시각 순서" },
];

function formatValue(value: HandoverChangeValue): string {
  if (value === null) return "기록 없음";
  if (typeof value === "object") return `${value.name} · ${value.route} · ${value.frequency}`;
  return String(value);
}

function changeTypeLabel(event: PeriodEvent): string {
  if (event.change.changeType === "added") return "추가";
  if (event.change.changeType === "removed") return event.change.category === "medications" ? "중단" : "삭제";
  return "변경";
}

function classificationLabel(classification: PeriodClassification): string {
  if (classification === "current") return "현재 반영";
  if (classification === "period_only") return "기간 중 발생 후 변경";
  if (classification === "trend") return "시간순 추세";
  return "기록 사건";
}

function periodStatusLabel(status: HandoverPeriodApiResponse["period"]["status"]): string {
  if (status === "no_baseline") return "기준 기록 없음";
  if (status === "no_events") return "해당 기간에 검출된 변화가 없습니다.";
  if (status === "partial") return "부분 결과";
  return "확인 가능한 기간 변화";
}

type ReturnStatusAnnouncement = {
  role: "status" | "alert";
  tone: "loading" | "error" | "state";
  title: string;
  message: string;
};

function createStatusAnnouncement(
  status: HandoverPeriodApiResponse["period"]["status"],
  loading: boolean,
  errorMessage: string | null,
): ReturnStatusAnnouncement | null {
  if (errorMessage) {
    return {
      role: "alert",
      tone: "error",
      title: "기간 비교",
      message: errorMessage,
    };
  }
  if (loading) {
    return {
      role: "status",
      tone: "loading",
      title: "기간 비교",
      message: "새 기간 결과를 불러오는 중입니다. 현재 표시된 결과는 유지됩니다.",
    };
  }
  if (status === "no_baseline") {
    return {
      role: "status",
      tone: "state",
      title: "기준 기록 없음",
      message: "선택한 시각 이전의 기준 기록을 확인할 수 없습니다.",
    };
  }
  if (status === "no_events") {
    return {
      role: "status",
      tone: "state",
      title: "변화 없음",
      message: "해당 기간에 검출된 변화가 없습니다.",
    };
  }
  if (status === "partial") {
    return {
      role: "status",
      tone: "state",
      title: "부분 결과",
      message: "명시된 데이터 공백이 있어 확인 가능한 사건만 표시합니다.",
    };
  }
  return null;
}

function eventIdsForGroup(
  item: PeriodReviewItem,
  eventsById: ReadonlyMap<string, PeriodEvent>,
): PeriodEvent[] {
  return item.eventIds.flatMap((eventId) => {
    const event = eventsById.get(eventId);
    return event ? [event] : [];
  });
}

function EventRow({ event, onOpenEvidence }: { event: PeriodEvent; onOpenEvidence: (eventId: string) => void }) {
  const change = event.change;
  const typeLabel = changeTypeLabel(event);

  return (
    <article
      className={`return-event-row return-event-${event.classification}`}
      id={`return-event-${event.id}`}
      data-testid="return-event-row"
      data-event-id={event.id}
      aria-labelledby={`return-event-title-${event.id}`}
    >
      <header className="return-event-header">
        <div className="return-event-meta">
          <time className="return-event-time mono" dateTime={event.detectedAt} title={event.detectedAt}>
            기록 {formatTimestamp(event.detectedAt)}
          </time>
          <span className="return-event-category">{CATEGORY_LABELS[change.category]}</span>
          <span className={`return-event-status return-event-status-${event.classification}`}>
            {classificationLabel(event.classification)}
          </span>
        </div>
      </header>

      <div className="return-event-main">
        <h3 id={`return-event-title-${event.id}`}>{change.label}</h3>
        <div className="return-event-change" aria-label={`${change.label} 이전과 현재 값`}>
          <div className="return-event-value return-event-value-previous">
            <span>이전</span>
            <strong className="mono">{formatValue(change.previousValue)}</strong>
          </div>
          <span className="return-event-arrow" aria-label={`${typeLabel} 방향`} aria-hidden="true">→</span>
          <div className="return-event-value return-event-value-current">
            <span>현재</span>
            <strong className="mono">{formatValue(change.currentValue)}</strong>
          </div>
        </div>
      </div>

      <footer className="return-event-footer">
        <span className="return-event-field">원본 기록 연결</span>
        <button
          id={`return-evidence-${event.id}`}
          type="button"
          className="return-evidence-button"
          onClick={() => onOpenEvidence(event.id)}
        >
          근거 보기
        </button>
      </footer>
    </article>
  );
}

function GroupSection({
  title,
  helper,
  items,
  eventsById,
  onOpenEvidence,
}: {
  title: string;
  helper: string;
  items: PeriodReviewItem[];
  eventsById: ReadonlyMap<string, PeriodEvent>;
  onOpenEvidence: (eventId: string) => void;
}) {
  const events = items.flatMap((item) => eventIdsForGroup(item, eventsById));
  const titleId = `return-section-${title.replace(/\s+/g, "-")}`;

  return (
    <section className="return-clinical-section" aria-labelledby={titleId}>
      <header className="return-section-heading">
        <div>
          <p className="eyebrow">PERIOD REVIEW</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        <span className="return-section-count mono">{events.length.toString().padStart(2, "0")}건</span>
      </header>
      <p className="return-section-helper">{helper}</p>
      {events.length ? (
        <div className="return-event-list">
          {events.map((event) => <EventRow key={event.id} event={event} onOpenEvidence={onOpenEvidence} />)}
        </div>
      ) : (
        <p className="return-section-empty">해당 구간 변화 없음</p>
      )}
    </section>
  );
}

function TimelineSection({
  events,
  onOpenEvidence,
}: {
  events: PeriodEvent[];
  onOpenEvidence: (eventId: string) => void;
}) {
  const orderedEvents = [...events].sort((left, right) => {
    const timeDifference = Date.parse(left.detectedAt) - Date.parse(right.detectedAt);
    return timeDifference || left.id.localeCompare(right.id);
  });
  const grouped = orderedEvents.reduce<Map<string, PeriodEvent[]>>((groups, event) => {
    const date = event.detectedAt.slice(0, 10);
    const day = groups.get(date) ?? [];
    day.push(event);
    groups.set(date, day);
    return groups;
  }, new Map());

  return (
    <section className="return-clinical-section return-timeline-section" aria-labelledby="return-section-timeline">
      <header className="return-section-heading">
        <div>
          <p className="eyebrow">EVENT INDEX</p>
          <h2 id="return-section-timeline">전체 타임라인</h2>
        </div>
        <span className="return-section-count mono">{orderedEvents.length.toString().padStart(2, "0")}건</span>
      </header>
      <p className="return-section-helper">날짜와 기록 시각 순서 · 각 행에서 이전·현재 값과 근거를 확인합니다.</p>
      {orderedEvents.length ? (
        <div className="return-timeline-list">
          {[...grouped.entries()].map(([date, dayEvents]) => (
            <section className="return-timeline-day" key={date} aria-labelledby={`return-day-${date}`}>
              <h3 id={`return-day-${date}`} className="return-timeline-date mono">{date}</h3>
              <ol>
                {dayEvents.map((event) => (
                  event.classification === "record_event" ? (
                    <li className="return-timeline-event" data-event-id={event.id} key={event.id}>
                      <EventRow event={event} onOpenEvidence={onOpenEvidence} />
                    </li>
                  ) : (
                    <li className="return-timeline-row" data-event-id={event.id} key={event.id}>
                      <div className="return-timeline-row-meta">
                        <time className="mono" dateTime={event.detectedAt} title={event.detectedAt}>{formatTimestamp(event.detectedAt)}</time>
                        <span className="return-event-category">{CATEGORY_LABELS[event.change.category]}</span>
                        <span className={`return-event-status return-event-status-${event.classification}`}>{classificationLabel(event.classification)}</span>
                      </div>
                      <div className="return-timeline-row-content">
                        <strong className="return-timeline-row-label">{event.change.label}</strong>
                        <div className="return-timeline-row-values" aria-label={`${event.change.label} 이전과 현재 값`}>
                          <span className="return-timeline-row-value">
                            <span>이전</span>
                            <strong className="mono">{formatValue(event.change.previousValue)}</strong>
                          </span>
                          <span className="return-timeline-row-arrow" aria-hidden="true">→</span>
                          <span className="return-timeline-row-value return-timeline-row-value-current">
                            <span>현재</span>
                            <strong className="mono">{formatValue(event.change.currentValue)}</strong>
                          </span>
                        </div>
                      </div>
                      <button type="button" className="return-evidence-button return-timeline-evidence-button" onClick={() => onOpenEvidence(event.id)}>
                        근거 보기
                      </button>
                    </li>
                  )
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <p className="return-section-empty">해당 기간에 검출된 변화가 없습니다.</p>
      )}
    </section>
  );
}

export function ReturnComparisonWorkspace({
  response,
  onOpenEvidence,
  loading = false,
  errorMessage = null,
  onRetry,
}: ReturnComparisonWorkspaceProps) {
  if (!response) {
    const role = errorMessage ? "alert" : "status";
    const message = loading ? "기간 비교를 불러오는 중입니다." : errorMessage ?? "기간 비교를 준비 중입니다.";
    return (
      <section className="comparison-panel panel return-comparison-workspace" data-testid="return-comparison-workspace" aria-labelledby="return-comparison-title">
        <header className="section-header comparison-header">
          <div>
            <p className="eyebrow">RETURN HANDOVER</p>
            <h2 id="return-comparison-title">복귀 인계</h2>
          </div>
        </header>
        <div className={`return-period-state return-status-banner ${errorMessage ? "return-error-banner" : ""}`} role={role} aria-label="기간 비교 상태" aria-live={role === "alert" ? "assertive" : "polite"}>
          {message}
          {errorMessage && onRetry ? <button type="button" onClick={onRetry}>다시 시도</button> : null}
        </div>
      </section>
    );
  }

  const eventsById = new Map(response.events.map((event) => [event.id, event]));
  const periodState = periodStatusLabel(response.period.status);
  const statusAnnouncement = createStatusAnnouncement(response.period.status, loading, errorMessage);

  return (
    <section
      className="comparison-panel panel return-comparison-workspace"
      data-testid="return-comparison-workspace"
      aria-labelledby="return-comparison-title"
      aria-busy={loading}
    >
      <header className="section-header comparison-header return-comparison-header">
        <div>
          <p className="eyebrow">RETURN HANDOVER · PERIOD EVENTS</p>
          <h2 id="return-comparison-title">복귀 기간 변화</h2>
        </div>
        <div className="return-period-count" aria-label="기간 사건 수">
          <span>{periodState}</span>
          <strong className="mono">{response.period.eventCount.toString().padStart(2, "0")}건</strong>
        </div>
      </header>

      {statusAnnouncement ? (
        <div
          className={`return-status-banner return-${statusAnnouncement.tone}-banner`}
          role={statusAnnouncement.role}
          aria-label="기간 비교 상태"
          aria-live={statusAnnouncement.role === "alert" ? "assertive" : "polite"}
        >
          <strong>{statusAnnouncement.title}</strong>
          <span>{statusAnnouncement.message}</span>
          {statusAnnouncement.role === "alert" && onRetry ? <button type="button" onClick={onRetry}>다시 시도</button> : null}
        </div>
      ) : null}

      <div className="return-clinical-sections">
        {SECTION_DEFINITIONS.slice(0, 3).map(({ key, title, helper }) => (
          <GroupSection
            key={key}
            title={title}
            helper={helper}
            items={response.reviewGroups[key]}
            eventsById={eventsById}
            onOpenEvidence={onOpenEvidence}
          />
        ))}
        <TimelineSection events={response.events} onOpenEvidence={onOpenEvidence} />
      </div>
    </section>
  );
}

export { formatValue as formatReturnHandoverValue };
