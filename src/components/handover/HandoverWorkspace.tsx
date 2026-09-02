"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HandoverApiResponse } from "@/lib/contracts";
import { comparePatientRecords, HandoverApiError, type HandoverRecord } from "@/lib/handover-api";
import type { DemoPatientRecord, DemoRecordPair } from "@/lib/demo-records";
import { getDemoTimeline } from "@/lib/demo-timelines";
import type { HandoverPeriodApiResponse } from "@/lib/handover-period-contracts";
import {
  buildShiftReadinessRecords,
  getDemoShiftWindow,
  type ShiftReadinessRecord,
} from "@/lib/demo-shift-readiness";
import type {
  ShiftReadinessItem,
  ShiftReadinessResponse,
  ShiftReadinessSourceRef,
} from "@/lib/shift-readiness-contracts";
import {
  emptyShiftReadinessReview,
  loadShiftReadinessReview,
  persistShiftReadinessReview,
  toggleAcknowledgedItem,
  type ShiftReadinessReview,
} from "@/lib/shift-readiness-review";
import {
  cloneDemoRecord,
  isDemoPatientRecord,
  loadRecordDrafts,
  persistRecordDraft,
  removeRecordDraft,
} from "@/lib/record-drafts";

import { ComparisonWorkspace } from "./ComparisonWorkspace";
import { ClinicalHeader } from "./ClinicalHeader";
import { PatientContextHeader } from "./PatientContextHeader";
import { PatientQueue, type PatientQueueProgress } from "./PatientQueue";
import { PatientRecordWorkspace } from "./PatientRecordWorkspace";
import { ReturnComparisonWorkspace } from "./ReturnComparisonWorkspace";
import { ReturnHandoverControls, type ReturnHandoverScope } from "./ReturnHandoverControls";
import { ReturnSummaryPanel } from "./ReturnSummaryPanel";
import { ShiftReadinessSummaryPanel } from "./ShiftReadinessSummaryPanel";
import { ShiftReadinessWorkspace } from "./ShiftReadinessWorkspace";
import { SummaryPanel } from "./SummaryPanel";
import {
  createCurrentRecordFingerprint,
  createReturnHandoverKey,
  useReturnHandover,
} from "./useReturnHandover";
import {
  MODES_BY_SCOPE,
  type WorkspaceMode,
  WorkspaceModeTabs,
} from "./WorkspaceModeTabs";
import {
  type ShiftReadinessHookInput,
  createShiftReadinessKey,
  useShiftReadinessRoster,
} from "./useShiftReadiness";

const API_FALLBACK_MESSAGE = "서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.";
const RECORD_COMPARE_ERROR = "비교하지 못했습니다. 기록을 확인한 뒤 다시 시도하세요.";
const RETURN_TIMESTAMP_ORDER_ERROR = "현재 기록 시각은 기간의 직전 기록보다 빠를 수 없습니다.";
const READINESS_EVIDENCE_NOT_FOUND = "근거를 찾을 수 없습니다";

export type HandoverRecordPair = {
  previous: HandoverRecord | null;
  current: HandoverRecord;
};

export type HandoverWorkspaceProps = {
  data: HandoverApiResponse[];
  recordPairs?: Readonly<Record<string, HandoverRecordPair>>;
};

type PatientReviewSession = {
  selectedEvidenceIds: string[];
  recommendation: string;
  sourceConfirmed: boolean;
  reviewed: boolean;
  focusedEvidenceId: string | null;
  focusRequestId: number;
};

type PatientReviewSessions = Record<string, PatientReviewSession>;
type PatientApiStatus = "pending" | "success" | "fallback" | "snapshot";
type PatientApiState = {
  pair: HandoverRecordPair;
  status: PatientApiStatus;
};

type ReturnEvidenceState = {
  eventId: string;
  patientId: string;
  pair: DemoRecordPair;
  editableCurrent: boolean;
  previousMode: Exclude<WorkspaceMode, "record">;
  readinessRecord: ShiftReadinessRecord | null;
  focusedSourcePath: string | null;
  focusRequestId: number;
};

type ReadinessBuild = {
  input: ShiftReadinessHookInput;
  records: DemoPatientRecord[];
  readinessRecords: ShiftReadinessRecord[];
  error: unknown | null;
};

type DirectSourceSelector = {
  collection: "investigations" | "devices" | "medications" | "handoffRequests";
  selector: "id" | "name";
  value: string;
};

type ReturnResultSnapshot = {
  response: HandoverPeriodApiResponse;
  records: DemoPatientRecord[];
};

const DEMO_IDENTITY_KEYS = ["patient_id", "name", "room_no", "age", "sex"] as const;

function hasSameDemoPatientIdentity(left: DemoPatientRecord, right: DemoPatientRecord) {
  return DEMO_IDENTITY_KEYS.every((key) => left[key] === right[key]);
}

function isCompleteDemoRecordPair(
  pair: HandoverRecordPair | undefined,
): pair is DemoRecordPair {
  if (!pair || !isDemoPatientRecord(pair.current)) return false;
  if (pair.previous === null) return true;
  return (
    isDemoPatientRecord(pair.previous) &&
    hasSameDemoPatientIdentity(pair.previous, pair.current)
  );
}

function createReviewSession(response: HandoverApiResponse): PatientReviewSession {
  return {
    selectedEvidenceIds: [...response.summary.evidenceIds],
    recommendation: "",
    sourceConfirmed: false,
    reviewed: false,
    focusedEvidenceId: null,
    focusRequestId: 0,
  };
}

function createReturnReviewSession(response: HandoverPeriodApiResponse): PatientReviewSession {
  return {
    selectedEvidenceIds: [...response.summary.evidenceIds],
    recommendation: "",
    sourceConfirmed: false,
    reviewed: false,
    focusedEvidenceId: null,
    focusRequestId: 0,
  };
}

function readDemoTimeline(patientId: string) {
  if (!patientId) return null;
  try {
    return getDemoTimeline(patientId);
  } catch {
    return null;
  }
}

function parseDirectSourceSelector(path: string | null | undefined): DirectSourceSelector | null {
  if (!path) return null;
  const match = path.match(/^(investigations|devices|medications|handoffRequests)\[(id|name)=([^\[\]]+)\]$/);
  if (!match) return null;
  const [, collection, selector, encodedValue] = match;
  if (
    !encodedValue ||
    (collection === "medications" && selector !== "name") ||
    (collection !== "medications" && selector !== "id")
  ) {
    return null;
  }

  let value: string;
  try {
    value = decodeURIComponent(encodedValue);
  } catch {
    return null;
  }
  if (!value.trim()) return null;
  const canonicalValue = encodeURIComponent(value).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  ));
  if (encodedValue !== canonicalValue) return null;

  return {
    collection: collection as DirectSourceSelector["collection"],
    selector: selector as DirectSourceSelector["selector"],
    value,
  };
}

