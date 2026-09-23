// Logic from charting_assistant 1cec3bb; extensionless imports for Next bundling.
import type { NoteCategory } from './charting'

export interface LocalFactEvidence {
  id: string
  category: NoteCategory
  label: string
  detail: string
  subjective: string
  factText?: string
}

export const CURRENT_DRAFT_EVIDENCE_ID = 'current-draft'

export interface LocalSoapSections {
  subjective: string
  objective: string
  assessment: string
  plan: string
}

export interface LocalReviewPrompt {
  id: 'post-medication-response'
  evidenceIds: string[]
  message: string
}

export interface LocalFactInterpretation {
  sections: LocalSoapSections
  evidenceIds: string[]
  reviewPrompts?: LocalReviewPrompt[]
  conflict?: {
    evidenceIds: string[]
    message: string
  }
}

export interface LocalFactInput {
  draftText: string
  category: NoteCategory
  evidence: LocalFactEvidence[]
}

export type LocalFactAnalysis =
  | { status: 'recognized'; interpretation: LocalFactInterpretation }
  | { status: 'unsupported' }
  | { status: 'invalid'; reason: 'out-of-range-pain' | 'planned-ambulation' }

type LocalFactSignal =
  | { kind: 'sleep'; value: 'positive' | 'negative' }
  | { kind: 'pain'; value: string }
  | { kind: 'drain'; value: string }
  | { kind: 'ambulation'; value: 'completed' | 'unavailable' }
  | { kind: 'nausea'; value: 'absent' }
  | { kind: 'dyspnea'; value: 'absent' }

const positiveSleepPattern = /(?:잘\s*(?:잠|잤)|숙면|수면\s*(?:상태\s*)?양호)/
const negativeSleepPattern = /(?:잠(?:이|을)?[^.!?]*(?:안|못|오지\s*않)|숙면[^.!?]*(?:안|못|않)|수면[^.!?]*(?:어려|불량|양호[^.!?]*(?:않|아님|못))|불면)/
const absentNauseaPattern = /(?:오심|메스꺼움|구역)(?:은|는|이|가)?\s*(?:없|안\s*함)/
const painScorePattern = /(?:통증|NRS)(?:은|는|이|가|\s*점수)?\s*(-?\d+(?:\.\d+)?)\s*(?:점)?(?![\d.])/i
const drainAmountPattern = /배액(?:량)?\s*(\d+(?:\.\d+)?)\s*(?:cc|mL|ml)/i
const ambulationPattern = /(?:복도[^.!?]*(?:한\s*바퀴|1\s*바퀴|보행|걸음)|보행[^.!?]*(?:시행|함|완료))/
const unavailableAmbulationPattern = /(?:복도\s*)?보행[^.!?]*(?:못|안\s*함|하지\s*못|불가)/
const plannedAmbulationPattern = /보행[^.!?]*(?:예정|계획|하려\s*함)/
const absentDyspneaPattern = /(?:숨\s*찬|호흡\s*곤란|호흡\s*불편)[^.!?]*(?:없|안\s*함)/
const completedSleepMedicationPattern = /(?:Stilnox|Ambien|zolpidem|졸피뎀)(?:\s+\d+(?:\.\d+)?\s*mg)?\s+\b(?:PO|IV|IM|SC)\b\s+투약(?:함|됨|\s*시행함)/i
const postMedicationSleepResponsePattern = /투약\s*후[^.!?]*(?:잘\s*(?:잠|잤)|잠들|숙면|수면[^.!?]*(?:양호|호전|중))/

