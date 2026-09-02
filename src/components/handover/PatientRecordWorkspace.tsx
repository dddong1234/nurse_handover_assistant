"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DemoMedication, DemoPatientRecord, DemoRecordPair } from "@/lib/demo-records";
import type { ShiftReadinessRecord } from "@/lib/demo-shift-readiness";
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
  readinessRecord?: ShiftReadinessRecord | null;
  focusedSourcePath?: string | null;
  focusRequestId?: number;
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

type DirectSourceSelector = {
  collection: "investigations" | "devices" | "medications" | "handoffRequests";
  selector: "id" | "name";
  value: string;
};

function parseDirectSourceSelector(path: string | null | undefined): DirectSourceSelector | null {
  if (!path) return null;
  const match = path.match(/^(investigations|devices|medications|handoffRequests)\[(id|name)=([^\[\]]+)\]$/);
  if (!match) return null;
  const [, collection, selector, encodedValue] = match;
  if (!encodedValue || (collection === "medications" && selector !== "name") || (collection !== "medications" && selector !== "id")) {
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

type ReadOnlyFieldFocus = {
  collection: "vitals" | "diagnosis" | "medications" | "notes";
  value: string;
};

function parseReadOnlyFieldPath(path: string | null | undefined): ReadOnlyFieldFocus | null {
  if (!path) return null;
  const vitalMatch = path.match(/^vitals\.([a-z_]+)$/);
  if (vitalMatch && VITAL_FIELDS.some(({ key }) => key === vitalMatch[1])) {
    return { collection: "vitals", value: vitalMatch[1] };
  }
  const collectionMatch = path.match(/^(diagnosis|medications|notes)\[(.*)\]$/);
  if (!collectionMatch) return null;
  try {
    const value = JSON.parse(collectionMatch[2]) as unknown;
    return typeof value === "string" && value.length > 0
      ? { collection: collectionMatch[1] as ReadOnlyFieldFocus["collection"], value }
      : null;
  } catch {
    return null;
  }
}

function readOnlyFieldPath(collection: ReadOnlyFieldFocus["collection"], value: string) {
  return collection === "vitals" ? `vitals.${value}` : `${collection}[${JSON.stringify(value)}]`;
}

function ReadOnlyChart({
  record,
  focusedSourcePath = null,
  focusRequestId = 0,
}: {
  record: DemoPatientRecord | null;
  focusedSourcePath?: string | null;
  focusRequestId?: number;
}) {
  const focusedElementRef = useRef<HTMLElement | null>(null);
  const focusedField = parseReadOnlyFieldPath(focusedSourcePath);

  useEffect(() => {
    if (!focusedField) return;
    queueMicrotask(() => {
      focusedElementRef.current?.focus();
    });
  }, [focusRequestId, focusedField, focusedSourcePath]);

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
          {VITAL_FIELDS.map(({ key, label, unit }) => {
            const path = readOnlyFieldPath("vitals", key);
            const active = focusedField?.collection === "vitals" && focusedField.value === key && focusedSourcePath === path;
            return (
            <div
              className="record-value-pair"
              key={key}
              data-source-path={active ? path : undefined}
              data-evidence-active={active ? "true" : undefined}
              tabIndex={active ? -1 : undefined}
              ref={active ? (element) => { focusedElementRef.current = element; } : undefined}
            >
              <span>{label}</span>
              <strong className="mono">
                <span>{record.vitals[key] ?? "기록 없음"}</span>
                {record.vitals[key] === undefined ? null : <small> {unit}</small>}
              </strong>
            </div>
            );
          })}
        </div>
      </ChartSection>
      <ChartSection code="DX" title="진단">
        <ul className="record-line-list">
          {record.diagnosis.length ? record.diagnosis.map((diagnosis, index) => {
            const path = readOnlyFieldPath("diagnosis", diagnosis);
            const active = focusedField?.collection === "diagnosis" && focusedField.value === diagnosis && focusedSourcePath === path;
            return (
              <li
                key={`${diagnosis}-${index}`}
                data-source-path={active ? path : undefined}
                data-evidence-active={active ? "true" : undefined}
                tabIndex={active ? -1 : undefined}
                ref={active ? (element) => { focusedElementRef.current = element; } : undefined}
              >
                {diagnosis}
              </li>
            );
          }) : <li className="record-empty-line">기록 없음</li>}
        </ul>
      </ChartSection>
      <ChartSection code="MED" title="투약">
        <div className="record-medication-list">
          {record.medications.length ? record.medications.map((medication, index) => {
            const path = readOnlyFieldPath("medications", medication.name);
            const active = focusedField?.collection === "medications" && focusedField.value === medication.name && focusedSourcePath === path;
            return (
            <div
              className="record-medication-readonly"
              key={`${medication.name}-${index}`}
              data-source-path={active ? path : undefined}
              data-evidence-active={active ? "true" : undefined}
              tabIndex={active ? -1 : undefined}
              ref={active ? (element) => { focusedElementRef.current = element; } : undefined}
            >
              <strong>{medication.name}</strong>
              <span className="mono">{medication.route} · {medication.frequency}</span>
            </div>
            );
          }) : <p className="record-empty-line">기록 없음</p>}
        </div>
      </ChartSection>
      <ChartSection code="NOTE" title="간호기록">
        <ul className="record-line-list">
          {record.notes.length ? record.notes.map((note, index) => {
            const path = readOnlyFieldPath("notes", note);
            const active = focusedField?.collection === "notes" && focusedField.value === note && focusedSourcePath === path;
            return (
              <li
                key={`${note}-${index}`}
                data-source-path={active ? path : undefined}
                data-evidence-active={active ? "true" : undefined}
                tabIndex={active ? -1 : undefined}
                ref={active ? (element) => { focusedElementRef.current = element; } : undefined}
              >
                {note}
              </li>
            );
          }) : <li className="record-empty-line">기록 없음</li>}
        </ul>
      </ChartSection>
      <div className="record-chart-time"><span className="mono">RECORDED AT</span><strong className="mono">{record.updated_at}</strong></div>
    </div>
  );
}

function ReadOnlySupplemental({
  record,
  focusedSourcePath,
  focusRequestId = 0,
}: {
  record: ShiftReadinessRecord;
  focusedSourcePath?: string | null;
  focusRequestId?: number;
}) {
  const selector = parseDirectSourceSelector(focusedSourcePath);

  useEffect(() => {
    if (!selector || !focusedSourcePath) return;
    queueMicrotask(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-source-path]"))
        .find((element) => element.dataset.sourcePath === focusedSourcePath);
      target?.focus();
    });
  }, [focusRequestId, focusedSourcePath, selector]);

  function isActive(
    collection: DirectSourceSelector["collection"],
    itemSelector: DirectSourceSelector["selector"],
    value: string,
  ) {
    return Boolean(
      selector &&
        selector.collection === collection &&
        selector.selector === itemSelector &&
        selector.value === value &&
        focusedSourcePath === directSourcePath(collection, itemSelector, value),
    );
  }

  function sourceAttributes(
    collection: DirectSourceSelector["collection"],
    itemSelector: DirectSourceSelector["selector"],
    value: string,
  ) {
    const active = isActive(collection, itemSelector, value);
    return {
      active,
      path: directSourcePath(collection, itemSelector, value),
    };
  }

  return (
    <div className="record-readiness-supplemental" aria-label="근무 준비 원본 자료">
      <ChartSection code="INV" title="검사·결과">
        <div className="record-readiness-source-list">
          {record.investigations.length ? record.investigations.map((investigation) => {
            const source = sourceAttributes("investigations", "id", investigation.id);
            return (
              <article
                className="record-readiness-source-row"
                key={investigation.id}
                data-source-path={source.path}
                data-evidence-active={source.active ? "true" : undefined}
                tabIndex={source.active ? -1 : undefined}
              >
                <div className="record-readiness-source-heading">
                  <strong>{investigation.name}</strong>
                  <span className="mono">{investigation.id}</span>
                </div>
                <div className="record-readiness-source-meta">
                  <span>{investigation.kind === "lab" ? "검사" : "영상"}</span>
                  <span>{investigation.status}</span>
                  <time className="mono" dateTime={investigation.orderedAt}>{investigation.orderedAt}</time>
                </div>
                <p data-evidence-active={source.active ? "true" : undefined}>
                  {investigation.resultSummary ?? "결과 대기"}
                </p>
                {investigation.scheduledAt ? <span className="mono">예정 {investigation.scheduledAt}</span> : null}
              </article>
            );
          }) : <p className="record-empty-line">기록 없음</p>}
        </div>
      </ChartSection>

      <ChartSection code="LINE" title="Line·Device">
        <div className="record-readiness-source-list">
          {record.devices.length ? record.devices.map((device) => {
            const source = sourceAttributes("devices", "id", device.id);
            return (
              <article
                className="record-readiness-source-row"
                key={device.id}
                data-source-path={source.path}
                data-evidence-active={source.active ? "true" : undefined}
                tabIndex={source.active ? -1 : undefined}
              >
                <div className="record-readiness-source-heading">
                  <strong>{device.type}</strong>
                  <span className="mono">{device.id}</span>
                </div>
                <div className="record-readiness-source-meta">
                  <span>{device.site}</span>
                  <span>{device.status}</span>
                  <time className="mono" dateTime={device.insertedAt}>{device.insertedAt}</time>
                </div>
                {device.changeDueAt ? <p>교체 예정 {device.changeDueAt}</p> : <p>교체 예정 없음</p>}
              </article>
            );
          }) : <p className="record-empty-line">기록 없음</p>}
        </div>
      </ChartSection>

      <ChartSection code="MED+" title="투약 적용 정보">
        <div className="record-readiness-source-list">
          {record.medications.length ? record.medications.map((medication) => {
            const source = sourceAttributes("medications", "name", medication.name);
            return (
              <article
                className="record-readiness-source-row"
                key={medication.name}
                data-source-path={source.path}
                data-evidence-active={source.active ? "true" : undefined}
                tabIndex={source.active ? -1 : undefined}
              >
                <div className="record-readiness-source-heading">
                  <strong>{medication.name}</strong>
                  <span className="mono">{medication.route} · {medication.frequency}</span>
                </div>
                <div className="record-readiness-source-meta">
                  <span>적용 상태 · {medication.orderStatus}</span>
                  <span>{medication.effectiveFrom ? `적용 ${medication.effectiveFrom}` : "적용 시점 없음"}</span>
                </div>
                {medication.effectiveTo ? <p>종료 {medication.effectiveTo}</p> : null}
              </article>
            );
          }) : <p className="record-empty-line">기록 없음</p>}
        </div>
      </ChartSection>

      <ChartSection code="REQ" title="전달 요청 원본">
        <div className="record-readiness-source-list">
          {record.handoffRequests.length ? record.handoffRequests.map((request) => {
            const source = sourceAttributes("handoffRequests", "id", request.id);
            return (
              <article
                className="record-readiness-source-row"
                key={request.id}
                data-source-path={source.path}
                data-evidence-active={source.active ? "true" : undefined}
                tabIndex={source.active ? -1 : undefined}
              >
                <div className="record-readiness-source-heading">
                  <strong>{request.topic}</strong>
                  <span className="mono">{request.id}</span>
                </div>
                <div className="record-readiness-source-meta">
                  <span>{request.sourceType}</span>
                  <span>{request.status}</span>
                  <time className="mono" dateTime={request.requestedAt}>{request.requestedAt}</time>
                </div>
                {request.dueBy ? <p>전달 기한 {request.dueBy}</p> : <p>전달 기한 없음</p>}
              </article>
            );
          }) : <p className="record-empty-line">기록 없음</p>}
        </div>
      </ChartSection>
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
  readinessRecord = null,
  focusedSourcePath = null,
  focusRequestId = 0,
}: PatientRecordWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<"previous" | "current">("previous");
  const [draft, setDraft] = useState<DemoPatientRecord>(() => cloneDemoRecord(pair.current));
  const rowIdPrefix = useId();
  const [rowIds, setRowIds] = useState<RecordRowIds>(() => createRecordRowIds(pair.current, rowIdPrefix));
  const workspaceTitleId = `record-workspace-title-${pair.current.patient_id}`;
  const hasFocusedReadOnlyField = Boolean(parseReadOnlyFieldPath(focusedSourcePath));
  const displayedActiveTab = hasFocusedReadOnlyField ? "current" : activeTab;

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
        <button id={previousTabId} type="button" role="tab" aria-selected={displayedActiveTab === "previous"} aria-controls={previousPanelId} className={displayedActiveTab === "previous" ? "is-active" : ""} onClick={() => setActiveTab("previous")}>이전 기록 <span className="mono">{dateTimeLocalValue(pair.previous?.updated_at ?? "").slice(11) || "—"}</span></button>
        <button id={currentTabId} type="button" role="tab" aria-selected={displayedActiveTab === "current"} aria-controls={currentPanelId} className={displayedActiveTab === "current" ? "is-active" : ""} onClick={() => setActiveTab("current")}>현재 기록 <span className="mono">{dateTimeLocalValue(pair.current.updated_at).slice(11) || "—"}</span></button>
      </div>

      <div className="record-workspace-scroll">
        {displayedActiveTab === "previous" ? (
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
            <ReadOnlyChart
              record={pair.current}
              focusedSourcePath={focusedSourcePath}
              focusRequestId={focusRequestId}
            />
              </>
            )}
          </div>
        )}
        {readinessRecord ? (
          <ReadOnlySupplemental
            record={readinessRecord}
            focusedSourcePath={focusedSourcePath}
            focusRequestId={focusRequestId}
          />
        ) : null}
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
