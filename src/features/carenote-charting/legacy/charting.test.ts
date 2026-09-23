// Regression tests ported from charting_assistant 1cec3bb; not new user validation.
import { describe, expect, it } from 'vitest'
import {
  getSuggestion,
  insertChronologically,
  parseTime,
  validateDraft,
  type Evidence,
  type NursingNote,
} from './charting'

const baseNote: NursingNote = {
  id: 'note-base',
  timestamp: '14:00',
  category: 'V/S',
  narrative: 'S: 복부 통증 NRS 3점 호소.\nO: V/S 120/70-78-18-36.7℃.\nA: 통증 양상 관찰함.\nP: 안위 유지 및 경과 관찰함.',
  nurseSignature: '간호사 이○○',
  signatureState: 'signed-fixture',
}

describe('parseTime', () => {
  it.each([
    ['00:00', 0],
    ['14:00', 840],
    ['21:30', 1290],
    ['23:59', 1439],
  ])('parses valid same-day HH:mm time %s', (timestamp, expectedMinutes) => {
    expect(parseTime(timestamp)).toBe(expectedMinutes)
  })

  it.each(['24:00', '12:60', '9:00', '14:0', '1400', '', ' 14:00'])(
    'rejects invalid time %j',
    (timestamp) => {
      expect(parseTime(timestamp)).toBeNull()
    },
  )
})

describe('insertChronologically', () => {
  it('places the incoming note before stable existing notes at the same timestamp', () => {
    const existing = [
      { ...baseNote, id: 'note-z', timestamp: '14:00' },
      { ...baseNote, id: 'note-a', timestamp: '14:00' },
      { ...baseNote, id: 'note-evening', timestamp: '21:30' },
    ]

    const result = insertChronologically(existing, { ...baseNote, id: 'note-b', timestamp: '14:00' })

    expect(result.map((note) => note.id)).toEqual(['note-evening', 'note-b', 'note-z', 'note-a'])
    expect(existing.map((note) => note.id)).toEqual(['note-z', 'note-a', 'note-evening'])
  })
})

describe('validateDraft', () => {
  it.each([
    ['blank narrative', { ...baseNote, narrative: '   ' }],
    ['invalid timestamp', { ...baseNote, timestamp: '25:00' }],
    ['out-of-order SOAP labels', { ...baseNote, narrative: 'S: 통증 호소.\nA: 관찰함.\nO: V/S 확인.\nP: 경과 관찰.' }],
    ['labels not at line starts', { ...baseNote, narrative: '기록 S: 통증 호소.\nO: V/S 확인.\nA: 관찰함.\nP: 경과 관찰.' }],
  ])('rejects a draft with %s', (_reason, draft) => {
    expect(validateDraft(draft).valid).toBe(false)
  })

  it('accepts one non-empty unified narrative with ordered SOAP lines', () => {
    expect(validateDraft(baseNote)).toEqual({ valid: true, errors: [] })
  })

  it.each([
    'S:   \nO: V/S 확인됨.\nA: 상태 관찰함.\nP: 경과 관찰함.',
    'S: 특이 호소 없음.\nO:\nA: 상태 관찰함.\nP: 경과 관찰함.',
    'S: 특이 호소 없음.\nO: V/S 확인됨.\nA: \nP: 경과 관찰함.',
    'S: 특이 호소 없음.\nO: V/S 확인됨.\nA: 상태 관찰함.\nP:',
  ])('rejects a draft with an empty SOAP section body', (narrative) => {
    expect(validateDraft({ ...baseNote, narrative })).toEqual({
      valid: false,
      errors: ['S:, O:, A:, P: 각 항목의 내용을 입력하세요.'],
    })
  })

  it('rejects an unresolved bracketed nurse-review marker', () => {
    const result = validateDraft({
      ...baseNote,
      narrative: 'S: [간호사 확인 필요]\nO: V/S 확인됨.\nA: 상태 관찰함.\nP: 경과 관찰함.',
    })

    expect(result).toEqual({
      valid: false,
      errors: ['대괄호로 남긴 간호사 확인 필요/TODO 표시를 해결하세요.'],
    })
  })
})

describe('getSuggestion', () => {
  const evidence: Evidence[] = [
    { id: 'evidence-vs', timestamp: '14:00', category: 'V/S', label: 'V/S', detail: 'BP 120/70 mmHg, PR 78회/분, BT 36.7℃ 확인됨.', subjective: '특이 호소 없음.', state: '확인됨' },
    { id: 'evidence-prn', timestamp: '21:30', category: 'PRN', label: 'PRN 투약', detail: '복부 통증 NRS 5점 호소하여 PRN 진통제 투약함.', subjective: '복부 통증 NRS 5점 호소함.', state: '확인됨' },
    { id: 'evidence-general', timestamp: '18:00', category: '일반', label: '배액관', detail: 'JP 배액관 고정 상태 양호하며 장액성 배액 30 mL 확인됨.', subjective: '배액관 부위 불편감 호소 없음.', state: '최근' },
  ]

  it.each([
    ['V/S', ['evidence-vs']],
    ['PRN', ['evidence-prn']],
    ['일반', ['evidence-general']],
  ] as const)('selects only %s evidence for a category-aware suggestion', (category, evidenceIds) => {
    expect(getSuggestion(category, evidence)?.evidenceIds).toEqual(evidenceIds)
  })

  it('returns the full factual completion text with provenance', () => {
    const suggestion = getSuggestion('PRN', evidence)

    expect(suggestion).toMatchObject({ category: 'PRN', evidenceIds: ['evidence-prn'] })
    expect(suggestion?.completion).toBe('복부 통증 NRS 5점 호소하여 PRN 진통제 투약함.')
  })

  it.each([
    ['medication dose change', '진통제 용량 증량 필요'],
    ['test recommendation', '추가 검사 필요'],
    ['treatment recommendation', '치료 시작 필요'],
    ['acuity decision', '고위험 상태로 판단됨'],
  ])('does not turn a %s into a suggestion', (_description, detail) => {
    const unsafeEvidence: Evidence[] = [
      { id: 'evidence-unsafe', timestamp: '22:00', category: 'PRN', label: 'unsafe', detail, subjective: '통증 호소함.', state: '확인됨' },
    ]

    expect(getSuggestion('PRN', unsafeEvidence)).toBeNull()
  })

  it('keeps factual medication-administration evidence eligible for a suggestion', () => {
    const administrationEvidence: Evidence[] = [
      { id: 'evidence-administration', timestamp: '22:00', category: 'PRN', label: '투약', detail: 'Stilnox 10mg PO 투약함.', subjective: '수면 어려움 호소함.', state: '확인됨' },
    ]

    expect(getSuggestion('PRN', administrationEvidence)).toMatchObject({
      completion: 'Stilnox 10mg PO 투약함.',
      evidenceIds: ['evidence-administration'],
    })
  })
})