export function interpretLocalNurseFacts(
  input: LocalFactInput,
): LocalFactInterpretation | null {
  const normalizedDraft = input.draftText.replaceAll(/\s+/g, ' ').trim()
  const isShortDraft = normalizedDraft.length <= 30
  const painScore = painScorePattern.exec(normalizedDraft)?.[1]
  const drainAmount = drainAmountPattern.exec(normalizedDraft)?.[1]

  if (unavailableAmbulationPattern.test(normalizedDraft)) {
    return buildLocalInterpretation(
      input,
      normalizedDraft,
      {
        subjective: '보행하지 못했다고 말함.',
        objective: '보행 시행하지 못함.',
        assessment: '보행 미시행 상태를 간호사가 확인함.',
        plan: '보행 미시행 내용을 기록함.',
      },
      { kind: 'ambulation', value: 'unavailable' },
    )
  }

  if (absentDyspneaPattern.test(normalizedDraft)) {
    return buildLocalInterpretation(
      input,
      normalizedDraft,
      {
        subjective: '숨찬 증상 없다고 말함.',
        objective: '호흡 불편 여부에 대한 현재 입력을 확인함.',
        assessment: '호흡 불편 호소 없는 상태를 간호사가 확인함.',
        plan: '호흡 양상과 불편 여부를 이어서 관찰함.',
      },
      { kind: 'dyspnea', value: 'absent' },
    )
  }

  if (ambulationPattern.test(normalizedDraft)) {
    return buildLocalInterpretation(
      input,
      normalizedDraft,
      {
        subjective: '보행 중 특이 호소 없음.',
        objective: '복도 보행 1회 시행함.',
        assessment: '보행 후 상태를 간호사가 확인함.',
        plan: '보행 후 불편감과 상태 변화를 이어서 관찰함.',
      },
      { kind: 'ambulation', value: 'completed' },
    )
  }

  if (isShortDraft && drainAmount !== undefined) {
    return buildLocalInterpretation(
      input,
      normalizedDraft,
      {
        subjective: '특이 호소 없음.',
        objective: `배액량 ${drainAmount}mL 확인함.`,
        assessment: '현재 배액 상태를 간호사가 확인함.',
        plan: '배액량과 양상 변화를 이어서 관찰함.',
      },
      { kind: 'drain', value: drainAmount },
    )
  }

  if (painScore !== undefined && isValidPainScore(painScore)) {
    return buildLocalInterpretation(
      input,
      normalizedDraft,
      {
        subjective: `통증 NRS ${painScore}점이라고 말함.`,
        objective: `통증 점수 NRS ${painScore}점 확인함.`,
        assessment: '현재 통증 정도를 간호사가 확인함.',
        plan: '통증 점수와 상태 변화를 이어서 관찰함.',
      },
      { kind: 'pain', value: painScore },
    )
  }

  if (absentNauseaPattern.test(normalizedDraft)) {
    return buildLocalInterpretation(
      input,
      normalizedDraft,
      {
        subjective: '오심 없다고 말함.',
        objective: '오심 여부에 대한 현재 입력을 확인함.',
        assessment: '오심 호소 없는 상태를 간호사가 확인함.',
        plan: '오심 발생 여부를 이어서 관찰함.',
      },
      { kind: 'nausea', value: 'absent' },
    )
  }

  if (isShortDraft && negativeSleepPattern.test(normalizedDraft)) {
    return buildLocalInterpretation(
      input,
      normalizedDraft,
      {
        subjective: '잠을 자지 못했다고 호소함.',
        objective: '수면 상태에 대한 현재 입력을 확인함.',
        assessment: '수면 불편 호소 상태를 간호사가 확인함.',
        plan: '수면 및 안위 상태 변화를 이어서 관찰함.',
      },
      { kind: 'sleep', value: 'negative' },
    )
  }

  if (!positiveSleepPattern.test(normalizedDraft)) {
    return null
  }

  return buildLocalInterpretation(
    input,
    normalizedDraft,
    {
      subjective: '잘 잤다고 말함.',
      objective: '수면 상태에 대한 현재 입력을 확인함.',
      assessment: '수면 상태를 간호사가 확인함.',
      plan: '수면 및 안위 상태 변화를 이어서 관찰함.',
    },
    { kind: 'sleep', value: 'positive' },
  )
}

export function analyzeLocalNurseFacts(input: LocalFactInput): LocalFactAnalysis {
  const normalizedDraft = input.draftText.replaceAll(/\s+/g, ' ').trim()
  const painScore = painScorePattern.exec(normalizedDraft)?.[1]

  if (painScore !== undefined && !isValidPainScore(painScore)) {
    return { status: 'invalid', reason: 'out-of-range-pain' }
  }

  if (plannedAmbulationPattern.test(normalizedDraft)) {
    return { status: 'invalid', reason: 'planned-ambulation' }
  }

  const interpretation = interpretLocalNurseFacts(input)
  return interpretation
    ? { status: 'recognized', interpretation }
    : { status: 'unsupported' }
}

export function getLocalReviewPrompts(input: LocalFactInput): LocalReviewPrompt[] {
  const normalizedDraft = input.draftText.replaceAll(/\s+/g, ' ').trim()
  const currentSignal = factSignalFromText(normalizedDraft)

  return currentSignal
    ? buildReviewPrompts(currentSignal, input.evidence)
    : []
}

export function doesNarrativeContradictLocalFacts(
  draftText: string,
  narrative: string,
): boolean {
  const draftPolarity = sleepPolarity(draftText)
  const narrativePolarity = sleepPolarity(narrative)

  return Boolean(
    draftPolarity && narrativePolarity && draftPolarity !== narrativePolarity,
  )
}

