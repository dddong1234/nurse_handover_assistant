import type {
  ShiftReadinessDomain,
  ShiftReadinessFactStatus,
  ShiftReadinessGroups,
  ShiftReadinessItem,
  ShiftReadinessResponse,
} from "@/lib/shift-readiness-contracts";

import { formatTimestamp } from "./PatientContextHeader";

export type ShiftReadinessWorkspaceProps = {
  response: ShiftReadinessResponse | null;
  status: "idle" | "loading" | "success" | "error";
  acknowledgedItemIds: readonly string[];
  errorMessage?: string | null;
  onToggleAcknowledged(itemId: string): void;
  onOpenEvidence(itemId: string, sourceIndex: number, trigger: HTMLElement): void;
  onRetry(): void;
};

export const FACT_STATUS_LABELS: Record<ShiftReadinessFactStatus, string> = {
  new_result: "새 결과 있음",
  scheduled_this_shift: "이번 근무 예정",
  pending_result: "결과 대기",
  recent_change: "최근 변경",
  explicit_follow_up: "명시된 전달 요청",
};

type DomainDefinition = {
  domain: ShiftReadinessDomain;
  groupKey: keyof ShiftReadinessGroups;
  title: string;
  helper: string;
};

const DOMAIN_DEFINITIONS: readonly DomainDefinition[] = [
  {
    domain: "patient_status",
    groupKey: "patientStatus",
    title: "환자 상태",
    helper: "기간 중 기록된 환자 상태 항목",
  },
  {
    domain: "investigation",
    groupKey: "investigations",
    title: "검사·결과",
    helper: "검사 일정과 기록된 결과",
  },
  {
    domain: "line_device",
    groupKey: "lineDevices",
    title: "Line·Device",
    helper: "Line과 Device의 기록 및 예정 시각",
  },
  {
    domain: "medication",
    groupKey: "medications",
    title: "투약 변경",
    helper: "이번 근무에 적용되는 투약 기록",
  },
  {
    domain: "communication",
    groupKey: "communications",
    title: "보고·확인",
    helper: "구조화된 명시적 전달 요청",
  },
];

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
      message: "기준 기록이 없어 현재 기록에서 확인 가능한 항목만 표시합니다.",
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
        : "일부 데이터 공백이 있어 확인 가능한 항목만 표시합니다.",
    };
  }
  return null;
}

