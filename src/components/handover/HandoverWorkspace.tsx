"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  HandoverApiResponse,
  HandoverComparison,
} from "@/lib/contracts";
import { comparePatientRecords, HandoverApiError, type HandoverRecord } from "@/lib/handover-api";

import { ComparisonWorkspace } from "./ComparisonWorkspace";
import { PatientContextHeader } from "./PatientContextHeader";
import { PatientQueue } from "./PatientQueue";
import { SummaryPanel } from "./SummaryPanel";

const API_FALLBACK_MESSAGE = "서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.";

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
  const [selectedPatientId, setSelectedPatientId] = useState(firstValidPatientId);
  const [searchTerm, setSearchTerm] = useState("");
  const [responseOverrides, setResponseOverrides] = useState<Record<string, HandoverApiResponse>>({});
  const [fallbackByPatient, setFallbackByPatient] = useState<Record<string, boolean>>({});
  const [apiStateByPatient, setApiStateByPatient] = useState<Record<string, PatientApiState>>({});
  const [sessions, setSessions] = useState<PatientReviewSessions>({});
  const apiStateRef = useRef<Record<string, PatientApiState>>({});
  const sessionsRef = useRef<PatientReviewSessions>({});
  const requestVersion = useRef(0);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const activePatientId = validResponses.some(
    (response) => response.comparison.patient.id === selectedPatientId,
  )
    ? selectedPatientId
    : firstValidPatientId;
  const responses = validResponses.map(
    (response) => responseOverrides[response.comparison.patient.id] ?? response,
  );
  const selectedResponse = responses.find(
    ({ comparison }) => comparison.patient.id === activePatientId,
  ) ?? responses[0];

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
    const patientId = activePatientId;
    const pair = recordPairs?.[patientId];
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
      (existingState.status === "pending" || existingState.status === "success" || existingState.status === "fallback")
    ) {
      return undefined;
    }

    setPatientApiState(patientId, pair, "pending");
    clearApiPresentation(patientId);

    const controller = new AbortController();
    const requestId = requestVersion.current + 1;
    requestVersion.current = requestId;

    void comparePatientRecords(pair.previous, pair.current, controller.signal)
      .then((apiResponse) => {
        if (
          controller.signal.aborted ||
          requestVersion.current !== requestId ||
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
          requestVersion.current !== requestId ||
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
  }, [activePatientId, recordPairs]);

  if (!selectedResponse) {
    return (
      <main className="workspace-empty" aria-labelledby="workspace-empty-title">
        <h1 id="workspace-empty-title">환자 비교 데이터가 없습니다.</h1>
        <p>읽기 전용 데모 응답을 확인할 수 없습니다.</p>
      </main>
    );
  }

  const patientId = selectedResponse.comparison.patient.id;
  const session = sessions[patientId] ?? createReviewSession(selectedResponse);
  const availableEvidenceIds = new Set(
    selectedResponse.comparison.changes.map((change) => change.id),
  );
  const selectedEvidenceIds = session.selectedEvidenceIds.filter((id) => availableEvidenceIds.has(id));
  const activePair = recordPairs?.[patientId];
  const patientApiState = apiStateByPatient[patientId];
  const apiPending = Boolean(
    activePair &&
      !session.reviewed &&
      (!patientApiState ||
        patientApiState.pair !== activePair ||
        (patientApiState.status !== "success" && patientApiState.status !== "fallback")),
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
    updateSession({
      ...session,
      focusedEvidenceId: evidenceId,
      focusRequestId: session.focusRequestId + 1,
    });
  }

  function handleSelectPatient(nextPatientId: string) {
    if (nextPatientId === patientId) return;
    setSelectedPatientId(nextPatientId);
  }

  return (
    <div className="app-shell">
      <header className="utility-bar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">/</span>
          <div>
            <p className="brand-kicker">NURSE HANDOVER</p>
            <h1>교대 인수인계 작업공간</h1>
          </div>
        </div>
        <div className="utility-meta">
          <span className="utility-clock mono">07/02 09:45</span>
        </div>
      </header>

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
          <ComparisonWorkspace
            comparison={selectedResponse.comparison}
            focusedEvidenceId={session.focusedEvidenceId}
            focusRequestId={session.focusRequestId}
          />
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
