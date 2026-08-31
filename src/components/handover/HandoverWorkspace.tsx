"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HandoverApiResponse } from "@/lib/contracts";
import { comparePatientRecords, HandoverApiError, type HandoverRecord } from "@/lib/handover-api";
import type { DemoPatientRecord, DemoRecordPair } from "@/lib/demo-records";
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
import { SummaryPanel } from "./SummaryPanel";
import { type WorkspaceMode, WorkspaceModeTabs } from "./WorkspaceModeTabs";

const API_FALLBACK_MESSAGE = "서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.";
const RECORD_COMPARE_ERROR = "비교하지 못했습니다. 기록을 확인한 뒤 다시 시도하세요.";

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
  const [recordDrawerBusy, setRecordDrawerBusy] = useState(false);
  const [recordDrawerError, setRecordDrawerError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PatientReviewSessions>({});
  const apiStateRef = useRef<Record<string, PatientApiState>>({});
  const sessionsRef = useRef<PatientReviewSessions>({});
  const selectedPatientRef = useRef(firstValidPatientId);
  const recordDraftsLoadedRef = useRef(false);
  const recordDrawerBusyRef = useRef(false);
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
  const drawerPair = isCompleteDemoRecordPair(activePair) ? activePair : null;
  const patientApiState = apiStateByPatient[patientId];
  const apiPending = recordDrawerBusy || Boolean(
    activePair &&
      !session.reviewed &&
      (!patientApiState ||
        patientApiState.pair !== activePair ||
        (patientApiState.status !== "success" &&
          patientApiState.status !== "fallback" &&
          patientApiState.status !== "snapshot")),
  );
  const reviewedPatientIds = new Set(
    Object.entries(sessions)
      .filter(([, patientSession]) => patientSession.reviewed)
      .map(([id]) => id),
  );

  function updateSession(patientSession: PatientReviewSession) {
    setSessions((current) => ({ ...current, [patientId]: patientSession }));
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
    setSelectedPatientId(nextPatientId);
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
        <main className="comparison-workspace" aria-live="polite">
          <PatientContextHeader comparison={selectedResponse.comparison} />
          <WorkspaceModeTabs
            mode={workspaceMode}
            recordAvailable={Boolean(drawerPair)}
            comparisonPanelId="comparison-panel"
            recordPanelId="record-panel"
            onModeChange={setWorkspaceMode}
          />
          <section
            id="comparison-panel"
            role="tabpanel"
            aria-labelledby="comparison-tab"
            hidden={workspaceMode !== "comparison"}
          >
            <ComparisonWorkspace
              comparison={selectedResponse.comparison}
              focusedEvidenceId={session.focusedEvidenceId}
              focusRequestId={session.focusRequestId}
            />
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
                onCompare={handleRecordCompare}
                onReset={handleRecordReset}
              />
            </section>
          ) : null}
        </main>
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
      </div>
    </div>
  );
}
