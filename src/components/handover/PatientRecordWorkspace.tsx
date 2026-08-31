"use client";

import { useEffect, useId, useState } from "react";
import type { DemoMedication, DemoPatientRecord, DemoRecordPair } from "@/lib/demo-records";
import { cloneDemoRecord } from "@/lib/record-drafts";

export type PatientRecordWorkspaceProps = {
  pair: DemoRecordPair;
  patientName: string;
  busy: boolean;
  errorMessage: string | null;
  resetRequestId: number;
  onCompare?: (current: DemoPatientRecord) => void | Promise<void>;
  onReset?: () => void | Promise<void>;
  editableCurrent?: boolean;
  onClose?: () => void;
};

const VITAL_FIELDS = [
  { key: "systolic", label: "수축기 혈압", unit: "mmHg", step: "1" },
  { key: "diastolic", label: "이완기 혈압", unit: "mmHg", step: "1" },
  { key: "heartrate", label: "맥박", unit: "회/분", step: "1" },
  { key: "respiratory", label: "호흡", unit: "회/분", step: "1" },
  { key: "saturation", label: "산소포화도", unit: "%", step: "1" },
  { key: "body_temperature", label: "체온", unit: "°C", step: "0.1" },
] as const;

type VitalKey = (typeof VITAL_FIELDS)[number]["key"];

type RecordRowIds = {
  diagnosis: string[];
  medications: string[];
  notes: string[];
};

let fallbackRowIdSequence = 0;

function nextRecordRowId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  fallbackRowIdSequence += 1;
  return `${prefix}-generated-${fallbackRowIdSequence}`;
}

function createRecordRowIds(record: DemoPatientRecord, prefix: string): RecordRowIds {
  return {
    diagnosis: record.diagnosis.map(() => nextRecordRowId(`${prefix}-diagnosis`)),
    medications: record.medications.map(() => nextRecordRowId(`${prefix}-medications`)),
    notes: record.notes.map(() => nextRecordRowId(`${prefix}-notes`)),
  };
}

function dateTimeLocalValue(timestamp: string) {
  const match = timestamp.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return match?.[1] ?? "";
}

function timezoneSuffix(timestamp: string) {
  return timestamp.match(/(?:Z|[+-]\d{2}:\d{2})$/)?.[0] ?? "";
}

function isoTimestampValue(value: string, fallback: string) {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return fallback;
  const nextTimestamp = `${value}:00${timezoneSuffix(fallback)}`;
  const parsed = new Date(nextTimestamp);
  return Number.isNaN(parsed.getTime()) ? fallback : nextTimestamp;
}

function sanitizeRecord(record: DemoPatientRecord): DemoPatientRecord {
  const cloned = cloneDemoRecord(record);
  return {
    ...cloned,
    diagnosis: cloned.diagnosis.map((diagnosis) => diagnosis.trim()).filter(Boolean),
    medications: cloned.medications
      .map((medication) => ({
        name: medication.name.trim(),
        route: medication.route.trim(),
        frequency: medication.frequency.trim(),
      }))
      .filter((medication) => medication.name || medication.route || medication.frequency),
    notes: cloned.notes.map((note) => note.trim()).filter(Boolean),
    updated_at: cloned.updated_at.trim(),
  };
}

function updateAt<T>(items: T[], index: number, nextItem: T) {
  return items.map((item, itemIndex) => (itemIndex === index ? nextItem : item));
}

function RecordIdentity({ record, editable }: { record: DemoPatientRecord; editable: boolean }) {
  if (!editable) {
    return (
      <div className="record-identity-grid">
        <div className="record-value-pair"><span>환자 ID</span><strong className="mono">{record.patient_id}</strong></div>
        <div className="record-value-pair"><span>이름</span><strong>{record.name}</strong></div>
        <div className="record-value-pair"><span>병실</span><strong className="mono">{record.room_no}호</strong></div>
        <div className="record-value-pair"><span>성별</span><strong>{record.sex}</strong></div>
        <div className="record-value-pair"><span>나이</span><strong>{record.age}세</strong></div>
      </div>
    );
  }

  return (
    <div className="record-identity-grid record-identity-readonly">
      <label className="record-readonly-field"><span>환자 ID</span><input value={record.patient_id} readOnly aria-readonly="true" /></label>
      <label className="record-readonly-field"><span>이름</span><input value={record.name} readOnly aria-readonly="true" /></label>
      <label className="record-readonly-field"><span>병실</span><input value={`${record.room_no}호`} readOnly aria-readonly="true" /></label>
      <label className="record-readonly-field"><span>성별</span><input value={record.sex} readOnly aria-readonly="true" /></label>
      <label className="record-readonly-field"><span>나이</span><input value={`${record.age}세`} readOnly aria-readonly="true" /></label>
    </div>
  );
}

