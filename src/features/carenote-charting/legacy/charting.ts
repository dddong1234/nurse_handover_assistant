// Ported unchanged from charting_assistant 1cec3bb; no server/model calls in this module.
export type NoteCategory = 'V/S' | 'PRN' | '일반'

export type PatientStatus = 'stable' | 'watch' | 'danger'

export interface NursingNote {
  id: string
  timestamp: string
  category: NoteCategory
  narrative: string
  nurseSignature: string
  signatureState: 'signed-fixture' | 'unsigned-demo'
}

export interface Evidence {
  id: string
  timestamp: string
  category: NoteCategory
  label: string
  detail: string
  subjective: string
  factText?: string
  state: '확인됨' | '최근'
}

export interface Suggestion {
  id: string
  category: NoteCategory
  completion: string
  evidenceIds: string[]
}

export interface Patient {
  id: string
  bed: string
  name: string
  sex: 'F' | 'M'
  age: number
  service: '일반외과'
  surgery: string
  postoperativeDay: number
  status: PatientStatus
  isSynthetic: true
  notes: NursingNote[]
  evidence: Evidence[]
}

export interface DraftValidation {
  valid: boolean
  errors: string[]
}

const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const soapLabels = ['S', 'O', 'A', 'P'] as const
const unresolvedReviewMarkerPattern = /\[[^\]\r\n]*(?:간호사\s*확인\s*필요|확인\s*필요|TODO)[^\]\r\n]*\]/i
const unsafeSuggestionPattern = /진단|처방|오더|권고|diagnos|order|recommend|(?:용량|투여량|용법).*(?:증량|감량|변경|조절|필요)|(?:증량|감량|변경|조절).*(?:용량|투여량|용법)|(?:추가\s*)?검사\s*(?:필요|시행\s*필요|권고|요청|계획)|치료\s*(?:시작|변경|중단|필요|권고|계획)|(?:고위험|응급|중증|위급|불안정)\s*(?:상태|환자)?\s*(?:로|으로)?\s*(?:판단|결정|분류|평가)/i
const factualEvidencePattern = /(?:\b(?:BP|PR|RR|BT|SpO₂)\b|NRS\s*\d+점|(?:PO|IV|IM|SC)\s*투약함|투약(?:함|\s*후)|섭취|배액|보행|호소(?:함|없음)|확인됨|관찰됨|침상|호흡|앉기|호출벨|양호|없음|안정)/i

export function parseTime(timestamp: string): number | null {
  if (!validTime.test(timestamp)) {
    return null
  }

  const [hours, minutes] = timestamp.split(':').map(Number)
  return hours * 60 + minutes
}

export function insertChronologically(notes: NursingNote[], newNote: NursingNote): NursingNote[] {
  return [newNote, ...notes].sort((left, right) => {
    const rightTime = parseTime(right.timestamp)
    const leftTime = parseTime(left.timestamp)

    if (rightTime !== null && leftTime !== null && rightTime !== leftTime) {
      return rightTime - leftTime
    }

    if (rightTime !== null && leftTime === null) {
      return -1
    }

    if (rightTime === null && leftTime !== null) {
      return 1
    }

    return 0
  })
}

export function validateDraft(draft: Pick<NursingNote, 'timestamp' | 'narrative'>): DraftValidation {
  const errors: string[] = []

  if (parseTime(draft.timestamp) === null) {
    errors.push('유효한 HH:mm 시간을 입력하세요.')
  }

  if (!draft.narrative.trim()) {
    errors.push('SOAP 간호기록을 입력하세요.')
  } else if (!hasOrderedSoapLines(draft.narrative)) {
    errors.push('S:, O:, A:, P:를 각각 줄 시작에 순서대로 입력하세요.')
  } else if (!hasNonEmptySoapSectionBodies(draft.narrative)) {
    errors.push('S:, O:, A:, P: 각 항목의 내용을 입력하세요.')
  }

  if (unresolvedReviewMarkerPattern.test(draft.narrative)) {
    errors.push('대괄호로 남긴 간호사 확인 필요/TODO 표시를 해결하세요.')
  }

  return { valid: errors.length === 0, errors }
}

export function getSuggestion(category: NoteCategory, evidence: Evidence[]): Suggestion | null {
  const supportingEvidence = evidence.filter(
    (item) => item.category === category && isSafeFactualEvidence(item.detail),
  )

  if (supportingEvidence.length === 0) {
    return null
  }

  return {
    id: `suggestion-${category}`,
    category,
    completion: supportingEvidence.map((item) => item.detail).join(' '),
    evidenceIds: supportingEvidence.map((item) => item.id),
  }
}

function isSafeFactualEvidence(detail: string): boolean {
  return !unsafeSuggestionPattern.test(detail) && factualEvidencePattern.test(detail)
}

function hasOrderedSoapLines(narrative: string): boolean {
  const labels = Array.from(narrative.matchAll(/^([SOAP]):/gm), (match) => match[1])
  return soapLabels.every((label, index) => labels[index] === label)
}

function hasNonEmptySoapSectionBodies(narrative: string): boolean {
  const sections = Array.from(
    narrative.matchAll(/^([SOAP]):[^\S\r\n]*(.*)$/gm),
    (match) => ({ body: match[2], label: match[1] }),
  )

  return soapLabels.every(
    (label, index) => sections[index]?.label === label && sections[index].body.trim().length > 0,
  )
}