function buildLocalInterpretation(
  input: LocalFactInput,
  normalizedDraft: string,
  sections: LocalSoapSections,
  currentSignal: LocalFactSignal,
): LocalFactInterpretation {
  const relatedEvidence = input.evidence.map((item) => ({
    item,
    signal: factSignalFromText(evidenceText(item)),
  }))
  const supportingEvidenceIds = relatedEvidence
    .filter(({ item, signal }) => (
      item.category === input.category && signalsMatch(currentSignal, signal)
    ))
    .map(({ item }) => item.id)
  const conflictingEvidenceIds = relatedEvidence
    .filter(({ signal }) => signalsConflict(currentSignal, signal))
    .map(({ item }) => item.id)
  const reviewPrompts = getLocalReviewPrompts(input)

  return {
    sections,
    evidenceIds: [CURRENT_DRAFT_EVIDENCE_ID, ...supportingEvidenceIds],
    ...(reviewPrompts.length > 0 ? { reviewPrompts } : {}),
    ...(conflictingEvidenceIds.length > 0
      ? {
          conflict: {
            evidenceIds: conflictingEvidenceIds,
            message: currentSignal.kind === 'sleep' && currentSignal.value === 'positive'
              ? `현재 입력 “${normalizedDraft}”이 이전 기록 “잠이 안 온다”와 다릅니다. 현재 상태와 기록 시점을 확인하세요.`
              : `현재 입력 “${normalizedDraft}”이 이전 같은 항목의 기록과 다릅니다. 현재 상태와 기록 시점을 확인하세요.`,
          },
        }
      : {}),
  }
}

function buildReviewPrompts(
  currentSignal: LocalFactSignal,
  evidence: LocalFactEvidence[],
): LocalReviewPrompt[] {
  if (currentSignal.kind !== 'sleep' || currentSignal.value !== 'negative') {
    return []
  }

  const medicationEvidenceIds = evidence
    .filter((item) => item.category === 'PRN' && completedSleepMedicationPattern.test(evidenceText(item)))
    .map((item) => item.id)
  const hasPostMedicationResponse = evidence.some((item) =>
    postMedicationSleepResponsePattern.test(evidenceText(item)),
  )

  if (medicationEvidenceIds.length === 0 || hasPostMedicationResponse) {
    return []
  }

  return [{
    id: 'post-medication-response',
    evidenceIds: medicationEvidenceIds,
    message: 'PRN 투약 후 수면 상태·반응을 현재 근거에서 찾지 못했습니다. 기록 전 확인하세요.',
  }]
}

function factSignalFromText(text: string): LocalFactSignal | null {
  const painScore = painScorePattern.exec(text)?.[1]
  const drainAmount = drainAmountPattern.exec(text)?.[1]

  if (unavailableAmbulationPattern.test(text)) {
    return { kind: 'ambulation', value: 'unavailable' }
  }
  if (ambulationPattern.test(text) && !plannedAmbulationPattern.test(text)) {
    return { kind: 'ambulation', value: 'completed' }
  }
  const sleepValue = sleepPolarity(text)
  if (sleepValue) {
    return { kind: 'sleep', value: sleepValue }
  }
  if (painScore !== undefined && isValidPainScore(painScore)) {
    return { kind: 'pain', value: painScore }
  }
  if (drainAmount !== undefined) {
    return { kind: 'drain', value: drainAmount }
  }
  if (absentNauseaPattern.test(text)) {
    return { kind: 'nausea', value: 'absent' }
  }
  if (absentDyspneaPattern.test(text)) {
    return { kind: 'dyspnea', value: 'absent' }
  }

  return null
}

function signalsMatch(current: LocalFactSignal, prior: LocalFactSignal | null): boolean {
  return Boolean(prior && current.kind === prior.kind && current.value === prior.value)
}

function signalsConflict(current: LocalFactSignal, prior: LocalFactSignal | null): boolean {
  return Boolean(prior && current.kind === prior.kind && current.value !== prior.value)
}

function sleepPolarity(text: string): 'positive' | 'negative' | null {
  if (negativeSleepPattern.test(text)) {
    return 'negative'
  }

  return positiveSleepPattern.test(text) ? 'positive' : null
}

function isValidPainScore(value: string): boolean {
  const score = Number(value)
  return Number.isInteger(score) && score >= 0 && score <= 10
}

function evidenceText(evidence: LocalFactEvidence): string {
  return [
    evidence.subjective,
    evidence.detail,
    evidence.factText ?? '',
  ].join(' ')
}
