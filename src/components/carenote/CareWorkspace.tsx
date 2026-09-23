"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ShiftReadinessDomain,
  ShiftReadinessItem,
  ShiftReadinessResponse,
} from "@/lib/shift-readiness-contracts";
import { ChartingPanel } from "@/features/carenote-charting/ChartingPanel";
import { useCareReadiness } from "@/lib/carenote/useCareReadiness";
import { getReadinessEvidence } from "@/lib/carenote/evidence";
import {
  CARE_PATIENTS,
  VITAL_LABELS,
  buildCareEvidence,
  formatCareTime,
  getCareScenario,
  initialCareDraft,
  type CareScenario,
} from "@/lib/carenote/scenario";
import { appendSessionNote, projectSessionRecords } from "@/lib/carenote/session";
import type { CareDraft, CareEvidence, CareNote, CareNoteInput } from "@/lib/carenote/types";
import type { ShiftReadinessRecord } from "@/lib/demo-shift-readiness";
import styles from "./CareWorkspace.module.css";

export type CareModule = "readiness" | "records" | "charting";

export type CareWorkspaceProps = {
  initialModule?: CareModule;
};

type DomainFilter = "all" | ShiftReadinessDomain;
type StatusFilter = "all" | "new_result" | "scheduled_this_shift" | "pending_result" | "requests";

const MODULES: Array<{ id: CareModule; label: string }> = [
  { id: "readiness", label: "근무 준비" },
  { id: "records", label: "환자 기록" },
  { id: "charting", label: "간호기록" },
];

const DOMAIN_LABELS: Record<ShiftReadinessDomain, string> = {
  patient_status: "환자 상태",
  investigation: "검사",
  line_device: "라인·기기",
  medication: "투약",
  communication: "전달 요청",
};

const STATUS_LABELS: Record<ShiftReadinessItem["factStatus"], string> = {
  new_result: "새 결과",
  scheduled_this_shift: "이번 근무 일정",
  pending_result: "결과 대기",
  recent_change: "최근 변화",
  explicit_follow_up: "명시 요청",
};

const STATUS_TONES: Record<ShiftReadinessItem["factStatus"], string> = {
  new_result: styles.statusNew,
  scheduled_this_shift: styles.statusScheduled,
  pending_result: styles.statusPending,
  recent_change: styles.statusRecent,
  explicit_follow_up: styles.statusRequest,
};

const VITAL_ORDER = ["systolic", "diastolic", "heartrate", "saturation"];

const INVESTIGATION_STATUS_LABELS: Record<ShiftReadinessRecord["investigations"][number]["status"], string> = {
  ordered: "오더됨",
  scheduled: "예정",
  in_progress: "진행 중",
  resulted: "결과 기록",
  cancelled: "취소",
};

const DEVICE_STATUS_LABELS: Record<ShiftReadinessRecord["devices"][number]["status"], string> = {
  active: "유지 중",
  removal_ordered: "제거 지시",
  removed: "제거 기록",
};

const REQUEST_STATUS_LABELS: Record<ShiftReadinessRecord["handoffRequests"][number]["status"], string> = {
  open: "전달 요청",
  communicated: "전달 기록 있음",
  cancelled: "취소",
};

function patientSex(sex: string) {
  if (sex === "M") return "남성";
  if (sex === "F") return "여성";
  return sex || "성별 정보 없음";
}

function dateLabel(value: string | null | undefined, withDate = false) {
  if (!value) return "기록 없음";
  try {
    return formatCareTime(value, withDate);
  } catch {
    return "기록 없음";
  }
}

function formatReadinessDetail(value: string) {
  return value
    .replace(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))\b/g, (_, timestamp: string) => dateLabel(timestamp, true))
    .replace(/\bphysician_order\b/g, "의사 지시")
    .replace(/\bnursing_note\b/g, "간호메모")
    .replace(/\bin_progress\b/g, "진행 중")
    .replace(/\bresulted\b/g, "결과 기록")
    .replace(/\bopen\b/g, "열린 요청");
}

function statusText(status: ShiftReadinessResponse["status"] | "loading" | "error") {
  if (status === "loading") return "최신 결과를 확인하고 있습니다";
  if (status === "error") return "최신 결과를 불러오지 못했습니다";
  if (status === "no_baseline") return "비교할 기준 기록이 없습니다";
  if (status === "no_items") return "확인할 변화가 없습니다";
  if (status === "partial") return "일부 데이터만 확인했습니다";
  return "근무 준비 결과가 준비되었습니다";
}

function itemMatchesStatus(item: ShiftReadinessItem, status: StatusFilter) {
  if (status === "all") return true;
  if (status === "requests") return item.factStatus === "explicit_follow_up";
  return item.factStatus === status;
}

function itemMatchesDomain(item: ShiftReadinessItem, domain: DomainFilter) {
  return domain === "all" || item.domain === domain;
}

function latestRecord(records: readonly ShiftReadinessRecord[]) {
  return records.length ? records[records.length - 1] : null;
}