function ChartSection({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
  return (
    <section className="record-chart-section" aria-labelledby={`record-section-${code}`}>
      <div className="record-section-heading">
        <span className="record-section-code mono">{code}</span>
        <h3 id={`record-section-${code}`}>{title}</h3>
        <span className="record-section-rule" aria-hidden="true" />
      </div>
      {children}
    </section>
  );
}

function ReadOnlyChart({ record }: { record: DemoPatientRecord | null }) {
  if (!record) {
    return <p className="record-empty">이전 기록이 없습니다.</p>;
  }

  return (
    <div className="record-chart-body">
      <ChartSection code="INFO" title="환자정보">
        <RecordIdentity record={record} editable={false} />
      </ChartSection>
      <ChartSection code="V/S" title="활력징후">
        <div className="record-value-grid">
          {VITAL_FIELDS.map(({ key, label, unit }) => (
            <div className="record-value-pair" key={key}>
              <span>{label}</span>
              <strong className="mono">
                <span>{record.vitals[key] ?? "기록 없음"}</span>
                {record.vitals[key] === undefined ? null : <small> {unit}</small>}
              </strong>
            </div>
          ))}
        </div>
      </ChartSection>
      <ChartSection code="DX" title="진단">
        <ul className="record-line-list">
          {record.diagnosis.length ? record.diagnosis.map((diagnosis, index) => <li key={`${diagnosis}-${index}`}>{diagnosis}</li>) : <li className="record-empty-line">기록 없음</li>}
        </ul>
      </ChartSection>
      <ChartSection code="MED" title="투약">
        <div className="record-medication-list">
          {record.medications.length ? record.medications.map((medication, index) => (
            <div className="record-medication-readonly" key={`${medication.name}-${index}`}>
              <strong>{medication.name}</strong>
              <span className="mono">{medication.route} · {medication.frequency}</span>
            </div>
          )) : <p className="record-empty-line">기록 없음</p>}
        </div>
      </ChartSection>
      <ChartSection code="NOTE" title="간호기록">
        <ul className="record-line-list">
          {record.notes.length ? record.notes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>) : <li className="record-empty-line">기록 없음</li>}
        </ul>
      </ChartSection>
      <div className="record-chart-time"><span className="mono">RECORDED AT</span><strong className="mono">{record.updated_at}</strong></div>
    </div>
  );
}