function createRequestAnnouncement(
  status: ShiftReadinessWorkspaceProps["status"],
  response: ShiftReadinessResponse | null,
  errorMessage: string | null | undefined,
): StatusAnnouncement | null {
  if (errorMessage || status === "error") {
    return {
      role: "alert",
      tone: "error",
      title: "근무 준비",
      message: errorMessage ?? "근무 준비 정보를 불러오지 못했습니다.",
    };
  }
  if (status === "loading") {
    return {
      role: "status",
      tone: "loading",
      title: "근무 준비",
      message: response
        ? "새 근무 준비 결과를 불러오는 중입니다. 현재 표시된 결과는 유지됩니다."
        : "근무 준비 정보를 불러오는 중입니다.",
    };
  }
  if (!response) {
    return {
      role: "status",
      tone: "state",
      title: "근무 준비",
      message: "근무 준비 정보를 준비 중입니다.",
    };
  }
  return null;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function formatItemTime(item: ShiftReadinessItem): string {
  return formatTimestamp(item.relevantAt ?? item.sourceRefs[0]?.recordedAt ?? null);
}

function itemDomId(itemId: string): string {
  return `shift-readiness-item-${itemId}`;
}

function itemTitleDomId(itemId: string): string {
  return `shift-readiness-item-title-${itemId}`;
}

function itemIdsByGroup(response: ShiftReadinessResponse): {
  itemsById: ReadonlyMap<string, ShiftReadinessItem>;
  errors: string[];
} {
  const itemsById = new Map(response.items.map((item) => [item.id, item]));
  const membership = new Map<string, number>();
  const errors: string[] = [];

  for (const definition of DOMAIN_DEFINITIONS) {
    for (const itemId of response.groups[definition.groupKey]) {
      const item = itemsById.get(itemId);
      if (!item) {
        errors.push(`알 수 없는 항목 ID: ${itemId}`);
        continue;
      }
      membership.set(itemId, (membership.get(itemId) ?? 0) + 1);
      if (item.domain !== definition.domain) {
        errors.push(`${itemId} 항목의 도메인 연결이 올바르지 않습니다.`);
      }
    }
  }

  for (const [itemId, count] of membership) {
    if (count !== 1) errors.push(`${itemId} 항목이 여러 도메인에 연결되었습니다.`);
  }
  for (const item of response.items) {
    if (!membership.has(item.id)) errors.push(`${item.id} 항목이 도메인에 연결되지 않았습니다.`);
  }

  return { itemsById, errors: uniqueStrings(errors) };
}

function ItemRow({
  item,
  acknowledged,
  onToggleAcknowledged,
  onOpenEvidence,
}: {
  item: ShiftReadinessItem;
  acknowledged: boolean;
  onToggleAcknowledged: (itemId: string) => void;
  onOpenEvidence: (itemId: string, sourceIndex: number, trigger: HTMLElement) => void;
}) {
  const titleId = itemTitleDomId(item.id);

  return (
    <article
      id={itemDomId(item.id)}
      className="shift-readiness-item"
      data-item-id={item.id}
      data-domain={item.domain}
      data-fact-status={item.factStatus}
      aria-labelledby={titleId}
    >
      <div className="shift-readiness-item-time-block">
        <time
          className="shift-readiness-item-time mono"
          dateTime={item.relevantAt ?? item.sourceRefs[0]?.recordedAt ?? undefined}
          title={item.relevantAt ?? item.sourceRefs[0]?.recordedAt ?? undefined}
        >
          {formatItemTime(item)}
        </time>
        <span className="shift-readiness-item-time-label">관련 시각</span>
      </div>

      <div className="shift-readiness-item-content">
        <h4 id={titleId} data-testid="shift-readiness-item-title">{item.title}</h4>
        <p className="shift-readiness-item-detail">{item.detail}</p>
      </div>

      <span
        className={`shift-readiness-fact-status shift-readiness-fact-status-${item.factStatus}`}
        data-fact-status-label={item.factStatus}
        aria-label={`사실 상태: ${FACT_STATUS_LABELS[item.factStatus]}`}
      >
        {FACT_STATUS_LABELS[item.factStatus]}
      </span>

      <label className={`shift-readiness-acknowledgement ${acknowledged ? "is-acknowledged" : ""}`}>
        <input
          id={`shift-readiness-ack-${item.id}`}
          type="checkbox"
          checked={acknowledged}
          aria-label={`${item.title} 확인함`}
          onChange={() => onToggleAcknowledged(item.id)}
        />
        <span aria-hidden="true" className="shift-readiness-checkbox-mark">✓</span>
        <span>확인함</span>
      </label>

      <div className="shift-readiness-evidence" aria-label={`${item.title} 연결된 근거`}>
        <span className="shift-readiness-source-count">근거 {item.sourceRefs.length}건</span>
        <div className="shift-readiness-evidence-controls">
          {item.sourceRefs.map((source, sourceIndex) => (
            <button
              key={`${item.id}-source-${sourceIndex}`}
              id={`shift-readiness-evidence-${item.id}-${sourceIndex}`}
              type="button"
              className="shift-readiness-evidence-button"
              data-evidence-button="true"
              data-source-index={sourceIndex}
              title={source.label}
              aria-label={`${item.title} 근거 보기 ${sourceIndex + 1}`}
              onClick={(event) => onOpenEvidence(item.id, sourceIndex, event.currentTarget)}
            >
              근거 보기{item.sourceRefs.length > 1 ? ` ${sourceIndex + 1}` : ""}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

function DomainSection({
  definition,
  itemIds,
  itemsById,
  acknowledgedItemIds,
  onToggleAcknowledged,
  onOpenEvidence,
}: {
  definition: DomainDefinition;
  itemIds: readonly string[];
  itemsById: ReadonlyMap<string, ShiftReadinessItem>;
  acknowledgedItemIds: ReadonlySet<string>;
  onToggleAcknowledged: (itemId: string) => void;
  onOpenEvidence: (itemId: string, sourceIndex: number, trigger: HTMLElement) => void;
}) {
  const titleId = `shift-readiness-domain-title-${definition.domain}`;
  const knownItems = itemIds.flatMap((itemId) => {
    const item = itemsById.get(itemId);
    return item && item.domain === definition.domain ? [item] : [];
  });

  return (
    <section
      className={`shift-readiness-domain shift-readiness-domain-${definition.domain}`}
      data-domain={definition.domain}
      aria-labelledby={titleId}
      role="region"
    >
      <header className="shift-readiness-domain-header">
        <div>
          <p className="eyebrow">SHIFT READINESS</p>
          <h3 id={titleId} aria-label={`${definition.title} · ${knownItems.length}건`}>{definition.title}</h3>
          <p className="shift-readiness-domain-helper">{definition.helper}</p>
        </div>
        <span className="shift-readiness-domain-count mono" aria-label={`${definition.title} 항목 수 ${knownItems.length}건`}>
          {knownItems.length}건
        </span>
      </header>

      {knownItems.length ? (
        <div className="shift-readiness-item-list">
          {knownItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              acknowledged={acknowledgedItemIds.has(item.id)}
              onToggleAcknowledged={onToggleAcknowledged}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </div>
      ) : (
        <p className="shift-readiness-domain-empty">이번 근무에 표시할 항목 없음</p>
      )}
    </section>
  );
}

export function ShiftReadinessWorkspace({
  response,
  status,
  acknowledgedItemIds,
  errorMessage = null,
  onToggleAcknowledged,
  onOpenEvidence,
  onRetry,
}: ShiftReadinessWorkspaceProps) {
  const announcement = createRequestAnnouncement(status, response, errorMessage);
  const responseAnnouncement = response ? responseStatusAnnouncement(response) : null;
  const acknowledged = new Set(acknowledgedItemIds);
  const resolved = response ? itemIdsByGroup(response) : { itemsById: new Map<string, ShiftReadinessItem>(), errors: [] };

  return (
    <section
      className="shift-readiness-workspace panel"
      data-testid="shift-readiness-workspace"
      data-shift-readiness-status={response?.status ?? status}
      role="region"
      aria-labelledby="shift-readiness-title"
      aria-busy={status === "loading"}
    >
      <header className="shift-readiness-workspace-header">
        <div>
          <p className="eyebrow">TASK FIRST · SHIFT READINESS</p>
          <h2 id="shift-readiness-title">근무 준비</h2>
          <p className="shift-readiness-workspace-helper">환자 상태부터 명시된 전달 요청까지 기록된 항목을 순서대로 확인합니다.</p>
        </div>
        {response ? (
          <div className="shift-readiness-item-total" aria-label="전체 근무 준비 항목 수">
            <span>전체 항목</span>
            <strong className="mono">{response.metrics.itemCount}건</strong>
          </div>
        ) : null}
      </header>

      {announcement ? (
        <div
          className={`shift-readiness-status shift-readiness-status-${announcement.tone}`}
          role={announcement.role}
          aria-label={announcement.role === "alert" ? "근무 준비 오류" : "근무 준비 상태"}
          aria-live={announcement.role === "alert" ? "assertive" : "polite"}
        >
          <strong>{announcement.title}</strong>
          <span>{announcement.message}</span>
          {announcement.role === "alert" ? (
            <button type="button" className="shift-readiness-retry" onClick={onRetry}>다시 시도</button>
          ) : null}
        </div>
      ) : null}

      {responseAnnouncement ? (
        <div
          className={`shift-readiness-status shift-readiness-status-${responseAnnouncement.tone}`}
          role={responseAnnouncement.role}
          aria-label="응답 상태"
          aria-live="polite"
        >
          <strong>{responseAnnouncement.title}</strong>
          <span>{responseAnnouncement.message}</span>
        </div>
      ) : null}

      {resolved.errors.length ? (
        <div className="shift-readiness-contract-error" role="alert" aria-label="응답 계약 오류">
          <strong>응답 계약 오류</strong>
          <span>{resolved.errors.join(" ")}</span>
        </div>
      ) : null}

      {response ? (
        <div className="shift-readiness-domain-list">
          {DOMAIN_DEFINITIONS.map((definition) => (
            <DomainSection
              key={definition.domain}
              definition={definition}
              itemIds={response.groups[definition.groupKey]}
              itemsById={resolved.itemsById}
              acknowledgedItemIds={acknowledged}
              onToggleAcknowledged={onToggleAcknowledged}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </div>
      ) : (
        <div className="shift-readiness-no-response">
          <p>{status === "loading" ? "근무 준비 정보를 불러오는 중입니다." : status === "error" ? "현재 근무 준비 항목을 표시할 수 없습니다." : "근무 준비 정보를 준비 중입니다."}</p>
        </div>
      )}
    </section>
  );
}
