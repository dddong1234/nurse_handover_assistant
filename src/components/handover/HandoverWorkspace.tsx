"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HandoverApiResponse } from "@/lib/contracts";
import { comparePatientRecords, HandoverApiError, type HandoverRecord } from "@/lib/handover-api";
import type { DemoPatientRecord, DemoRecordPair } from "@/lib/demo-records";
import { getDemoTimeline } from "@/lib/demo-timelines";
import type { HandoverPeriodApiResponse } from "@/lib/handover-period-contracts";
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
import { PatientQueue } from "./PatientQueue";
import { PatientRecordWorkspace } from "./PatientRecordWorkspace";
import { ReturnComparisonWorkspace } from "./ReturnComparisonWorkspace";
import { ReturnHandoverControls, type ReturnHandoverScope } from "./ReturnHandoverControls";
import { ReturnSummaryPanel } from "./ReturnSummaryPanel";
import { SummaryPanel } from "./SummaryPanel";
import {
  createCurrentRecordFingerprint,
  createReturnHandoverKey,
  useReturnHandover,
} from "./useReturnHandover";
import { type WorkspaceMode, WorkspaceModeTabs } from "./WorkspaceModeTabs";

const API_FALLBACK_MESSAGE = "서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.";
const RECORD_COMPARE_ERROR = "비교하지 못했습니다. 기록을 확인한 뒤 다시 시도하세요.";
const RETURN_TIMESTAMP_ORDER_ERROR = "현재 기록 시각은 기간의 직전 기록보다 빠를 수 없습니다.";

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
  const [returnStartAtByPatient, setReturnStartAtByPatient] = useState<Record<string, string>>({});
  const [returnResultsByPatient, setReturnResultsByPatient] = useState<Record<string, ReturnResultSnapshot>>({});
  const [returnSessions, setReturnSessions] = useState<PatientReviewSessions>({});
  const [returnAppliedKeys, setReturnAppliedKeys] = useState<Record<string, string>>({});
  const [returnEvidenceState, setReturnEvidenceState] = useState<ReturnEvidenceState | null>(null);
  const [returnEvidenceError, setReturnEvidenceError] = useState<string | null>(null);
  const [recordDrawerBusy, setRecordDrawerBusy] = useState(false);
  const [recordDrawerError, setRecordDrawerError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PatientReviewSessions>({});
  const apiStateRef = useRef<Record<string, PatientApiState>>({});
  const sessionsRef = useRef<PatientReviewSessions>({});
  const returnAppliedKeysRef = useRef<Record<string, string>>({});
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

    returnEvidenceFocusRef.current = eventId;
    returnEvidenceTriggerRef.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setReturnEvidenceError(null);
    setReturnEvidenceState({
      eventId,
      patientId,
      pair: {
        previous: cloneDemoRecord(previous),
        current: cloneDemoRecord(current),
      },
      editableCurrent: current.updated_at === returnResponseRecords.at(-1)?.updated_at,
    });
    setWorkspaceMode("record");
  }

  function handleReturnEvidenceClose() {
    const eventId = returnEvidenceState?.eventId ?? returnEvidenceFocusRef.current;
    setReturnEvidenceState(null);
    setReturnEvidenceError(null);
    setWorkspaceMode("comparison");
    if (eventId) focusReturnEvidence(eventId);
  }

  function handleWorkspaceModeChange(nextMode: WorkspaceMode) {
    if (nextMode === "comparison" && returnEvidenceState) {
      handleReturnEvidenceClose();
      return;
    }
    setWorkspaceMode(nextMode);
  }

  function handleEvidenceActivate(evidenceId: string) {
    setWorkspaceMode("comparison");
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
    setWorkspaceMode("comparison");
    setRecordDrawerError(null);
    setReturnEvidenceState(null);
    setReturnEvidenceError(null);
    returnEvidenceTriggerRef.current = null;
    setSelectedPatientId(nextPatientId);
  }

  function handleScopeChange(nextScope: ReturnHandoverScope) {
    setHandoverScope(nextScope);
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
            mode={workspaceMode}
            recordAvailable={Boolean(drawerPair)}
            comparisonPanelId="comparison-panel"
            recordPanelId="record-panel"
            onModeChange={handleWorkspaceModeChange}
          />
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
              />
            </section>
          ) : null}
        </main>
        {handoverScope === "return" ? (
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