function EditableChart({ record, busy, onChange, rowIds, onRowIdsChange, createRowId }: {
  record: DemoPatientRecord;
  busy: boolean;
  onChange: (record: DemoPatientRecord) => void;
  rowIds: RecordRowIds;
  onRowIdsChange: (rowIds: RecordRowIds) => void;
  createRowId: () => string;
}) {
  function updateVital(key: VitalKey, value: string) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return;
    onChange({ ...record, vitals: { ...record.vitals, [key]: numberValue } });
  }

  function updateDiagnosis(index: number, value: string) {
    onChange({ ...record, diagnosis: updateAt(record.diagnosis, index, value) });
  }

  function updateMedication(index: number, key: keyof DemoMedication, value: string) {
    onChange({
      ...record,
      medications: updateAt(record.medications, index, { ...record.medications[index]!, [key]: value }),
    });
  }

  function updateNote(index: number, value: string) {
    onChange({ ...record, notes: updateAt(record.notes, index, value) });
  }

  function removeDiagnosis(index: number) {
    onChange({ ...record, diagnosis: record.diagnosis.filter((_, itemIndex) => itemIndex !== index) });
    onRowIdsChange({ ...rowIds, diagnosis: rowIds.diagnosis.filter((_, itemIndex) => itemIndex !== index) });
  }

  function addDiagnosis() {
    onChange({ ...record, diagnosis: [...record.diagnosis, ""] });
    onRowIdsChange({ ...rowIds, diagnosis: [...rowIds.diagnosis, createRowId()] });
  }

  function removeMedication(index: number) {
    onChange({ ...record, medications: record.medications.filter((_, itemIndex) => itemIndex !== index) });
    onRowIdsChange({ ...rowIds, medications: rowIds.medications.filter((_, itemIndex) => itemIndex !== index) });
  }

  function addMedication() {
    onChange({ ...record, medications: [...record.medications, { name: "", route: "", frequency: "" }] });
    onRowIdsChange({ ...rowIds, medications: [...rowIds.medications, createRowId()] });
  }

  function removeNote(index: number) {
    onChange({ ...record, notes: record.notes.filter((_, itemIndex) => itemIndex !== index) });
    onRowIdsChange({ ...rowIds, notes: rowIds.notes.filter((_, itemIndex) => itemIndex !== index) });
  }

  function addNote() {
    onChange({ ...record, notes: [...record.notes, ""] });
    onRowIdsChange({ ...rowIds, notes: [...rowIds.notes, createRowId()] });
  }

  return (
    <div className="record-chart-body">
      <ChartSection code="INFO" title="환자정보">
        <RecordIdentity record={record} editable />
      </ChartSection>
      <ChartSection code="V/S" title="활력징후">
        <div className="record-input-grid">
          {VITAL_FIELDS.map(({ key, label, unit, step }) => (
            <label className="record-input-field" key={key}>
              <span>{label}</span>
              <span className="record-input-with-unit"><input type="number" step={step} value={record.vitals[key] ?? ""} disabled={busy} aria-label={label} onChange={(event) => updateVital(key, event.target.value)} /><small>{unit}</small></span>
            </label>
          ))}
        </div>
      </ChartSection>
      <ChartSection code="DX" title="진단">
        <div className="record-edit-list">
          {record.diagnosis.map((diagnosis, index) => (
            <div className="record-edit-row" key={rowIds.diagnosis[index]}>
              <label className="record-edit-field"><span>진단 {index + 1}</span><input value={diagnosis} disabled={busy} aria-label={`진단 ${index + 1}`} onChange={(event) => updateDiagnosis(index, event.target.value)} /></label>
              <button type="button" className="record-row-remove" disabled={busy} aria-label={`진단 ${index + 1} 삭제`} onClick={() => removeDiagnosis(index)}>삭제</button>
            </div>
          ))}
          <button type="button" className="record-row-add" disabled={busy} onClick={addDiagnosis}>진단 추가</button>
        </div>
      </ChartSection>
      <ChartSection code="MED" title="투약">
        <div className="record-edit-list">
          {record.medications.map((medication, index) => (
            <div className="record-medication-edit-row" key={rowIds.medications[index]}>
              <label className="record-edit-field"><span>투약 {index + 1} 약명</span><input value={medication.name} disabled={busy} aria-label={`투약 ${index + 1} 약명`} onChange={(event) => updateMedication(index, "name", event.target.value)} /></label>
              <label className="record-edit-field"><span>투약 {index + 1} 경로</span><input value={medication.route} disabled={busy} aria-label={`투약 ${index + 1} 경로`} onChange={(event) => updateMedication(index, "route", event.target.value)} /></label>
              <label className="record-edit-field"><span>투약 {index + 1} 빈도</span><input value={medication.frequency} disabled={busy} aria-label={`투약 ${index + 1} 빈도`} onChange={(event) => updateMedication(index, "frequency", event.target.value)} /></label>
              <button type="button" className="record-row-remove" disabled={busy} aria-label={`투약 ${index + 1} 삭제`} onClick={() => removeMedication(index)}>삭제</button>
            </div>
          ))}
          <button type="button" className="record-row-add" disabled={busy} onClick={addMedication}>투약 추가</button>
        </div>
      </ChartSection>
      <ChartSection code="NOTE" title="간호기록">
        <div className="record-edit-list">
          {record.notes.map((note, index) => (
            <div className="record-edit-row" key={rowIds.notes[index]}>
              <label className="record-edit-field"><span>간호기록 {index + 1}</span><textarea rows={2} value={note} disabled={busy} aria-label={`간호기록 ${index + 1}`} onChange={(event) => updateNote(index, event.target.value)} /></label>
              <button type="button" className="record-row-remove" disabled={busy} aria-label={`간호기록 ${index + 1} 삭제`} onClick={() => removeNote(index)}>삭제</button>
            </div>
          ))}
          <button type="button" className="record-row-add" disabled={busy} aria-label="간호기록 추가" onClick={addNote}>간호기록 추가</button>
        </div>
      </ChartSection>
      <label className="record-time-field"><span>기록 시간</span><input type="datetime-local" value={dateTimeLocalValue(record.updated_at)} disabled={busy} aria-label="기록 시간" onChange={(event) => onChange({ ...record, updated_at: isoTimestampValue(event.target.value, record.updated_at) })} /></label>
    </div>
  );
}

