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
};

type PatientReviewSessions = Record<string, PatientReviewSession>;
type PatientApiState = "pending" | "success" | "fallback";

function createReviewSession(response: HandoverApiResponse): PatientReviewSession {
  return {
    selectedEvidenceIds: [...response.summary.evidenceIds],
    recommendation: "",
    sourceConfirmed: false,
    reviewed: false,
    focusedEvidenceId: null,
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
  const requestVersion = useRef(0);

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

  useEffect(() => {
    const patientId = activePatientId;
    const pair = recordPairs?.[patientId];
    if (!pair) return undefined;

    const controller = new AbortController();
    const requestId = requestVersion.current + 1;
    requestVersion.current = requestId;

    void comparePatientRecords(pair.previous, pair.current, controller.signal)
      .then((apiResponse) => {
        if (controller.signal.aborted || requestVersion.current !== requestId) return;
        setResponseOverrides((current) => ({ ...current, [patientId]: apiResponse }));
        setFallbackByPatient((current) => ({ ...current, [patientId]: false }));
        setApiStateByPatient((current) => ({ ...current, [patientId]: "success" }));
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
        setApiStateByPatient((current) => ({ ...current, [patientId]: "fallback" }));
      });

    return () => controller.abort();
  }, [activePatientId, recordPairs]);

  if (!selectedResponse) {
    return (
      <main className="workspace-empty" aria-labelledby="workspace-empty-title">
        <h1 id="workspace-empty-title">환자 비교 데이터가 없습니다.</h1>
        <p>읽기 전용 데모 응답을 확인할 수 없습니다.</p>
        <p className="safety-note">가상 데이터 · 의사결정 보조가 아님</p>
      </main>
    );
  }

  const patientId = selectedResponse.comparison.patient.id;
  const session = sessions[patientId] ?? createReviewSession(selectedResponse);
  const availableEvidenceIds = new Set(
    selectedResponse.comparison.changes.map((change) => change.id),
  );
  const selectedEvidenceIds = session.selectedEvidenceIds.filter((id) => availableEvidenceIds.has(id));
  const apiPending = Boolean(recordPairs?.[patientId]) && !["success", "fallback"].includes(apiStateByPatient[patientId] ?? "pending");
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
    updateSession({ ...session, focusedEvidenceId: evidenceId });
  }

  function handleSelectPatient(nextPatientId: string) {
    if (nextPatientId === patientId) return;
    setSelectedPatientId(nextPatientId);
    if (recordPairs?.[nextPatientId]) {
      setApiStateByPatient((current) => ({ ...current, [nextPatientId]: "pending" }));
    }
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
          <span className="utility-context">일반 성인병동 · 교대 검토</span>
          <span className="utility-separator" aria-hidden="true" />
          <span className="safety-note">가상 데이터 · 의사결정 보조가 아님</span>
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
