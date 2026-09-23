"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { CareDraft, ChartingPanelProps } from "@/lib/carenote/types";
import { createChartingSuggestion } from "./chartingAdapter";
import { validateChartingDraft } from "./chartingValidation";
import { formatKoreaTime, fromKoreaLocal, isZonedIso, toKoreaLocal } from "./time";
import styles from "./ChartingPanel.module.css";

type Suggestion = NonNullable<ReturnType<typeof createChartingSuggestion>>;

export function ChartingPanel(props: ChartingPanelProps) {
  // Patient/encounter changes must reset any component-local acceptance/dismissal state.
  return <ChartingEditor key={JSON.stringify([props.patient.id, props.patient.encounterId])} {...props} />;
}

function ChartingEditor({ patient, evidence, notes, draft, onDraftChange, onAddNote, onOpenEvidence }: ChartingPanelProps) {
  const editorId = useId();
  const editor = useRef<HTMLTextAreaElement>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [acceptedSnapshot, setAcceptedSnapshot] = useState<{ suggestion: Suggestion; context: string } | null>(null);
  const [error, setError] = useState("");
  const scopeKey = JSON.stringify([draft.text, draft.category, draft.recordedAt]);
  const isSoap = /^[SOAP]:/m.test(draft.text);
  const scopedEvidence = evidence.filter((item) =>
    item.patientId === patient.id && item.encounterId === patient.encounterId
    && isZonedIso(item.recordedAt) && isZonedIso(draft.recordedAt)
    && Date.parse(item.recordedAt) <= Date.parse(draft.recordedAt));
  const acceptanceContext = JSON.stringify([scopeKey, scopedEvidence]);
  const accepted = acceptedSnapshot?.context === acceptanceContext ? acceptedSnapshot.suggestion : null;
  const scopedNotes = notes.filter((item) =>
    item.patientId === patient.id && item.encounterId === patient.encounterId && isZonedIso(item.recordedAt))
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const suggestion = !isSoap && dismissed !== scopeKey
    ? createChartingSuggestion({ patient, evidence: scopedEvidence, draft }) : null;
  const review = suggestion ?? accepted;
  const sourceId = suggestion?.sourceEvidenceIds[0];

  function edit(next: CareDraft) {
    setAcceptedSnapshot(null);
    setError("");
    onDraftChange(next);
  }

  function accept() {
    if (!suggestion) return;
    const nextDraft = { ...draft, text: suggestion.narrative };
    const nextScopeKey = JSON.stringify([nextDraft.text, nextDraft.category, nextDraft.recordedAt]);
    setAcceptedSnapshot({ suggestion, context: JSON.stringify([nextScopeKey, scopedEvidence]) });
    setError("");
    onDraftChange(nextDraft);
    editor.current?.focus();
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.currentTarget !== document.activeElement) return;
    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && suggestion) {
      event.preventDefault();
      accept();
    } else if (event.key === "Escape" && suggestion) {
      event.preventDefault();
      setDismissed(scopeKey);
    }
  }

  function addRecord() {
    const validation = validateChartingDraft(draft);
    if (!validation.valid) {
      setError(validation.errors.join(" "));
      return;
    }
    const validIds = new Set(scopedEvidence.map((item) => item.id));
    try {
      // Manual edits invalidate automatic provenance; never assert stale evidence support.
      const sourceEvidenceIds = accepted?.narrative === draft.text
        ? accepted.sourceEvidenceIds.filter((id) => validIds.has(id)) : [];
      onAddNote({ narrative: draft.text, recordedAt: draft.recordedAt, category: draft.category, sourceEvidenceIds });
      setError("");
    } catch {
      setError("추가하지 못했습니다. 입력은 유지됩니다. 시각과 환자 문맥을 확인하세요.");
    }
  }

  return <section className={styles.panel} aria-label="간호기록 작성">
    <header className={styles.heading}>
      <div><h2>간호기록</h2></div>
      <span className={styles.badge}>기록 기반 추천</span>
    </header>
    <p className={styles.intro}>짧은 입력을 기록 문장으로 다듬습니다.</p>
    <div className={styles.composer}>
      <div className={styles.toolbar}>
        <label>기록 시각 (한국시간)
          <input type="datetime-local" value={toKoreaLocal(draft.recordedAt)}
            onChange={(event) => edit({ ...draft, recordedAt: fromKoreaLocal(event.target.value) })} />
        </label>
        <label>기록 분류
          <select value={draft.category}
            onChange={(event) => edit({ ...draft, category: event.target.value as CareDraft["category"] })}>
            <option>일반</option><option>V/S</option><option>PRN</option>
          </select>
        </label>
      </div>
      <label className={styles.editorLabel} htmlFor={editorId}>간호기록 입력</label>
      <textarea id={editorId} ref={editor} value={draft.text} rows={7}
        placeholder="예: 잘잠 · 잠 못잠 · 통증 3점 · 오심 없음"
        aria-describedby={editorId + "-help"} onKeyDown={onEditorKeyDown}
        onChange={(event) => edit({ ...draft, text: event.target.value })} />
      {accepted && <div className={styles.help} role="region" aria-label="입력 원문">
        <strong>입력 원문</strong> · {accepted.sourceText}
      </div>}
      {suggestion && <div className={styles.suggestion} role="region" aria-label="SOAP 추천">
        <div className={styles.suggestionHeader}><strong>기록 문장 추천</strong><span>검토 전 · 본문 미반영</span></div>
        <p className={styles.narrative}>{suggestion.narrative}</p>
        <div className={styles.suggestionActions}>
          <span>현재 입력을 바탕으로 작성</span>
          {sourceId && <button type="button" onClick={() => onOpenEvidence(sourceId)}>관련 근거 보기</button>}
          <button type="button" onClick={accept}>추천 채택 <kbd aria-hidden="true">Tab</kbd></button>
          <button type="button" onClick={() => setDismissed(scopeKey)}>무시 <kbd aria-hidden="true">Esc</kbd></button>
        </div>
      </div>}
      <div className={styles.help} id={editorId + "-help"} role="status">
        {!draft.text.trim() ? "짧은 관찰 사실을 입력하면 지원 표현을 제안합니다." :
          accepted ? "원문과 비교해 확인·수정한 뒤 기록을 추가하세요." :
          isSoap ? "직접 작성 중 · 수정 내용은 덮어쓰지 않습니다." :
          dismissed === scopeKey ? "추천을 닫았습니다. 입력은 유지됩니다." :
          !suggestion ? "지원하지 않는 표현입니다. 원문을 유지하고 SOAP로 작성하세요." :
          "입력한 사실만 문장화합니다. 필요한 항목은 직접 덧붙일 수 있습니다."}
      </div>
    </div>
    {review?.conflict && <aside className={styles.review} role="region" aria-label="이전 기록과 차이">
      <strong>이전 기록과 차이</strong><p>{review.conflict.message}</p>
      {review.conflict.evidenceIds[0] && <button type="button" onClick={() => onOpenEvidence(review.conflict!.evidenceIds[0])}>이전 근거 보기</button>}
    </aside>}
    {!!review?.reviewPrompts.length && <aside className={styles.review} role="region" aria-label="기록 전 확인">
      <strong>기록 전 확인</strong>
      {review.reviewPrompts.map((prompt) => <div key={prompt.id}>
        <p>{prompt.message}</p>
        {prompt.evidenceIds[0] && <button type="button" onClick={() => onOpenEvidence(prompt.evidenceIds[0])}>투약 근거 보기</button>}
      </div>)}
      <small>근거 문구만 확인합니다. 투약 시각·동일 건 판정은 지원하지 않습니다.</small>
    </aside>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <footer className={styles.actions}>
      <p>세션 기록 · 새로고침 시 초기화 · 미서명</p>
      <button type="button" className={styles.primary} onClick={addRecord}>기록 추가</button>
    </footer>
    <section className={styles.timeline} aria-label="간호기록 타임라인">
      <div className={styles.timelineHeading}><h3>간호기록 타임라인</h3><span>{scopedNotes.length}건 · 최신순</span></div>
      {scopedNotes.length === 0 ? <p className={styles.empty}>기록이 없습니다. 검토한 기록을 추가하세요.</p> :
        scopedNotes.map((note) => <article className={styles.note} key={note.id}>
          <header><time dateTime={note.recordedAt}>{formatKoreaTime(note.recordedAt)}</time>
            <span>{note.category}</span><span>{note.signatureState === "unsigned-demo" ? "미서명 · 세션 추가" : "합성 원본"}</span></header>
          <p className={styles.narrative}>{note.narrative}</p>
          {note.sourceEvidenceIds.find((id) => scopedEvidence.some((item) => item.id === id)) && <button type="button"
            onClick={() => onOpenEvidence(note.sourceEvidenceIds.find((id) => scopedEvidence.some((item) => item.id === id))!)}>기록 근거 보기</button>}
        </article>)}
    </section>
  </section>;
}