function directSourcePath(
  collection: DirectSourceSelector["collection"],
  selector: DirectSourceSelector["selector"],
  value: string,
) {
  const encodedValue = encodeURIComponent(value).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  ));
  return `${collection}[${selector}=${encodedValue}]`;
}

function hasDirectReadinessSource(
  record: ShiftReadinessRecord,
  selector: DirectSourceSelector,
) {
  if (selector.collection === "investigations") {
    return record.investigations.some((item) => item.id === selector.value);
  }
  if (selector.collection === "devices") {
    return record.devices.some((item) => item.id === selector.value);
  }
  if (selector.collection === "medications") {
    return record.medications.some((item) => item.name === selector.value);
  }
  return record.handoffRequests.some((item) => item.id === selector.value);
}

function readinessSourceMatchesRecord(
  source: ShiftReadinessSourceRef,
  record: ShiftReadinessRecord,
) {
  const selector = parseDirectSourceSelector(source.path);
  return Boolean(
    selector &&
      record.updated_at === source.recordedAt &&
      source.path === directSourcePath(selector.collection, selector.selector, selector.value) &&
      hasDirectReadinessSource(record, selector),
  );
}

function readinessRecordAt(
  readinessRecords: readonly ShiftReadinessRecord[],
  recordedAt: string,
) {
  return readinessRecords.find((record) => record.updated_at === recordedAt) ?? null;
}

function readinessBuildForPatient(
  patientId: string,
  recordPairs: HandoverWorkspaceProps["recordPairs"],
  recordPairOverrides: Readonly<Record<string, DemoRecordPair>>,
  reviewStartAtOverride?: string,
): ReadinessBuild | null {
  const timeline = readDemoTimeline(patientId);
  if (!timeline) return null;

  const activePair = recordPairOverrides[patientId] ?? recordPairs?.[patientId];
  const candidateCurrent = isCompleteDemoRecordPair(activePair)
    ? activePair.current
    : timeline.snapshots.at(-1);
  if (!candidateCurrent) return null;

  const records = timeline.snapshots.map(cloneDemoRecord);
  if (
    isDemoPatientRecord(candidateCurrent) &&
    hasSameDemoPatientIdentity(candidateCurrent, records.at(-1)!)
  ) {
    records[records.length - 1] = cloneDemoRecord(candidateCurrent);
  }

  try {
    const readinessRecords = buildShiftReadinessRecords(patientId, records);
    const input: ShiftReadinessHookInput = {
      patientId,
      reviewStartAt: reviewStartAtOverride ?? timeline.defaultReturnStartAt,
      shift: getDemoShiftWindow(patientId),
      records: readinessRecords,
      coverageGaps: timeline.coverageGaps.map((gap) => ({ ...gap })),
      currentRecordFingerprint: createCurrentRecordFingerprint(candidateCurrent),
      enabled: true,
    };
    return { input, records, readinessRecords, error: null };
  } catch (error: unknown) {
    return {
      input: {
        patientId,
        reviewStartAt: reviewStartAtOverride ?? timeline.defaultReturnStartAt,
        shift: getDemoShiftWindow(patientId),
        records: [],
        coverageGaps: timeline.coverageGaps.map((gap) => ({ ...gap })),
        currentRecordFingerprint: createCurrentRecordFingerprint(candidateCurrent),
        enabled: true,
      },
      records,
      readinessRecords: [],
      error,
    };
  }
}

function hasOrderedReturnCurrentTimestamp(
  timeline: ReturnType<typeof readDemoTimeline>,
  timestamp: string,
) {
  const previousSnapshot = timeline?.snapshots.at(-2);
  if (!previousSnapshot) return true;

  const previousTime = Date.parse(previousSnapshot.updated_at);
  const currentTime = Date.parse(timestamp);
  return Number.isFinite(previousTime) && Number.isFinite(currentTime) && currentTime > previousTime;
}