function icon(name: "arrow" | "search" | "close" | "external" | "pulse" | "chevron" | "check" | "back") {
  const paths: Record<string, string> = {
    arrow: "M5 12h13m-5-5 5 5-5 5",
    search: "m20 20-3.8-3.8m1.3-5.2a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
    close: "m6 6 12 12M18 6 6 18",
    external: "M14 5h5v5M19 5l-8 8M19 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4",
    pulse: "M3 12h3l2.2-6 3.5 12 2.3-6H21",
    chevron: "m9 18 6-6-6-6",
    check: "m5 12 4 4L19 6",
    back: "M19 12H5m6 6-6-6 6-6",
  };
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function PatientRail({
  patients,
  selectedPatientId,
  query,
  onQueryChange,
  onSelect,
}: {
  patients: typeof CARE_PATIENTS;
  selectedPatientId: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
}) {
  const filteredPatients = patients.filter((patient) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [patient.name, patient.id, patient.room, ...patient.diagnoses]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  return (
    <aside className={styles.patientRail} aria-label="환자 목록">
      <div className={styles.railHeading}>
        <div>
          <h2>환자 목록</h2>
        </div>
        <span className={styles.patientCount}>{patients.length}명</span>
      </div>
      <label className={styles.searchBox}>
        <span className={styles.srOnly}>환자 검색</span>
        {icon("search")}
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="이름, 병실, 환자 ID"
          type="search"
        />
      </label>
      <div className={styles.patientList}>
        {filteredPatients.map((patient) => {
          const selected = patient.id === selectedPatientId;
          return (
            <button
              className={`${styles.patientItem} ${selected ? styles.patientItemSelected : ""}`}
              key={patient.id}
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(patient.id)}
            >
              <span className={`${styles.patientAvatar} ${selected ? styles.patientAvatarSelected : ""}`} aria-hidden="true">
                {patient.name.slice(0, 1)}
              </span>
              <span className={styles.patientItemCopy}>
                <span className={styles.patientItemName}>{patient.name}</span>
                <span className={styles.patientItemMeta}>{patient.room}호 · {patient.id}</span>
              </span>
              {selected ? <span className={styles.activeDot} aria-label="현재 선택" /> : null}
            </button>
          );
        })}
        {!filteredPatients.length ? <p className={styles.noPatients}>검색 결과가 없습니다.</p> : null}
      </div>
      <p className={styles.syntheticNote}><span className={styles.syntheticDot} /> 합성 데이터 · 확인·메모는 새로고침 시 초기화</p>
    </aside>
  );
}

function PatientIdentity({ scenario }: { scenario: CareScenario }) {
  const { patient } = scenario;
  return (
    <section className={styles.identityBar} aria-label="선택 환자 정보">
      <div className={styles.identityMain}>
        <div className={styles.identityMarker} aria-hidden="true">{patient.name.slice(0, 1)}</div>
        <div>
          <div className={styles.identityEyebrow}>현재 선택 환자 <span className={styles.identityId}>{patient.id}</span></div>
          <h1>{patient.name}</h1>
        </div>
      </div>
      <div className={styles.identityFacts}>
        <span><strong>{patient.room}호</strong></span>
        <span>{patientSex(patient.sex)} · {patient.age}세</span>
        <span className={styles.diagnosisInline}>{patient.diagnoses.join(" · ") || "진단 정보 없음"}</span>
      </div>
    </section>
  );
}

function SnapshotStrip({ record, vitalRecordedAt }: { record: ShiftReadinessRecord | null; vitalRecordedAt: string | null }) {
  if (!record) return null;
  return (
    <section className={styles.snapshotStrip} aria-label="최근 스냅샷">
      <div className={styles.snapshotLead}>
        <span className={styles.snapshotPulse}>{icon("pulse")}</span>
        <span>
          <span className={styles.snapshotLabel}>최근 기록</span>
          <strong>{dateLabel(record.updated_at, true)}</strong>
        </span>
      </div>
      <div className={styles.vitalList}>
        {VITAL_ORDER.map((key) => {
          const meta = VITAL_LABELS[key];
          const value = record.vitals[key];
          if (!meta || value === undefined) return null;
          return (
            <span className={styles.vitalItem} key={key}>
              <span>{meta.label}</span>
              <strong>{value}<em>{meta.unit}</em></strong>
            </span>
          );
        })}
      </div>
      <span className={styles.snapshotSource}>원본 활력징후 · {dateLabel(vitalRecordedAt, true)}</span>
    </section>
  );
}

function ModuleTabs({ module, onChange }: { module: CareModule; onChange: (value: CareModule) => void }) {
  return (
    <nav className={styles.moduleTabs} aria-label="환자 모듈">
      {MODULES.map((item) => (
        <button
          className={`${styles.moduleTab} ${module === item.id ? styles.moduleTabActive : ""}`}
          key={item.id}
          type="button"
          aria-current={module === item.id ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function StatusBanner({
  response,
  status,
  stale,
  onRetry,
}: {
  response: ShiftReadinessResponse | null;
  status: "loading" | "success" | "error";
  stale: boolean;
  onRetry: () => void;
}) {
  const semanticStatus = status === "success" ? response?.status ?? "no_items" : status;
  return (
    <div className={`${styles.statusBanner} ${status === "error" ? styles.statusBannerError : ""} ${stale ? styles.statusBannerStale : ""}`} role={status === "error" ? "alert" : "status"}>
      <span className={styles.statusSignal} aria-hidden="true" />
      <div>
        <strong>{stale ? "이전 결과를 표시하고 있습니다" : statusText(semanticStatus)}</strong>
        <span>
          {stale
            ? "현재 기록에 새 메모가 반영되기 전입니다. 잠시 후 다시 확인해 주세요."
            : status === "error"
              ? "연결 상태를 확인한 뒤 다시 시도해 주세요."
              : response?.status === "partial"
                ? "일부 원본 구간이 비어 있어 확인 가능한 범위만 표시합니다."
                : response?.status === "no_baseline"
                  ? "선택한 기준 시각 이전의 원본 기록이 없어 기간 비교를 만들 수 없습니다."
                  : response?.dataWarnings?.[0] ?? "결과는 원본 기록의 현재 상태를 기준으로 합니다."}
        </span>
      </div>
      {status === "error" || stale ? <button type="button" onClick={onRetry}>다시 확인</button> : null}
    </div>
  );
}

function ReadinessFilters({
  response,
  statusFilter,
  domain,
  onStatusChange,
  onDomainChange,
}: {
  response: ShiftReadinessResponse | null;
  statusFilter: StatusFilter;
  domain: DomainFilter;
  onStatusChange: (value: StatusFilter) => void;
  onDomainChange: (value: DomainFilter) => void;
}) {
  const items = response?.items ?? [];
  const counts = {
    all: response?.metrics.itemCount ?? items.length,
    new_result: response?.metrics.newResultCount ?? items.filter((item) => item.factStatus === "new_result").length,
    scheduled_this_shift: response?.metrics.scheduledThisShiftCount ?? items.filter((item) => item.factStatus === "scheduled_this_shift").length,
    pending_result: response?.metrics.pendingResultCount ?? items.filter((item) => item.factStatus === "pending_result").length,
    requests: items.filter((item) => item.factStatus === "explicit_follow_up").length,
  } satisfies Record<StatusFilter, number>;
  const statuses: Array<{ id: StatusFilter; label: string }> = [
    { id: "all", label: "전체" },
    { id: "new_result", label: "새 결과" },
    { id: "scheduled_this_shift", label: "이번 근무 일정" },
    { id: "pending_result", label: "결과 대기" },
    { id: "requests", label: "전달 요청" },
  ];
  const domains: Array<{ id: DomainFilter; label: string; count: number }> = [
    { id: "all", label: "모든 영역", count: counts.all },
    ...Object.entries(DOMAIN_LABELS).map(([id, label]) => ({
      id: id as ShiftReadinessDomain,
      label,
      count: response?.metrics.domainCounts[id as ShiftReadinessDomain] ?? items.filter((item) => item.domain === id).length,
    })),
  ];
  return (
    <div className={styles.filters} aria-label="근무 준비 필터">
      <div className={styles.filterLine} role="group" aria-label="상태 필터">
        {statuses.map((item) => (
          <button
            className={`${styles.filterChip} ${statusFilter === item.id ? styles.filterChipActive : ""}`}
            key={item.id}
            type="button"
            aria-pressed={statusFilter === item.id}
            onClick={() => onStatusChange(item.id)}
          >
            {item.label}<span>{counts[item.id]}</span>
          </button>
        ))}
      </div>
      <div className={styles.filterLineSecondary} role="group" aria-label="영역 필터">
        <span className={styles.filterLabel}>영역</span>
        {domains.map((item) => (
          <button
            className={`${styles.domainChip} ${domain === item.id ? styles.domainChipActive : ""}`}
            key={item.id}
            type="button"
            aria-pressed={domain === item.id}
            onClick={() => onDomainChange(item.id)}
          >
            {item.label}<span>{item.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReadinessItemRow({
  item,
  read,
  onRead,
  onEvidence,
}: {
  item: ShiftReadinessItem;
  read: boolean;
  onRead: (id: string, checked: boolean) => void;
  onEvidence: (id: string, trigger: HTMLButtonElement) => void;
}) {
  return (
    <article className={`${styles.readinessRow} ${read ? styles.readinessRowRead : ""}`}>
      <span className={`${styles.itemStatus} ${STATUS_TONES[item.factStatus]}`} aria-hidden="true" />
      <div className={styles.itemBody}>
        <div className={styles.itemTopline}>
          <span className={styles.domainTag}>{DOMAIN_LABELS[item.domain]}</span>
          <span className={`${styles.statusTag} ${STATUS_TONES[item.factStatus]}`}>{STATUS_LABELS[item.factStatus]}</span>
          <span className={styles.itemTime}>{dateLabel(item.relevantAt, true)}</span>
        </div>
        <h3>{item.title}</h3>
        <p>{formatReadinessDetail(item.detail)}</p>
      </div>
      <div className={styles.itemActions}>
        <label className={styles.readCheck}>
          <input
            type="checkbox"
            checked={read}
            onChange={(event) => onRead(item.id, event.target.checked)}
          />
          <span className={styles.checkVisual}>{read ? icon("check") : null}</span>
          <span>확인</span>
        </label>
        <button
          className={styles.evidenceButton}
          type="button"
          onClick={(event) => onEvidence(item.id, event.currentTarget)}
          aria-label={`${item.title} 근거 ${item.sourceRefs.length}건 보기`}
        >
          근거 <strong>{item.sourceRefs.length}</strong>건 {icon("chevron")}
        </button>
      </div>
    </article>
  );
}

function ReadinessSection({
  title,
  items,
  readIds,
  onRead,
  onEvidence,
  collapsed = false,
  onToggle,
}: {
  title: string;
  items: ShiftReadinessItem[];
  readIds: Set<string>;
  onRead: (id: string, checked: boolean) => void;
  onEvidence: (id: string, trigger: HTMLButtonElement) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  if (!items.length) return null;
  return (
    <section className={`${styles.readinessSection} ${collapsed ? styles.readinessSectionCollapsed : ""}`} aria-labelledby={`section-${title}`}>
      <div className={styles.sectionHeading}>
        <div>
          <h2 id={`section-${title}`}>{title}<span>{items.length}</span></h2>
        </div>
        {onToggle ? (
          <button className={styles.collapseButton} type="button" onClick={onToggle} aria-expanded={!collapsed}>
            {collapsed ? "펼치기" : "접기"} {icon("chevron")}
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <div className={styles.readinessRows}>
          {items.map((item) => <ReadinessItemRow item={item} key={item.id} read={readIds.has(item.id)} onRead={onRead} onEvidence={onEvidence} />)}
        </div>
      ) : null}
    </section>
  );
}

function ReadinessMain({
  response,
  status,
  stale,
  reviewStartAt,
  reviewOptions,
  readIds,
  onReviewStartAtChange,
  onRetry,
  onOpenEvidence,
  onRead,
}: {
  response: ShiftReadinessResponse | null;
  status: "loading" | "success" | "error";
  stale: boolean;
  reviewStartAt: string;
  reviewOptions: Array<{ value: string; label: string }>;
  readIds: Set<string>;
  onReviewStartAtChange: (value: string) => void;
  onRetry: () => void;
  onOpenEvidence: (id: string, trigger: HTMLButtonElement) => void;
  onRead: (id: string, checked: boolean) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [domain, setDomain] = useState<DomainFilter>("all");
  const [showRecent, setShowRecent] = useState(false);
  const items = response?.items ?? [];
  const filtered = items.filter((item) => itemMatchesStatus(item, statusFilter) && itemMatchesDomain(item, domain));
  const primary = filtered.filter((item) => ["new_result", "scheduled_this_shift", "explicit_follow_up"].includes(item.factStatus));
  const pending = filtered.filter((item) => item.factStatus === "pending_result");
  const recent = filtered.filter((item) => item.factStatus === "recent_change");
  const showStatusBanner = status === "loading"
    || status === "error"
    || stale
    || response?.status === "partial"
    || response?.status === "no_baseline";

  return (
    <div className={styles.moduleContent}>
      <div className={styles.contentIntro}>
        <div>
          <h2>근무 준비</h2>
        </div>
          <div className={styles.introMetric} aria-label="확인 현황">
            <strong>{readIds.size}<span>/</span>{items.length}</strong>
            <span>확인 = 읽음</span>
          </div>
      </div>
      <div className={styles.reviewControl}>
        <div>
          <strong>비교 기준 시각</strong>
        </div>
        <select aria-label="비교 기준 시각" value={reviewStartAt} onChange={(event) => onReviewStartAtChange(event.target.value)}>
          {reviewOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      {showStatusBanner ? <StatusBanner response={response} status={status} stale={stale} onRetry={onRetry} /> : null}
      {response?.dataWarnings?.length ? (
        <div className={styles.warningStrip} role="note">
          <span className={styles.warningIcon}>!</span>
          <span>{response.dataWarnings.length}건의 원본 범위 안내</span>
          <span>{response.dataWarnings[0]}</span>
        </div>
      ) : null}
      <ReadinessFilters response={response} statusFilter={statusFilter} domain={domain} onStatusChange={setStatusFilter} onDomainChange={setDomain} />
      {status === "loading" && !response ? (
        <div className={styles.loadingPanel} aria-label="결과 불러오는 중">
          <span className={styles.loadingLine} /><span className={styles.loadingLine} /><span className={styles.loadingLineShort} />
          <p>원본 기록에서 이번 근무의 확인 항목을 구성하고 있습니다.</p>
        </div>
      ) : status === "error" && !response ? (
        <div className={styles.emptyPanel} role="alert">
          <span className={styles.emptyMark}>!</span>
          <h3>최신 결과를 불러오지 못했습니다</h3>
          <p>연결 상태를 확인한 뒤 다시 시도해 주세요. 현재 환자의 결과는 표시하지 않았습니다.</p>
          <button className={styles.retryButton} type="button" onClick={onRetry}>다시 확인</button>
        </div>
      ) : response?.status === "no_baseline" || response?.status === "no_items" || (!primary.length && !pending.length && !recent.length) ? (
        <div className={styles.emptyPanel}>
          <span className={styles.emptyMark}>—</span>
          <h3>{response?.status === "no_baseline" ? "비교 기준 기록이 없습니다" : "현재 필터에서 확인할 항목이 없습니다"}</h3>
          <p>{response?.status === "no_baseline" ? "기준 시각을 알 수 있는 원본 기록이 없어 변화 목록을 만들지 않았습니다." : "영역 또는 상태 필터를 바꾸면 다른 확인 항목을 볼 수 있습니다."}</p>
        </div>
      ) : (
        <>
          <ReadinessSection title="먼저 확인할 항목" items={primary} readIds={readIds} onRead={onRead} onEvidence={onOpenEvidence} />
          <ReadinessSection title="결과 대기" items={pending} readIds={readIds} onRead={onRead} onEvidence={onOpenEvidence} />
          <ReadinessSection title="최근 변화" items={recent} readIds={readIds} onRead={onRead} onEvidence={onOpenEvidence} collapsed={!showRecent} onToggle={() => setShowRecent((value) => !value)} />
        </>
      )}
    </div>
  );
}

function EvidenceRail({
  readinessItem,
  readinessEvidence,
  careEvidence,
  reviewMemo,
  onReviewMemoChange,
  onClose,
  headingRef,
}: {
  readinessItem: ShiftReadinessItem | null;
  readinessEvidence: Array<{ id: string; title: string; recordedAt: string; previousValue: string | null; currentValue: string; path: string }>;
  careEvidence: CareEvidence | null;
  reviewMemo: string;
  onReviewMemoChange: (value: string) => void;
  onClose: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  if (!readinessItem && !careEvidence) {
    return (
      <aside className={styles.evidenceRail} aria-label="근거 안내">
        <div className={styles.guidanceCard}>
          <h2>근거</h2>
          <p>항목에서 근거를 열면 원본 값을 확인합니다.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.evidenceRail} aria-label="선택한 근거">
      <div className={styles.evidencePanel}>
        <div className={styles.evidencePanelHeading}>
          <div>
            <h2 ref={headingRef} tabIndex={-1}>근거 상세</h2>
          </div>
          <button className={styles.closeButton} type="button" onClick={onClose} aria-label="근거 상세 닫기">{icon("close")}</button>
        </div>
        {readinessItem ? (
          <>
            <div className={styles.evidenceItemTitle}>
              <span className={`${styles.statusTag} ${STATUS_TONES[readinessItem.factStatus]}`}>{STATUS_LABELS[readinessItem.factStatus]}</span>
              <h3>{readinessItem.title}</h3>
              <p>{formatReadinessDetail(readinessItem.detail)}</p>
            </div>
            <div className={styles.traceList}>
              {readinessEvidence.length ? readinessEvidence.map((source) => (
                <div className={styles.traceCard} key={source.id}>
                  <div className={styles.traceHeading}>
                    <strong>{source.title}</strong>
                    <time dateTime={source.recordedAt}>{dateLabel(source.recordedAt, true)}</time>
                  </div>
                  <span className={styles.tracePath}>{source.path}</span>
                  <div className={styles.traceValues}>
                    <div><span>이전</span><strong>{source.previousValue ?? "기준 없음"}</strong></div>
                    <span className={styles.traceArrow}>→</span>
                    <div><span>현재</span><strong>{source.currentValue}</strong></div>
                  </div>
                </div>
              )) : (
                <p className={styles.traceEmpty}>선택한 경로의 비교 값을 찾지 못했습니다. 원본 기록의 표시 범위가 제한되어 있을 수 있습니다.</p>
              )}
            </div>
            <div className={styles.reviewMemo}>
              <label htmlFor="care-review-memo">
                <span className={styles.blockLabel}>검토 메모</span>
                <textarea
                  id="care-review-memo"
                  aria-label="검토 메모"
                  rows={3}
                  value={reviewMemo}
                  onChange={(event) => onReviewMemoChange(event.target.value)}
                  placeholder="이 항목의 검토 메모"
                />
              </label>
              <span className={styles.reviewMemoHint}>화면에만 남는 메모입니다.</span>
            </div>
          </>
        ) : careEvidence ? (
          <div className={styles.evidenceItemTitle}>
            <span className={`${styles.statusTag} ${styles.statusRequest}`}>{careEvidence.category}</span>
            <h3>{careEvidence.label}</h3>
            <p>{careEvidence.text}</p>
            <span className={styles.tracePath}>{dateLabel(careEvidence.recordedAt, true)} · 간호기록 근거</span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function RecordsView({ scenario, notes }: { scenario: CareScenario; notes: CareNote[] }) {
  const records = useMemo(() => projectSessionRecords(scenario, notes), [scenario, notes]);
  const [selectedAt, setSelectedAt] = useState<string | null>(null);
  const selected = records.find((record) => record.updated_at === selectedAt) ?? records[records.length - 1] ?? null;
  return (
    <div className={styles.moduleContent}>
      <div className={styles.contentIntro}>
        <div>
          <h2>환자 기록</h2>
        </div>
        <span className={styles.readonlyPill}>읽기 전용</span>
      </div>
      <div className={styles.recordsLayout}>
        <div className={styles.recordTimeline} aria-label="기록 시각 목록">
          <div className={styles.timelineHeading}><strong>{records.length}개 시점</strong></div>
          {records.map((record, index) => {
            const selectedRecord = selected?.updated_at === record.updated_at;
            const isSession = index >= scenario.records.length;
            return (
              <button className={`${styles.timelineItem} ${selectedRecord ? styles.timelineItemActive : ""}`} key={`${record.updated_at}-${index}`} type="button" onClick={() => setSelectedAt(record.updated_at)} aria-current={selectedRecord ? "true" : undefined}>
                <span className={styles.timelineDot} />
                <span><strong>{dateLabel(record.updated_at, true)}</strong><small>{isSession ? "이번 세션 추가" : index === records.length - 1 ? "현재 스냅샷" : "원본 스냅샷"}</small></span>
              </button>
            );
          })}
        </div>
        {selected ? <RecordSnapshot record={selected} session={selected.updated_at !== scenario.records.find((record) => record.updated_at === selected.updated_at)?.updated_at} /> : null}
      </div>
    </div>
  );
}

function RecordSnapshot({ record, session }: { record: ShiftReadinessRecord; session: boolean }) {
  return (
    <article className={styles.recordSnapshot} aria-label={`${dateLabel(record.updated_at, true)} 기록`}>
      <div className={styles.snapshotHeading}>
        <div><h3>{dateLabel(record.updated_at, true)}</h3></div>
        <span className={session ? styles.sessionPill : styles.originalPill}>{session ? "이번 세션 추가" : "원본 기록"}</span>
      </div>
      <div className={styles.snapshotGrid}>
        <section className={styles.recordBlock}><span className={styles.blockLabel}>활력징후</span><div className={styles.recordVitalGrid}>{Object.entries(record.vitals).map(([key, value]) => <div key={key}><span>{VITAL_LABELS[key]?.label ?? key}</span><strong>{value}<em>{VITAL_LABELS[key]?.unit ?? ""}</em></strong></div>)}</div></section>
        <section className={styles.recordBlock}><span className={styles.blockLabel}>진단</span><div className={styles.recordTags}>{record.diagnosis.length ? record.diagnosis.map((diagnosis) => <span key={diagnosis}>{diagnosis}</span>) : <span className={styles.mutedText}>기록 없음</span>}</div></section>
        <section className={styles.recordBlock}><span className={styles.blockLabel}>투약</span><ul className={styles.cleanList}>{record.medications.length ? record.medications.map((medication) => <li key={`${medication.name}-${medication.route}`}><strong>{medication.name}</strong><span>{medication.route} · {medication.frequency}</span></li>) : <li className={styles.mutedText}>기록 없음</li>}</ul></section>
        <section className={styles.recordBlock}><span className={styles.blockLabel}>간호메모</span><ul className={styles.cleanList}>{record.notes.length ? record.notes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>) : <li className={styles.mutedText}>기록 없음</li>}</ul></section>
        <section className={styles.recordBlock}><span className={styles.blockLabel}>검사</span><ul className={styles.cleanList}>{record.investigations.length ? record.investigations.map((investigation) => <li key={investigation.id}><strong>{investigation.name}</strong><span>{INVESTIGATION_STATUS_LABELS[investigation.status]}{investigation.scheduledAt ? ` · 예정 ${dateLabel(investigation.scheduledAt, true)}` : ""}{investigation.resultSummary ? ` · ${investigation.resultSummary}` : ""}</span></li>) : <li className={styles.mutedText}>기록 없음</li>}</ul></section>
        <section className={styles.recordBlock}><span className={styles.blockLabel}>라인·기기</span><ul className={styles.cleanList}>{record.devices.length ? record.devices.map((device) => <li key={device.id}><strong>{device.type} · {device.site}</strong><span>{DEVICE_STATUS_LABELS[device.status]}{device.changeDueAt ? ` · 교체 예정 ${dateLabel(device.changeDueAt, true)}` : ""}</span></li>) : <li className={styles.mutedText}>기록 없음</li>}</ul></section>
        <section className={styles.recordBlock}><span className={styles.blockLabel}>전달 요청</span><ul className={styles.cleanList}>{record.handoffRequests.length ? record.handoffRequests.map((request) => <li key={request.id}><strong>{request.topic}</strong><span>{REQUEST_STATUS_LABELS[request.status]}{request.dueBy ? ` · 기한 ${dateLabel(request.dueBy, true)}` : ""}</span></li>) : <li className={styles.mutedText}>기록 없음</li>}</ul></section>
      </div>
    </article>
  );
}

function ChartingView({
  scenario,
  evidence,
  notes,
  draft,
  onDraftChange,
  onAddNote,
  onOpenEvidence,
  errorMessage,
}: {
  scenario: CareScenario;
  evidence: CareEvidence[];
  notes: CareNote[];
  draft: CareDraft;
  onDraftChange: (draft: CareDraft) => void;
  onAddNote: (input: CareNoteInput) => void;
  onOpenEvidence: (id: string) => void;
  errorMessage: string | null;
}) {
  return (
    <div className={`${styles.moduleContent} ${styles.chartingContent}`}>
      {errorMessage ? <div className={styles.noteError} role="alert">{errorMessage}</div> : null}
      <div className={styles.chartingCard}>
        <ChartingPanel patient={scenario.patient} evidence={evidence} notes={notes} draft={draft} onDraftChange={onDraftChange} onAddNote={onAddNote} onOpenEvidence={onOpenEvidence} />
      </div>
    </div>
  );
}

export function CareWorkspace({ initialModule = "readiness" }: CareWorkspaceProps) {
  const [module, setModule] = useState<CareModule>(initialModule);
  const [selectedPatientId, setSelectedPatientId] = useState(CARE_PATIENTS[0]?.id ?? "");
  const [patientQuery, setPatientQuery] = useState("");
  const [notesByPatient, setNotesByPatient] = useState<Record<string, CareNote[]>>({});
  const [draftsByPatient, setDraftsByPatient] = useState<Record<string, CareDraft>>({});
  const [reviewStartsByPatient, setReviewStartsByPatient] = useState<Record<string, string>>({});
  const [readItemsByReviewKey, setReadItemsByReviewKey] = useState<Record<string, string[]>>({});
  const [reviewMemosByKey, setReviewMemosByKey] = useState<Record<string, string>>({});
  const [selectedReadinessItemId, setSelectedReadinessItemId] = useState<string | null>(null);
  const [selectedCareEvidenceId, setSelectedCareEvidenceId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const selectedEvidenceTrigger = useRef<HTMLButtonElement | null>(null);
  const evidenceHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const scenario = useMemo(() => getCareScenario(selectedPatientId), [selectedPatientId]);
  const notes = useMemo(() => notesByPatient[selectedPatientId] ?? [], [notesByPatient, selectedPatientId]);
  const draft = draftsByPatient[selectedPatientId] ?? initialCareDraft(scenario);
  const evidence = useMemo(() => buildCareEvidence(scenario, notes), [scenario, notes]);
  const reviewStartAt = reviewStartsByPatient[selectedPatientId] ?? scenario.reviewStartAt;
  const reviewOptions = useMemo(() => {
    const timestamps = [scenario.reviewStartAt, ...scenario.records.map((record) => record.updated_at)]
      .filter((value, index, values) => values.indexOf(value) === index)
      .filter((value) => value !== latestRecord(scenario.records)?.updated_at);
    return timestamps.map((value, index) => ({
      value,
      label: index === 0 && value === scenario.reviewStartAt
        ? `기본 기준 · ${dateLabel(value, true)}`
        : `원본 시점 · ${dateLabel(value, true)}`,
    }));
  }, [scenario]);
  const readiness = useCareReadiness(scenario, notes, reviewStartAt);
  const latest = latestRecord(readiness.records ?? scenario.records);
  const vitalRecordedAt = scenario.records.at(-1)?.updated_at ?? latest?.updated_at ?? null;
  const readIds = useMemo(() => new Set(readItemsByReviewKey[readiness.reviewKey] ?? []), [readItemsByReviewKey, readiness.reviewKey]);
  const selectedReadinessItem = readiness.response?.items.find((item) => item.id === selectedReadinessItemId) ?? null;
  const selectedCareEvidence = evidence.find((item) => item.id === selectedCareEvidenceId) ?? null;
  const reviewMemoKey = selectedReadinessItem ? `${readiness.reviewKey}:${selectedReadinessItem.id}` : null;
  const reviewMemo = reviewMemoKey ? reviewMemosByKey[reviewMemoKey] ?? "" : "";
  const readinessEvidence = useMemo(() => {
    if (!selectedReadinessItem) return [];
    try {
      return getReadinessEvidence(readiness.records ?? scenario.records, selectedReadinessItem);
    } catch {
      return [];
    }
  }, [readiness.records, scenario.records, selectedReadinessItem]);
  const showEvidenceRail = evidenceOpen || module === "charting";

  useEffect(() => {
    if (!evidenceOpen) return;
    const heading = evidenceHeadingRef.current;
    if (!heading) return;
    heading.focus();
    if (typeof window !== "undefined" && window.innerWidth < 1080 && typeof heading.scrollIntoView === "function") {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [evidenceOpen, selectedReadinessItemId, selectedCareEvidenceId]);

  function selectPatient(id: string) {
    if (id === selectedPatientId) return;
    setSelectedReadinessItemId(null);
    setSelectedCareEvidenceId(null);
    setEvidenceOpen(false);
    setNoteError(null);
    setSelectedPatientId(id);
    setPatientQuery("");
  }

  function setReviewStartAt(value: string) {
    setReviewStartsByPatient((current) => ({ ...current, [selectedPatientId]: value }));
  }

  function toggleRead(id: string, checked: boolean) {
    setReadItemsByReviewKey((current) => {
      const next = new Set(current[readiness.reviewKey] ?? []);
      if (checked) next.add(id);
      else next.delete(id);
      return { ...current, [readiness.reviewKey]: [...next] };
    });
  }

  function setReviewMemo(value: string) {
    if (!reviewMemoKey) return;
    setReviewMemosByKey((current) => ({ ...current, [reviewMemoKey]: value }));
  }

  function openReadinessEvidence(id: string, trigger: HTMLButtonElement) {
    selectedEvidenceTrigger.current = trigger;
    setSelectedReadinessItemId(id);
    setSelectedCareEvidenceId(null);
    setEvidenceOpen(true);
  }

  function openCareEvidence(id: string) {
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    selectedEvidenceTrigger.current = activeElement instanceof HTMLButtonElement ? activeElement : null;
    setSelectedReadinessItemId(null);
    setSelectedCareEvidenceId(id);
    setEvidenceOpen(true);
  }

  function closeEvidence() {
    setSelectedReadinessItemId(null);
    setSelectedCareEvidenceId(null);
    setEvidenceOpen(false);
    requestAnimationFrame(() => selectedEvidenceTrigger.current?.focus());
  }

  function changeDraft(nextDraft: CareDraft) {
    setDraftsByPatient((current) => ({ ...current, [selectedPatientId]: nextDraft }));
  }

  function addNote(input: CareNoteInput) {
    try {
      const nextNotes = appendSessionNote(scenario, notes, input);
      setNotesByPatient((current) => ({ ...current, [selectedPatientId]: nextNotes }));
      const nextRecords = projectSessionRecords(scenario, nextNotes);
      const nextRecordAt = nextRecords.at(-1)?.updated_at ?? scenario.records.at(-1)?.updated_at ?? input.recordedAt;
      const nextRecordMs = Date.parse(nextRecordAt);
      const shiftEndMs = Date.parse(scenario.shift.endsAt);
      const nextDraftAt = Number.isFinite(nextRecordMs) && Number.isFinite(shiftEndMs)
        ? new Date(Math.min(nextRecordMs + 60_000, shiftEndMs)).toISOString()
        : input.recordedAt;
      setDraftsByPatient((current) => ({
        ...current,
        [selectedPatientId]: { ...current[selectedPatientId] ?? initialCareDraft(scenario), text: "", recordedAt: nextDraftAt },
      }));
      setNoteError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "기록을 추가하지 못했습니다. 입력을 확인해 주세요.";
      setNoteError(message);
      // The charting editor owns its inline validation announcement. Re-throw so
      // it can keep the draft intact and announce the same failure locally.
      throw error;
    }
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="CareNote 홈">
          <span className={styles.brandMark}>{icon("pulse")}</span>
          <span><strong>CareNote</strong></span>
        </Link>
        <div className={styles.topbarMeta}>
          <span className={styles.wardLabel}><span className={styles.liveDot} /> 3병동 · 시연 근무</span>
          <span className={styles.topbarDivider} />
          <span>{dateLabel(scenario.shift.startsAt, true)}—{dateLabel(scenario.shift.endsAt)}</span>
          <Link className={styles.legacyLink} href="/handover">기존 인계 보기 {icon("external")}</Link>
        </div>
      </header>
      <div className={styles.appGrid}>
        <PatientRail patients={CARE_PATIENTS} selectedPatientId={selectedPatientId} query={patientQuery} onQueryChange={setPatientQuery} onSelect={selectPatient} />
        <main className={styles.mainArea}>
          <PatientIdentity scenario={scenario} />
          <SnapshotStrip record={latest} vitalRecordedAt={vitalRecordedAt} />
          <ModuleTabs module={module} onChange={(next) => {
            setModule(next);
            setSelectedReadinessItemId(null);
            setSelectedCareEvidenceId(null);
            setEvidenceOpen(false);
            if (next !== "charting") setNoteError(null);
          }} />
          <div className={styles.bodyGrid}>
            {module === "readiness" ? <ReadinessMain key={readiness.reviewKey} response={readiness.response} status={readiness.status} stale={readiness.stale} reviewStartAt={reviewStartAt} reviewOptions={reviewOptions} readIds={readIds} onReviewStartAtChange={setReviewStartAt} onRead={toggleRead} onRetry={readiness.retry} onOpenEvidence={openReadinessEvidence} /> : null}
            {module === "records" ? <RecordsView key={scenario.patient.id} scenario={scenario} notes={notes} /> : null}
            {module === "charting" ? <ChartingView scenario={scenario} evidence={evidence} notes={notes} draft={draft} onDraftChange={changeDraft} onAddNote={addNote} onOpenEvidence={openCareEvidence} errorMessage={noteError} /> : null}
            {showEvidenceRail ? <EvidenceRail readinessItem={selectedReadinessItem} readinessEvidence={readinessEvidence} careEvidence={selectedCareEvidence} reviewMemo={reviewMemo} onReviewMemoChange={setReviewMemo} onClose={closeEvidence} headingRef={evidenceHeadingRef} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

export default CareWorkspace;