export function PatientRecordWorkspace({
  pair,
  patientName,
  busy,
  errorMessage,
  resetRequestId,
  onCompare,
  onReset,
  editableCurrent = true,
  onClose,
}: PatientRecordWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<"previous" | "current">("previous");
  const [draft, setDraft] = useState<DemoPatientRecord>(() => cloneDemoRecord(pair.current));
  const rowIdPrefix = useId();
  const [rowIds, setRowIds] = useState<RecordRowIds>(() => createRecordRowIds(pair.current, rowIdPrefix));
  const workspaceTitleId = `record-workspace-title-${pair.current.patient_id}`;

  useEffect(() => {
    queueMicrotask(() => {
      setDraft(cloneDemoRecord(pair.current));
      setRowIds(createRecordRowIds(pair.current, rowIdPrefix));
    });
  }, [pair, resetRequestId, rowIdPrefix]);

  function handleCompare() {
    if (!editableCurrent || !onCompare) return;
    const sanitized = sanitizeRecord(draft);
    void Promise.resolve(onCompare(sanitized)).catch(() => undefined);
  }

  function handleReset() {
    if (busy || !editableCurrent || !onReset) return;
    void Promise.resolve(onReset()).catch(() => undefined);
  }

  const previousTabId = `${workspaceTitleId}-previous-tab`;
  const currentTabId = `${workspaceTitleId}-current-tab`;
  const previousPanelId = `${workspaceTitleId}-previous`;
  const currentPanelId = `${workspaceTitleId}-current`;
  const errorId = `${workspaceTitleId}-error`;

  return (
    <section
      className="record-workspace"
      role="region"
      aria-label={`${patientName} 원본 기록`}
    >
      <header className="record-workspace-header">
        <div>
          <p className="eyebrow">CHART LEDGER · SOURCE RECORD</p>
          <h2 id={workspaceTitleId}>원본 차트 · {patientName} · <span className="mono">{pair.current.patient_id}</span></h2>
          <p className="record-workspace-patient">{patientName}</p>
        </div>
        {onClose ? (
          <button type="button" className="record-close-button" onClick={onClose}>
            비교로 돌아가기
          </button>
        ) : null}
      </header>

      <div className="record-source-interval" aria-label="근거 기록 구간">
        <span>이전 기록 시각</span>
        <time className="mono" dateTime={pair.previous?.updated_at}>{pair.previous?.updated_at ?? "기록 없음"}</time>
        <span aria-hidden="true">→</span>
        <span>현재 기록 시각</span>
        <time className="mono" dateTime={pair.current.updated_at}>{pair.current.updated_at}</time>
      </div>

      <div className="record-workspace-tabs" role="tablist" aria-label="원본 기록 시점">
        <button id={previousTabId} type="button" role="tab" aria-selected={activeTab === "previous"} aria-controls={previousPanelId} className={activeTab === "previous" ? "is-active" : ""} onClick={() => setActiveTab("previous")}>이전 기록 <span className="mono">{dateTimeLocalValue(pair.previous?.updated_at ?? "").slice(11) || "—"}</span></button>
        <button id={currentTabId} type="button" role="tab" aria-selected={activeTab === "current"} aria-controls={currentPanelId} className={activeTab === "current" ? "is-active" : ""} onClick={() => setActiveTab("current")}>현재 기록 <span className="mono">{dateTimeLocalValue(pair.current.updated_at).slice(11) || "—"}</span></button>
      </div>

      <div className="record-workspace-scroll">
        {activeTab === "previous" ? (
          <div id={previousPanelId} role="tabpanel" aria-labelledby={previousTabId}>
            <div className="record-tab-note"><span className="mono">READ ONLY</span><span>이전 인계 시점의 원본 기록</span></div>
            <ReadOnlyChart record={pair.previous} />
          </div>
        ) : (
          <div id={currentPanelId} role="tabpanel" aria-labelledby={currentTabId}>
            {editableCurrent ? (
              <>
                <div className="record-tab-note current"><span className="mono">EDITABLE DRAFT</span><span>변경 후 비교할 현재 기록</span></div>
                <EditableChart
                  record={draft}
                  busy={busy}
                  onChange={setDraft}
                  rowIds={rowIds}
                  onRowIdsChange={setRowIds}
                  createRowId={() => nextRecordRowId(rowIdPrefix)}
                />
              </>
            ) : (
              <>
                <div className="record-tab-note"><span className="mono">READ ONLY</span><span>선택 사건의 현재 snapshot</span></div>
                <ReadOnlyChart record={pair.current} />
              </>
            )}
          </div>
        )}
      </div>

      {errorMessage ? <div className="record-workspace-error" id={errorId} role="alert">{errorMessage}</div> : null}
      {editableCurrent ? (
        <footer className="record-workspace-actions">
          <button type="button" className="record-reset-button" disabled={busy} onClick={handleReset}>초기화</button>
          <button type="button" className="record-compare-button" disabled={busy} onClick={handleCompare}>{busy ? "비교 중" : "변경사항 비교"}</button>
        </footer>
      ) : null}
    </section>
  );
}