export function HandoverWorkspace({ data, recordPairs }: HandoverWorkspaceProps) {
  const validResponses = useMemo(
    () => data.filter((response) => Boolean(response?.comparison?.patient?.id && response.comparison.patient.name)),
    [data],
  );
  const firstValidResponse = validResponses[0];
  const firstValidPatientId = firstValidResponse?.comparison.patient.id ?? "";
  const recordDraftHydrationRequired = Boolean(
    recordPairs && Object.values(recordPairs).some((pair) => isCompleteDemoRecordPair(pair)),
  );
  const [selectedPatientId, setSelectedPatientId] = useState(firstValidPatientId);
  const [searchTerm, setSearchTerm] = useState("");
  const [responseOverrides, setResponseOverrides] = useState<Record<string, HandoverApiResponse>>({});
  const [fallbackByPatient, setFallbackByPatient] = useState<Record<string, boolean>>({});
  const [apiStateByPatient, setApiStateByPatient] = useState<Record<string, PatientApiState>>({});
  const [recordPairOverrides, setRecordPairOverrides] = useState<Record<string, DemoRecordPair>>({});
  const [recordDraftsHydrated, setRecordDraftsHydrated] = useState(!recordDraftHydrationRequired);
  const [recordResetRequestId, setRecordResetRequestId] = useState(0);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("comparison");
  const [handoverScope, setHandoverScope] = useState<ReturnHandoverScope>("shift");
  const [modeByScope, setModeByScope] = useState<Record<ReturnHandoverScope, WorkspaceMode>>({
    shift: "comparison",
    return: "readiness",
  });
  const [returnStartAtByPatient, setReturnStartAtByPatient] = useState<Record<string, string>>({});
  const [returnResultsByPatient, setReturnResultsByPatient] = useState<Record<string, ReturnResultSnapshot>>({});
  const [returnSessions, setReturnSessions] = useState<PatientReviewSessions>({});
  const [returnAppliedKeys, setReturnAppliedKeys] = useState<Record<string, string>>({});
  const [readinessReviewsByPatient, setReadinessReviewsByPatient] = useState<Record<string, ShiftReadinessReview>>({});
  const [returnEvidenceState, setReturnEvidenceState] = useState<ReturnEvidenceState | null>(null);
  const [returnEvidenceError, setReturnEvidenceError] = useState<string | null>(null);
  const [recordDrawerBusy, setRecordDrawerBusy] = useState(false);
  const [recordDrawerError, setRecordDrawerError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PatientReviewSessions>({});
  const apiStateRef = useRef<Record<string, PatientApiState>>({});
  const sessionsRef = useRef<PatientReviewSessions>({});
  const returnAppliedKeysRef = useRef<Record<string, string>>({});
  const readinessReviewsRef = useRef<Record<string, ShiftReadinessReview>>({});
  const readinessAppliedKeysRef = useRef<Record<string, string>>({});
  const selectedPatientRef = useRef(firstValidPatientId);
  const recordDraftsLoadedRef = useRef(false);
  const recordDrawerBusyRef = useRef(false);
  const returnEvidenceFocusRef = useRef<string | null>(null);
  const returnEvidenceTriggerRef = useRef<HTMLElement | null>(null);
  const requestVersion = useRef(0);

  function nextRequestVersion() {
    requestVersion.current += 1;
    return requestVersion.current;
  }

  function isCurrentRequest(requestId: number, patientId: string) {
    return requestVersion.current === requestId && selectedPatientRef.current === patientId;
  }

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    returnAppliedKeysRef.current = returnAppliedKeys;
  }, [returnAppliedKeys]);

  useEffect(() => {
    readinessReviewsRef.current = readinessReviewsByPatient;
  }, [readinessReviewsByPatient]);

  const activePatientId = validResponses.some(
    (response) => response.comparison.patient.id === selectedPatientId,
  )
    ? selectedPatientId
    : firstValidPatientId;

  useEffect(() => {
    selectedPatientRef.current = activePatientId;
  }, [activePatientId]);
  const responses = validResponses.map(
    (response) => responseOverrides[response.comparison.patient.id] ?? response,
  );

  const readinessBuildsByPatient = useMemo(() => {
    const builds = new Map<string, ReadinessBuild>();
    if (!recordDraftsHydrated) return builds;
    for (const response of responses) {
      const patientId = response.comparison.patient.id;
      const build = readinessBuildForPatient(
        patientId,
        recordPairs,
        recordPairOverrides,
        returnStartAtByPatient[patientId],
      );
      if (build) builds.set(patientId, build);
    }
    return builds;
  }, [recordDraftsHydrated, recordPairOverrides, recordPairs, responses, returnStartAtByPatient]);
  const readinessInputs = useMemo(
    () => [...readinessBuildsByPatient.values()].map(({ input }) => input),
    [readinessBuildsByPatient],
  );
  const readinessRoster = useShiftReadinessRoster(
    readinessInputs,
    handoverScope === "return" && recordDraftsHydrated,
  );
  const readinessProgressByPatient = useMemo(() => {
    const progress = new Map<string, PatientQueueProgress>();
    if (handoverScope !== "return" || !recordDraftsHydrated) return progress;

    for (const response of responses) {
      const patientId = response.comparison.patient.id;
      const build = readinessBuildsByPatient.get(patientId);
      if (!build || build.error) {
        progress.set(patientId, { status: "error" });
        continue;
      }

      const entry = readinessRoster.entriesByPatient.get(patientId);
      if (!entry || entry.status === "loading" || entry.status === "idle") {
        progress.set(patientId, { status: "loading" });
        continue;
      }
      if (entry.status === "error" || !entry.response) {
        progress.set(patientId, { status: "error" });
        continue;
      }

      const total = entry.response.items.length;
      if (entry.response.status === "no_items") {
        progress.set(patientId, { status: "no_items" });
        continue;
      }
      const review = readinessReviewsByPatient[patientId] ?? emptyShiftReadinessReview();
      const itemIds = new Set(entry.response.items.map((item) => item.id));
      const acknowledged = review.acknowledgedItemIds.filter((itemId) => itemIds.has(itemId)).length;
      progress.set(patientId, {
        status: entry.response.status,
        acknowledged,
        total,
      });
    }
    return progress;
  }, [handoverScope, readinessBuildsByPatient, readinessReviewsByPatient, readinessRoster.entriesByPatient, recordDraftsHydrated, responses]);
  const selectedResponse = responses.find(
    ({ comparison }) => comparison.patient.id === activePatientId,
  ) ?? responses[0];
  const activeRecordPair = activePatientId
    ? recordPairOverrides[activePatientId] ?? recordPairs?.[activePatientId]
    : undefined;
  const activeRecordPairCurrent = activeRecordPair?.current;
  const activeRecordPairPrevious = activeRecordPair?.previous;
  const activeReturnTimeline = useMemo(() => readDemoTimeline(activePatientId), [activePatientId]);
  const returnRecords = useMemo(() => {
    if (!activeReturnTimeline) return [];

    const snapshots = activeReturnTimeline.snapshots.map(cloneDemoRecord);
    const hasCompleteActivePair =
      isDemoPatientRecord(activeRecordPairCurrent) &&
      (activeRecordPairPrevious === null ||
        (isDemoPatientRecord(activeRecordPairPrevious) &&
          hasSameDemoPatientIdentity(activeRecordPairPrevious, activeRecordPairCurrent)));
    if (hasCompleteActivePair && snapshots.length > 0) {
      snapshots[snapshots.length - 1] = cloneDemoRecord(activeRecordPairCurrent);
    }
    return snapshots;
  }, [activeRecordPairCurrent, activeRecordPairPrevious, activeReturnTimeline]);
  const returnStartAt = activePatientId
    ? returnStartAtByPatient[activePatientId] ?? activeReturnTimeline?.defaultReturnStartAt ?? ""
    : "";
  const returnCurrentRecord = returnRecords.at(-1);
  const returnCurrentRecordFingerprint = returnCurrentRecord
    ? createCurrentRecordFingerprint(returnCurrentRecord)
    : "";
  const returnCoverageGaps = activeReturnTimeline?.coverageGaps ?? [];
  const returnHandoverKey = createReturnHandoverKey(
    activePatientId,
    returnStartAt,
    returnCurrentRecordFingerprint,
  );
  const returnHandover = useReturnHandover({
    patientId: activePatientId,
    reviewStartAt: returnStartAt,
    records: returnRecords,
    coverageGaps: returnCoverageGaps,
    currentRecordFingerprint: returnCurrentRecordFingerprint,
    enabled: handoverScope === "return" && Boolean(activePatientId && returnStartAt && returnRecords.length),
  });

  useEffect(() => {
    if (
      handoverScope !== "return" ||
      !activePatientId ||
      returnHandover.status !== "success" ||
      !returnHandover.response ||
      returnHandover.response.patient.id !== activePatientId ||
      returnHandover.response.period.requestedStartAt !== returnStartAt ||
      (returnResultsByPatient[activePatientId] &&
        returnHandover.response === returnResultsByPatient[activePatientId].response &&
        returnAppliedKeysRef.current[activePatientId] !== returnHandoverKey) ||
      returnAppliedKeysRef.current[activePatientId] === returnHandoverKey
    ) {
      return;
    }

    const response = returnHandover.response;
    returnAppliedKeysRef.current = {
      ...returnAppliedKeysRef.current,
      [activePatientId]: returnHandoverKey,
    };
    setReturnAppliedKeys((current) => ({ ...current, [activePatientId]: returnHandoverKey }));
    setReturnResultsByPatient((current) => ({
      ...current,
      [activePatientId]: {
        response,
        records: returnRecords.map(cloneDemoRecord),
      },
    }));
    setReturnSessions((current) => ({
      ...current,
      [activePatientId]: createReturnReviewSession(response),
    }));
    setReturnEvidenceState(null);
    setReturnEvidenceError(null);
  }, [activePatientId, handoverScope, returnHandover.response, returnHandover.status, returnHandoverKey, returnRecords, returnResultsByPatient, returnStartAt]);

  useEffect(() => {
    if (handoverScope !== "return") return;

    const hydratedReviews: Record<string, ShiftReadinessReview> = {};
    let hasHydratedReview = false;
    for (const [patientId, build] of readinessBuildsByPatient) {
      const entry = readinessRoster.entriesByPatient.get(patientId);
      const currentRecord = build.readinessRecords.at(-1);
      const expectedKey = createShiftReadinessKey(
        build.input.patientId,
        build.input.reviewStartAt,
        build.input.shift,
        build.input.currentRecordFingerprint,
      );
      if (
        !entry ||
        entry.key !== expectedKey ||
        entry.status !== "success" ||
        !entry.response ||
        entry.response.patient.id !== patientId ||
        entry.response.reviewPeriod.requestedStartAt !== build.input.reviewStartAt ||
        entry.response.reviewPeriod.currentRecordedAt !== currentRecord?.updated_at
      ) {
        continue;
      }
      if (readinessAppliedKeysRef.current[patientId] === entry.key) continue;

      const itemIds = entry.response.items.map((item) => item.id);
      const review = typeof window === "undefined"
        ? emptyShiftReadinessReview()
        : loadShiftReadinessReview(window.sessionStorage, entry.key, itemIds);
      readinessAppliedKeysRef.current = {
        ...readinessAppliedKeysRef.current,
        [patientId]: entry.key,
      };
      hydratedReviews[patientId] = review;
      hasHydratedReview = true;
    }

    if (hasHydratedReview) {
      queueMicrotask(() => {
        setReadinessReviewsByPatient((current) => ({ ...current, ...hydratedReviews }));
      });
    }
  }, [handoverScope, readinessBuildsByPatient, readinessRoster.entriesByPatient]);

  function setPatientApiState(patientId: string, pair: HandoverRecordPair, status: PatientApiStatus) {
    const current = apiStateRef.current;
    const previous = current[patientId];
    if (previous?.pair === pair && previous.status === status) return;
    const next = { ...current, [patientId]: { pair, status } };
    apiStateRef.current = next;
    setApiStateByPatient(next);
  }

  function clearPendingApiState(patientId: string, pair: HandoverRecordPair) {
    const current = apiStateRef.current;
    const previous = current[patientId];
    if (previous?.pair !== pair || previous.status !== "pending") return;
    const next = { ...current };
    delete next[patientId];
    apiStateRef.current = next;
    setApiStateByPatient(next);
  }

  function clearApiPresentation(patientId: string) {
    setResponseOverrides((current) => {
      if (!(patientId in current)) return current;
      const next = { ...current };
      delete next[patientId];
      return next;
    });
    setFallbackByPatient((current) => {
      if (!(patientId in current)) return current;
      const next = { ...current };
      delete next[patientId];
      return next;
    });
  }

  useEffect(() => {
    if (recordDraftsLoadedRef.current) return;
    recordDraftsLoadedRef.current = true;
    if (!recordDraftHydrationRequired || typeof window === "undefined" || !recordPairs) return;

    const drafts = loadRecordDrafts(window.sessionStorage);
    const loadedOverrides: Record<string, DemoRecordPair> = {};
    for (const [patientId, draft] of Object.entries(drafts)) {
      const basePair = recordPairs[patientId];
      if (!isCompleteDemoRecordPair(basePair)) continue;
      if (!hasSameDemoPatientIdentity(basePair.current, draft)) continue;
      loadedOverrides[patientId] = {
        previous: basePair.previous ? cloneDemoRecord(basePair.previous) : null,
        current: cloneDemoRecord(draft),
      };
    }

    queueMicrotask(() => {
      nextRequestVersion();
      if (Object.keys(loadedOverrides).length > 0) {
        setRecordPairOverrides((current) => ({ ...current, ...loadedOverrides }));
      }
      setRecordDraftsHydrated(true);
    });
  }, [recordDraftHydrationRequired, recordPairs]);

  useEffect(() => {
    if (!recordDraftsHydrated) return undefined;
    const patientId = activePatientId;
    const pair = activeRecordPair;
    if (!pair) return undefined;

    const existingState = apiStateRef.current[patientId];
    if (sessionsRef.current[patientId]?.reviewed) {
      if (existingState?.pair !== pair || existingState.status !== "snapshot") {
        setPatientApiState(patientId, pair, "snapshot");
      }
      return undefined;
    }
    if (
      existingState?.pair === pair &&
      (existingState.status === "pending" ||
        existingState.status === "success" ||
        existingState.status === "fallback" ||
        existingState.status === "snapshot")
    ) {
      return undefined;
    }

    setPatientApiState(patientId, pair, "pending");
    clearApiPresentation(patientId);

    const controller = new AbortController();
    const requestId = nextRequestVersion();

    void comparePatientRecords(pair.previous, pair.current, controller.signal)
      .then((apiResponse) => {
        if (
          controller.signal.aborted ||
          !isCurrentRequest(requestId, patientId) ||
          sessionsRef.current[patientId]?.reviewed
        ) {
          return;
        }
        setResponseOverrides((current) => ({ ...current, [patientId]: apiResponse }));
        setFallbackByPatient((current) => ({ ...current, [patientId]: false }));
        setPatientApiState(patientId, pair, "success");
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          !isCurrentRequest(requestId, patientId) ||
          (error instanceof HandoverApiError && error.code === "ABORTED")
        ) {
          return;
        }
        setFallbackByPatient((current) => ({ ...current, [patientId]: true }));
        setPatientApiState(patientId, pair, "fallback");
      });

    return () => {
      controller.abort();
      clearPendingApiState(patientId, pair);
    };
  }, [activePatientId, activeRecordPair, recordDraftsHydrated, recordPairOverrides, recordPairs]);

  if (!selectedResponse) {
    return (
      <main className="workspace-empty" aria-labelledby="workspace-empty-title">
        <h1 id="workspace-empty-title">환자 비교 데이터가 없습니다.</h1>
        <p>읽기 전용 데모 응답을 확인할 수 없습니다.</p>
      </main>
    );
  }

  if (!recordDraftsHydrated) {
    return (
      <main className="workspace-empty" aria-labelledby="workspace-record-hydration-title">
        <h1 id="workspace-record-hydration-title">환자 기록을 불러오는 중입니다.</h1>
        <p>저장된 편집 기록을 확인하고 있습니다.</p>
        <p>서버 요약을 불러오는 중입니다.</p>
      </main>
    );
  }

  const patientId = selectedResponse.comparison.patient.id;
  const session = sessions[patientId] ?? createReviewSession(selectedResponse);
  const availableEvidenceIds = new Set(
    selectedResponse.comparison.changes.map((change) => change.id),
  );
  const selectedEvidenceIds = session.selectedEvidenceIds.filter((id) => availableEvidenceIds.has(id));
  const baseRecordPair = recordPairs?.[patientId];
  const activePair = recordPairOverrides[patientId] ?? baseRecordPair;
  const patientApiState = apiStateByPatient[patientId];
  const returnResult = returnResultsByPatient[patientId];
  const returnResponse = returnResult?.response;
  const returnResponseRecords = returnResult?.records ?? [];
  const activeReturnEvidence = returnEvidenceState?.patientId === patientId ? returnEvidenceState : null;
  const drawerPair = activeReturnEvidence?.pair ?? (isCompleteDemoRecordPair(activePair) ? activePair : null);
  const drawerEditableCurrent = activeReturnEvidence ? activeReturnEvidence.editableCurrent : true;
  const readinessBuild = readinessBuildsByPatient.get(patientId);
  const readinessEntry = readinessRoster.entriesByPatient.get(patientId);
  const readinessCurrentRecord = readinessBuild?.readinessRecords.at(-1) ?? null;
  const readinessExpectedKey = readinessBuild
    ? createShiftReadinessKey(
      readinessBuild.input.patientId,
      readinessBuild.input.reviewStartAt,
      readinessBuild.input.shift,
      readinessBuild.input.currentRecordFingerprint,
    )
    : null;
  const readinessEntryMatches = Boolean(
    readinessBuild &&
      readinessEntry &&
      readinessEntry.key === readinessExpectedKey &&
      readinessEntry.response &&
      readinessEntry.response.patient.id === patientId &&
      readinessEntry.response.reviewPeriod.requestedStartAt === readinessBuild.input.reviewStartAt &&
      readinessEntry.response.reviewPeriod.currentRecordedAt === readinessCurrentRecord?.updated_at,
  );
  const readinessResponse = readinessEntryMatches ? readinessEntry?.response ?? null : null;
  const readinessStatus = handoverScope === "return"
    ? readinessBuild?.error
      ? "error" as const
      : readinessEntryMatches
        ? readinessEntry?.status ?? "loading"
        : readinessEntry?.status === "error"
          ? "error" as const
        : "loading" as const
    : "idle" as const;
  const readinessErrorMessage = readinessBuild?.error || readinessStatus === "error"
    ? "근무 준비 정보를 불러오지 못했습니다."
    : returnEvidenceError;
  const readinessReview = readinessReviewsByPatient[patientId] ?? emptyShiftReadinessReview();
  const returnSession = returnSessions[patientId] ?? (returnResponse
    ? createReturnReviewSession(returnResponse)
    : {
      selectedEvidenceIds: [],
      recommendation: "",
      sourceConfirmed: false,
      reviewed: false,
      focusedEvidenceId: null,
      focusRequestId: 0,
    });
  const availableReturnEvidenceIds = new Set(returnResponse?.events.map((event) => event.id) ?? []);
  const selectedReturnEvidenceIds = returnSession.selectedEvidenceIds.filter((id) => availableReturnEvidenceIds.has(id));
  const returnControlsPending = !returnResponse || returnHandover.status === "loading";
  const apiPending = recordDrawerBusy || Boolean(
    activePair &&
      !session.reviewed &&
      (!patientApiState ||
        patientApiState.pair !== activePair ||
        (patientApiState.status !== "success" &&
          patientApiState.status !== "fallback" &&
          patientApiState.status !== "snapshot")),
  );
  const reviewedSessions = handoverScope === "return" ? returnSessions : sessions;
  const reviewedPatientIds = new Set(
    Object.entries(reviewedSessions)
      .filter(([, patientSession]) => patientSession.reviewed)
      .map(([id]) => id),
  );
  function updateSession(patientSession: PatientReviewSession) {
    setSessions((current) => ({ ...current, [patientId]: patientSession }));
  }

  function updateReturnSession(patientSession: PatientReviewSession) {
    setReturnSessions((current) => ({ ...current, [patientId]: patientSession }));
  }

  function updateReadinessReview(nextReview: ShiftReadinessReview) {
    if (
      !readinessEntryMatches ||
      readinessStatus !== "success" ||
      !readinessEntry?.response
    ) {
      return;
    }
    const next = {
      ...nextReview,
      acknowledgedItemIds: [...nextReview.acknowledgedItemIds],
    };
    readinessReviewsRef.current = { ...readinessReviewsRef.current, [patientId]: next };
    setReadinessReviewsByPatient((current) => ({ ...current, [patientId]: next }));
    if (typeof window !== "undefined") {
      persistShiftReadinessReview(window.sessionStorage, readinessEntry.key, next);
    }
  }

  function handleToggleReadinessItem(itemId: string) {
    updateReadinessReview(toggleAcknowledgedItem(readinessReview, itemId));
  }

  function handleReadinessNoteChange(manualHandoverNote: string) {
    updateReadinessReview({ ...readinessReview, manualHandoverNote });
  }

  function handleNavigateToReadinessItem(itemId: string) {
    if (typeof document === "undefined") return;
    document.getElementById(`shift-readiness-item-${itemId}`)?.focus();
  }

  function handleToggleEvidence(evidenceId: string) {
    if (session.reviewed || apiPending || !availableEvidenceIds.has(evidenceId)) return;
    const selected = new Set(session.selectedEvidenceIds);
    if (selected.has(evidenceId)) selected.delete(evidenceId);
    else selected.add(evidenceId);
    updateSession({ ...session, selectedEvidenceIds: [...selected] });
  }

  function handleRecommendationChange(recommendation: string) {
    if (session.reviewed || apiPending) return;
    updateSession({ ...session, recommendation });
  }

  function handleSourceConfirmedChange(sourceConfirmed: boolean) {
    if (session.reviewed || apiPending) return;
    updateSession({ ...session, sourceConfirmed });
  }

  function handleReviewComplete() {
    if (!session.sourceConfirmed || session.reviewed || apiPending) return;
    updateSession({ ...session, reviewed: true });
  }

  function handleReturnRecommendationChange(recommendation: string) {
    if (returnSession.reviewed || returnControlsPending) return;
    updateReturnSession({ ...returnSession, recommendation });
  }

  function handleReturnSourceConfirmedChange(sourceConfirmed: boolean) {
    if (returnSession.reviewed || returnControlsPending) return;
    updateReturnSession({ ...returnSession, sourceConfirmed });
  }

  function handleReturnReviewComplete() {
    if (!returnSession.sourceConfirmed || returnSession.reviewed || returnControlsPending) return;
    updateReturnSession({ ...returnSession, reviewed: true });
  }

  function handleToggleReturnEvidence(evidenceId: string) {
    if (returnSession.reviewed || returnControlsPending || !availableReturnEvidenceIds.has(evidenceId)) return;
    const selected = new Set(returnSession.selectedEvidenceIds);
    if (selected.has(evidenceId)) selected.delete(evidenceId);
    else selected.add(evidenceId);
    updateReturnSession({ ...returnSession, selectedEvidenceIds: [...selected] });
  }

  function focusReturnEvidence(eventId: string) {
    if (typeof document === "undefined") return;
    queueMicrotask(() => {
      const trigger = returnEvidenceTriggerRef.current;
      if (trigger?.isConnected) {
        trigger.focus();
        return;
      }
      document.getElementById(`return-evidence-${eventId}`)?.focus();
    });
  }

  function returnModeBeforeEvidence(): Exclude<WorkspaceMode, "record"> {
    if (workspaceMode === "readiness" || workspaceMode === "comparison") return workspaceMode;
    const savedMode = modeByScope.return;
    return savedMode === "comparison" ? "comparison" : "readiness";
  }

  function setRecordEvidenceState(nextState: Omit<ReturnEvidenceState, "focusRequestId">) {
    setReturnEvidenceState({
      ...nextState,
      focusRequestId: (returnEvidenceState?.focusRequestId ?? 0) + 1,
    });
    setWorkspaceMode("record");
  }

  function handleReturnEvidenceActivate(eventId: string) {
    const event = returnResponse?.events.find((candidate) => candidate.id === eventId);
    if (!returnResponse || !event) {
      setReturnEvidenceError("선택한 기간 사건의 근거를 찾지 못했습니다.");
      return;
    }

    const previous = returnResponseRecords.find((record) => record.updated_at === event.interval.previousRecordedAt);
    const current = returnResponseRecords.find((record) => record.updated_at === event.interval.currentRecordedAt);
    if (!previous || !current) {
      setReturnEvidenceError("정확한 원본 기록 구간을 찾지 못했습니다. 가까운 기록으로 대체하지 않았습니다.");
      return;
    }

    const periodSource = event.change.evidence;
    const sourceMatchesEvent =
      periodSource.fieldPath === event.change.evidence.fieldPath &&
      periodSource.currentRecordedAt === event.interval.currentRecordedAt &&
      (periodSource.previousRecordedAt === event.interval.previousRecordedAt ||
        periodSource.previousRecordedAt === null ||
        event.interval.previousRecordedAt === null);
    if (!sourceMatchesEvent) {
      setReturnEvidenceError(READINESS_EVIDENCE_NOT_FOUND);
      return;
    }

    returnEvidenceFocusRef.current = eventId;
    returnEvidenceTriggerRef.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setReturnEvidenceError(null);
    setRecordEvidenceState({
      eventId,
      patientId,
      pair: {
        previous: cloneDemoRecord(previous),
        current: cloneDemoRecord(current),
      },
      editableCurrent: current.updated_at === returnResponseRecords.at(-1)?.updated_at,
      previousMode: returnModeBeforeEvidence(),
      readinessRecord: null,
      focusedSourcePath: null,
    });
  }

  function handleReadinessEvidenceActivate(itemId: string, sourceIndex: number, trigger: HTMLElement) {
    returnEvidenceTriggerRef.current = trigger;
    returnEvidenceFocusRef.current = `readiness-${itemId}-${sourceIndex}`;
    const item = readinessResponse?.items.find((candidate) => candidate.id === itemId);
    const source = item?.sourceRefs[sourceIndex];
    const build = readinessBuild;
    const previousMode = returnModeBeforeEvidence();

    const fail = () => {
      setReturnEvidenceError(READINESS_EVIDENCE_NOT_FOUND);
      trigger.focus();
    };
    if (!item || !source || !build || !readinessResponse) {
      fail();
      return;
    }

    if (source.periodEventId) {
      const event = returnResponse?.events.find((candidate) => candidate.id === source.periodEventId);
      if (!event || event.change.evidence.fieldPath !== source.path) {
        fail();
        return;
      }
      if (
        event.change.evidence.currentRecordedAt !== event.interval.currentRecordedAt ||
        source.recordedAt !== event.interval.currentRecordedAt ||
        !event.interval.previousRecordedAt
      ) {
        fail();
        return;
      }
      const previous = returnResponseRecords.find((record) => record.updated_at === event.interval.previousRecordedAt);
      const current = returnResponseRecords.find((record) => record.updated_at === event.interval.currentRecordedAt);
      if (!previous || !current) {
        fail();
        return;
      }
      const readinessRecord = readinessRecordAt(build.readinessRecords, source.recordedAt);
      if (!readinessRecord) {
        fail();
        return;
      }
      setReturnEvidenceError(null);
      setRecordEvidenceState({
        eventId: event.id,
        patientId,
        pair: {
          previous: cloneDemoRecord(previous),
          current: cloneDemoRecord(current),
        },
        editableCurrent: false,
        previousMode,
        readinessRecord,
        focusedSourcePath: source.path,
      });
      return;
    }

    const selector = parseDirectSourceSelector(source.path);
    const readinessRecord = selector
      ? readinessRecordAt(build.readinessRecords, source.recordedAt)
      : null;
    const sourceIsExact = Boolean(
      selector &&
        readinessRecord &&
        readinessSourceMatchesRecord(source, readinessRecord),
    );
    if (!sourceIsExact || !readinessRecord) {
      fail();
      return;
    }

    const recordIndex = build.records.findIndex((record) => record.updated_at === source.recordedAt);
    const current = build.records[recordIndex];
    if (!current || current.updated_at !== readinessRecord.updated_at) {
      fail();
      return;
    }
    setReturnEvidenceError(null);
    setRecordEvidenceState({
      eventId: `readiness-${itemId}-${sourceIndex}`,
      patientId,
      pair: {
        previous: recordIndex > 0 ? cloneDemoRecord(build.records[recordIndex - 1]!) : null,
        current: cloneDemoRecord(current),
      },
      editableCurrent: false,
      previousMode,
      readinessRecord,
      focusedSourcePath: source.path,
    });
  }

  function handleReturnEvidenceClose() {
    const eventId = returnEvidenceState?.eventId ?? returnEvidenceFocusRef.current;
    const previousMode = returnEvidenceState?.previousMode ?? "comparison";
    setReturnEvidenceState(null);
    setReturnEvidenceError(null);
    setWorkspaceMode(previousMode);
    setModeByScope((current) => ({ ...current, return: previousMode }));
    if (eventId) focusReturnEvidence(eventId);
  }

  function handleWorkspaceModeChange(nextMode: WorkspaceMode) {
    if (!MODES_BY_SCOPE[handoverScope].includes(nextMode)) return;
    if (nextMode === "record" && !drawerPair) return;
    if (returnEvidenceState && nextMode !== "record") {
      const eventId = returnEvidenceState.eventId;
      setReturnEvidenceState(null);
      setReturnEvidenceError(null);
      setWorkspaceMode(nextMode);
      setModeByScope((current) => ({ ...current, return: nextMode }));
      focusReturnEvidence(eventId);
      return;
    }
    setWorkspaceMode(nextMode);
    setModeByScope((current) => ({ ...current, [handoverScope]: nextMode }));
  }

  function handleEvidenceActivate(evidenceId: string) {
    setWorkspaceMode("comparison");
    setModeByScope((current) => ({ ...current, shift: "comparison" }));
    updateSession({
      ...session,
      focusedEvidenceId: evidenceId,
      focusRequestId: session.focusRequestId + 1,
    });
  }

  async function handleRecordCompare(current: DemoPatientRecord) {
    if (recordDrawerBusyRef.current || !isCompleteDemoRecordPair(baseRecordPair)) return;
    if (current.patient_id !== patientId) return;
    if (handoverScope === "return" && !hasOrderedReturnCurrentTimestamp(activeReturnTimeline, current.updated_at)) {
      setRecordDrawerError(RETURN_TIMESTAMP_ORDER_ERROR);
      setWorkspaceMode("record");
      return;
    }

    recordDrawerBusyRef.current = true;
    setRecordDrawerBusy(true);
    setRecordDrawerError(null);
    const requestId = nextRequestVersion();
    const nextPair: DemoRecordPair = {
      previous: baseRecordPair.previous ? cloneDemoRecord(baseRecordPair.previous) : null,
      current: cloneDemoRecord(current),
    };

    try {
      const nextResponse = await comparePatientRecords(nextPair.previous, nextPair.current);
      if (!isCurrentRequest(requestId, patientId)) return;

      if (typeof window === "undefined") {
        throw new Error("브라우저 저장소를 사용할 수 없습니다.");
      }
      persistRecordDraft(window.sessionStorage, nextPair.current);
      setRecordPairOverrides((currentOverrides) => ({
        ...currentOverrides,
        [patientId]: nextPair,
      }));
      setResponseOverrides((currentResponses) => ({
        ...currentResponses,
        [patientId]: nextResponse,
      }));
      setFallbackByPatient((currentFallbacks) => {
        if (!(patientId in currentFallbacks)) return currentFallbacks;
        const nextFallbacks = { ...currentFallbacks };
        delete nextFallbacks[patientId];
        return nextFallbacks;
      });
      setPatientApiState(patientId, nextPair, "success");
      setSessions((currentSessions) => ({
        ...currentSessions,
        [patientId]: createReviewSession(nextResponse),
      }));
      setReturnEvidenceState(null);
      setReturnEvidenceError(null);
      setWorkspaceMode("comparison");
      setModeByScope((currentModes) => ({ ...currentModes, [handoverScope]: "comparison" }));
      setRecordDrawerError(null);
    } catch {
      if (!isCurrentRequest(requestId, patientId)) return;
      setPatientApiState(patientId, activePair, "snapshot");
      setRecordDrawerError(RECORD_COMPARE_ERROR);
      setWorkspaceMode("record");
    } finally {
      if (isCurrentRequest(requestId, patientId)) {
        recordDrawerBusyRef.current = false;
        setRecordDrawerBusy(false);
      }
    }
  }

  async function handleRecordReset() {
    if (recordDrawerBusyRef.current || !isCompleteDemoRecordPair(baseRecordPair)) return;
    recordDrawerBusyRef.current = true;
    setRecordDrawerBusy(true);
    setRecordDrawerError(null);
    const requestId = nextRequestVersion();

    try {
      const resetResponse = await comparePatientRecords(baseRecordPair.previous, baseRecordPair.current);
      if (!isCurrentRequest(requestId, patientId)) return;

      if (typeof window === "undefined") {
        throw new Error("브라우저 저장소를 사용할 수 없습니다.");
      }
      removeRecordDraft(window.sessionStorage, patientId);
      setRecordPairOverrides((currentOverrides) => {
        if (!(patientId in currentOverrides)) return currentOverrides;
        const nextOverrides = { ...currentOverrides };
        delete nextOverrides[patientId];
        return nextOverrides;
      });
      setResponseOverrides((currentResponses) => ({
        ...currentResponses,
        [patientId]: resetResponse,
      }));
      setFallbackByPatient((currentFallbacks) => {
        if (!(patientId in currentFallbacks)) return currentFallbacks;
        const nextFallbacks = { ...currentFallbacks };
        delete nextFallbacks[patientId];
        return nextFallbacks;
      });
      setPatientApiState(patientId, baseRecordPair, "success");
      setSessions((currentSessions) => ({
        ...currentSessions,
        [patientId]: createReviewSession(resetResponse),
      }));
      setReturnEvidenceState(null);
      setReturnEvidenceError(null);
      setRecordResetRequestId((current) => current + 1);
      setRecordDrawerError(null);
    } catch {
      if (!isCurrentRequest(requestId, patientId)) return;
      setPatientApiState(patientId, activePair, "snapshot");
      setRecordDrawerError(RECORD_COMPARE_ERROR);
    } finally {
      if (isCurrentRequest(requestId, patientId)) {
        recordDrawerBusyRef.current = false;
        setRecordDrawerBusy(false);
      }
    }
  }

  function handleSelectPatient(nextPatientId: string) {
    if (nextPatientId === patientId) return;
    nextRequestVersion();
    recordDrawerBusyRef.current = false;
    setRecordDrawerBusy(false);
    const nextMode = handoverScope === "return"
      ? modeByScope.return === "comparison" ? "comparison" : "readiness"
      : "comparison";
    setWorkspaceMode(nextMode);
    setRecordDrawerError(null);
    setReturnEvidenceState(null);
    setReturnEvidenceError(null);
    returnEvidenceTriggerRef.current = null;
    setSelectedPatientId(nextPatientId);
  }

  function handleScopeChange(nextScope: ReturnHandoverScope) {
    const savedMode = modeByScope[nextScope];
    const nextMode = MODES_BY_SCOPE[nextScope].includes(savedMode) &&
      (savedMode !== "record" || isCompleteDemoRecordPair(activePair))
      ? savedMode
      : nextScope === "return" ? "readiness" : "comparison";
    setHandoverScope(nextScope);
    setWorkspaceMode(nextMode);
    setModeByScope((current) => ({ ...current, [nextScope]: nextMode }));
    if (nextScope !== "return") {
      setReturnEvidenceState(null);
      setReturnEvidenceError(null);
      returnEvidenceTriggerRef.current = null;
    }
  }

  function handleReturnStartAtChange(nextStartAt: string) {
    setReturnStartAtByPatient((current) => ({
      ...current,
      [patientId]: nextStartAt,
    }));
    setReturnEvidenceState(null);
    setReturnEvidenceError(null);
    returnEvidenceTriggerRef.current = null;
  }

  return (
    <div className="app-shell">
      <ClinicalHeader currentRecordedAt={selectedResponse.comparison.interval.currentRecordedAt} />

      <div className="workspace-shell">
        <PatientQueue
          responses={responses}
          selectedPatientId={patientId}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onSelectPatient={handleSelectPatient}
          reviewedPatientIds={reviewedPatientIds}
          scope={handoverScope}
          mode={workspaceMode}
          reviewProgressByPatient={readinessProgressByPatient}
        />
        <main className="comparison-workspace">
          <PatientContextHeader
            comparison={selectedResponse.comparison}
            scope={handoverScope}
            period={handoverScope === "return" ? returnResponse?.period ?? null : null}
            requestedStartAt={handoverScope === "return" ? returnStartAt : null}
            periodCurrentCount={returnResponse?.reviewGroups.current.reduce((total, item) => total + item.eventIds.length, 0) ?? 0}
          />
          <ReturnHandoverControls
            scope={handoverScope}
            reviewStartAt={returnStartAt}
            availableStartTimes={activeReturnTimeline?.snapshots.map((snapshot) => snapshot.updated_at) ?? []}
            onScopeChange={handleScopeChange}
            onStartAtChange={handleReturnStartAtChange}
          />
          <WorkspaceModeTabs
            scope={handoverScope}
            mode={workspaceMode}
            recordAvailable={Boolean(drawerPair)}
            readinessPanelId="readiness-panel"
            comparisonPanelId="comparison-panel"
            recordPanelId="record-panel"
            onModeChange={handleWorkspaceModeChange}
          />
          {handoverScope === "return" ? (
            <section
              id="readiness-panel"
              role="tabpanel"
              aria-labelledby="readiness-tab"
              hidden={workspaceMode !== "readiness"}
            >
              <ShiftReadinessWorkspace
                response={readinessResponse}
                status={readinessStatus}
                acknowledgedItemIds={readinessReview.acknowledgedItemIds}
                errorMessage={readinessErrorMessage}
                onToggleAcknowledged={handleToggleReadinessItem}
                onOpenEvidence={handleReadinessEvidenceActivate}
                onRetry={() => readinessRoster.retry(patientId)}
              />
            </section>
          ) : null}
          <section
            id="comparison-panel"
            role="tabpanel"
            aria-labelledby="comparison-tab"
            hidden={workspaceMode !== "comparison"}
          >
            {handoverScope === "return" ? (
              <ReturnComparisonWorkspace
                response={returnResponse ?? null}
                loading={returnHandover.status === "loading"}
                errorMessage={returnEvidenceError ?? (returnHandover.status === "error" ? "기간 비교를 불러오지 못했습니다." : null)}
                onRetry={returnHandover.retry}
                onOpenEvidence={handleReturnEvidenceActivate}
              />
            ) : (
              <ComparisonWorkspace
                comparison={selectedResponse.comparison}
                focusedEvidenceId={session.focusedEvidenceId}
                focusRequestId={session.focusRequestId}
              />
            )}
          </section>
          {drawerPair ? (
            <section
              id="record-panel"
              role="tabpanel"
              aria-labelledby="record-tab"
              hidden={workspaceMode !== "record"}
            >
              <PatientRecordWorkspace
                pair={drawerPair}
                patientName={selectedResponse.comparison.patient.name}
                busy={recordDrawerBusy}
                errorMessage={recordDrawerError}
                resetRequestId={recordResetRequestId}
                editableCurrent={drawerEditableCurrent}
                onClose={activeReturnEvidence ? handleReturnEvidenceClose : undefined}
                onCompare={drawerEditableCurrent ? handleRecordCompare : undefined}
                onReset={drawerEditableCurrent ? handleRecordReset : undefined}
                readinessRecord={activeReturnEvidence?.readinessRecord ?? null}
                focusedSourcePath={activeReturnEvidence?.focusedSourcePath ?? null}
                focusRequestId={activeReturnEvidence?.focusRequestId ?? 0}
              />
            </section>
          ) : null}
        </main>
        {handoverScope === "return" && workspaceMode === "readiness" ? (
          <ShiftReadinessSummaryPanel
            response={readinessResponse}
            acknowledgedItemIds={readinessReview.acknowledgedItemIds}
            manualHandoverNote={readinessReview.manualHandoverNote}
            status={readinessStatus}
            errorMessage={readinessErrorMessage}
            onManualHandoverNoteChange={handleReadinessNoteChange}
            onNavigateToItem={handleNavigateToReadinessItem}
            onRetry={() => readinessRoster.retry(patientId)}
          />
        ) : handoverScope === "return" ? (
          <ReturnSummaryPanel
            response={returnResponse ?? null}
            selectedEvidenceIds={selectedReturnEvidenceIds}
            onToggleEvidence={handleToggleReturnEvidence}
            onEvidenceActivate={handleReturnEvidenceActivate}
            recommendation={returnSession.recommendation}
            onRecommendationChange={handleReturnRecommendationChange}
            sourceConfirmed={returnSession.sourceConfirmed}
            onSourceConfirmedChange={handleReturnSourceConfirmedChange}
            reviewed={returnSession.reviewed}
            onReviewComplete={handleReturnReviewComplete}
            status={returnHandover.status}
            errorMessage={returnHandover.status === "error" ? "기간 비교를 불러오지 못했습니다." : null}
            onRetry={returnHandover.retry}
          />
        ) : (
          <SummaryPanel
            comparison={selectedResponse.comparison}
            summary={selectedResponse.summary}
            selectedEvidenceIds={selectedEvidenceIds}
            onToggleEvidence={handleToggleEvidence}
            onEvidenceActivate={handleEvidenceActivate}
            recommendation={session.recommendation}
            onRecommendationChange={handleRecommendationChange}
            sourceConfirmed={session.sourceConfirmed}
            onSourceConfirmedChange={handleSourceConfirmedChange}
            reviewed={session.reviewed}
            onReviewComplete={handleReviewComplete}
            apiPending={apiPending}
            fallbackMessage={fallbackByPatient[patientId] ? API_FALLBACK_MESSAGE : null}
          />
        )}
      </div>
    </div>
  );
}
