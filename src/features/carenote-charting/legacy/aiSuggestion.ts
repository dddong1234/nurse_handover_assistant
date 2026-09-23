// Logic from charting_assistant 1cec3bb; extensionless imports for Next bundling.
import type { Evidence, NoteCategory } from './charting'
import {
  analyzeLocalNurseFacts,
  CURRENT_DRAFT_EVIDENCE_ID,
  doesNarrativeContradictLocalFacts,
} from './localFactInterpreter'

export type AiSuggestionEvidence = Pick<
    Evidence,
    'id' | 'timestamp' | 'category' | 'label' | 'detail' | 'subjective' | 'factText'
  >

export interface AiSuggestionRequest {
  draftText: string
  category: NoteCategory
  evidence: AiSuggestionEvidence[]
}

export interface AiSuggestionResult {
  source: 'model' | 'fallback'
  narrative: string
  evidenceIds: string[]
  reason?: 'missing-key' | 'model-error' | 'invalid-model-output' | 'rate-limited'
}

export interface StructuredSoapSections {
  subjective: string
  objective: string
  assessment: string
  plan: string
  evidenceIds: string[]
}

export type ParsedAiSuggestionRequest =
  | { ok: true; value: AiSuggestionRequest }
  | { ok: false; error: string }

export type StructuredSuggestionValidation =
  | { valid: true; result: AiSuggestionResult }
  | { valid: false; unsupportedClaims: string[] }

const categories: NoteCategory[] = ['V/S', 'PRN', '일반']
const unsafeSuggestionPattern = /진단|(?:추가\s*)?처방\s*(?:필요|권고|요청|추가|변경|중단|시작)|처방(?:을|이|함|하|되|변경|추가)|(?:추가\s*)?(?:투약|투여)\s*(?:필요|권고|요청|추가|변경|중단|시작)|(?:진통제|수면제|항생제|약물|약)\s*(?:투약|투여)?\s*(?:필요|권고|요청|추가|변경|중단|시작)|오더|권고|diagnos|order|recommend|(?:용량|투여량|용법).*(?:증량|감량|변경|조절|필요)|(?:증량|감량|변경|조절).*(?:용량|투여량|용법)|(?:추가\s*)?검사\s*(?:필요|시행\s*필요|권고|요청|계획)|치료\s*(?:시작|변경|중단|필요|권고|계획)|(?:고위험|응급|중증|위급|불안정)\s*(?:상태|환자)?\s*(?:로|으로)?\s*(?:판단|결정|분류|평가)/i
const factualEvidencePattern = /(?:\b(?:BP|PR|HR|RR|BT|SpO₂)\b|NRS\s*\d+점|(?:PO|IV|IM|SC)\s*투약함|투약(?:함|\s*후)|섭취|배액|보행|호소(?:함|없음)|확인됨|관찰됨|침상|호흡|앉기|호출벨|양호|없음|안정)/i
const numberTokenPattern = /\d+(?:[./]\d+)*(?:\s?(?:mg|mL|mmHg|회\/분|점|%|℃))?/gi
const latinTokenPattern = /\b[A-Za-z][A-Za-z0-9-]{2,}\b/g
const allowedLatinTokens = new Set(['soap', 'spo', 'mmhg'])

export function parseAiSuggestionRequest(value: unknown): ParsedAiSuggestionRequest {
  if (!isRecord(value)) {
    return { ok: false, error: '요청 형식이 올바르지 않습니다.' }
  }

  if (typeof value.draftText !== 'string' || !value.draftText.trim()) {
    return { ok: false, error: '간호 사실 입력이 필요합니다.' }
  }

  if (value.draftText.length > 2_000) {
    return { ok: false, error: '간호 사실 입력은 2,000자 이하여야 합니다.' }
  }

  if (typeof value.category !== 'string' || !categories.includes(value.category as NoteCategory)) {
    return { ok: false, error: '기록 분류가 올바르지 않습니다.' }
  }

  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    return { ok: false, error: '제안 근거가 필요합니다.' }
  }

  if (value.evidence.length > 12 || !value.evidence.every(isSuggestionEvidence)) {
    return { ok: false, error: '제안 근거 형식이 올바르지 않습니다.' }
  }

  return {
    ok: true,
    value: {
      draftText: value.draftText.trim(),
      category: value.category as NoteCategory,
      evidence: value.evidence,
    },
  }
}

export function buildFallbackSuggestion(
  request: AiSuggestionRequest,
): AiSuggestionResult | null {
  if (unsafeSuggestionPattern.test(request.draftText)) {
    return null
  }

  const localAnalysis = analyzeLocalNurseFacts(request)
  if (localAnalysis.status === 'invalid') {
    return null
  }

  if (
    localAnalysis.status === 'recognized' &&
    localAnalysis.interpretation.evidenceIds.length > 0
  ) {
    return {
      source: 'fallback',
      narrative: formatSoapNarrative(localAnalysis.interpretation.sections),
      evidenceIds: localAnalysis.interpretation.evidenceIds,
    }
  }

  if (!factualEvidencePattern.test(request.draftText)) {
    return null
  }

  const evidence = request.evidence.filter(
    (item) =>
      item.category === request.category &&
      !unsafeSuggestionPattern.test(item.detail) &&
      factualEvidencePattern.test(item.detail),
  )

  if (evidence.length === 0) {
    return null
  }

  const subjective = evidence[0]?.subjective ?? '특이 호소 없음.'
  const objective =
    evidence.find((item) => item.label.includes('V/S'))?.detail ??
    evidence[0]?.detail ??
    '관찰 사실을 확인함.'
  const assessment = subjective.includes('잠')
    ? '수면 불편 호소 상태를 간호사가 확인함.'
    : request.category === 'V/S'
      ? '활력징후 상태를 간호사가 확인함.'
      : '현재 상태를 간호사가 확인함.'
  const medicationEvidence = evidence.find((item) => item.label.includes('투약'))
  const plan = medicationEvidence
    ? medicationEvidence.label.includes('Dr. 박지훈 처방')
      ? `Dr. 박지훈 처방에 따라 ${medicationEvidence.detail}`
      : medicationEvidence.detail
    : '상태 변화 여부를 이어서 관찰함.'

  return {
    source: 'fallback',
    narrative: formatSoapNarrative({ subjective, objective, assessment, plan }),
    evidenceIds: evidence.map((item) => item.id),
  }
}

export function isSafeModelDraft(request: AiSuggestionRequest): boolean {
  const draftText = request.draftText.trim()

  return (
    /[가-힣]/.test(draftText) &&
    !unsafeSuggestionPattern.test(draftText) &&
    analyzeLocalNurseFacts(request).status !== 'invalid'
  )
}

export function validateStructuredSuggestion(
  request: AiSuggestionRequest,
  value: unknown,
): StructuredSuggestionValidation {
  const sections = parseStructuredSections(value)

  if (!sections) {
    return { valid: false, unsupportedClaims: ['SOAP 응답 형식 오류'] }
  }

  const narrative = formatSoapNarrative(sections)

  if (unsafeSuggestionPattern.test(narrative)) {
    return {
      valid: false,
      unsupportedClaims: ['허용되지 않은 임상 판단 또는 지시 표현'],
    }
  }

  if (doesNarrativeContradictLocalFacts(request.draftText, narrative)) {
    return {
      valid: false,
      unsupportedClaims: ['모델 제안이 현재 간호사 입력과 상충함'],
    }
  }

  const suppliedEvidenceIds = new Set([
    CURRENT_DRAFT_EVIDENCE_ID,
    ...request.evidence.map((item) => item.id),
  ])
  const missingEvidenceIds = sections.evidenceIds.filter((id) => !suppliedEvidenceIds.has(id))

  if (missingEvidenceIds.length > 0) {
    return {
      valid: false,
      unsupportedClaims: missingEvidenceIds.map((id) => `근거 ID: ${id}`),
    }
  }

  const sourceText = [
    request.draftText,
    ...request.evidence.flatMap((item) => [
      item.label,
      item.detail,
      item.subjective,
      item.factText ?? '',
    ]),
  ].join(' ')
  const unsupportedNumbers = difference(extractTokens(narrative, numberTokenPattern), sourceText)
    .map((token) => `수치: ${token}`)
  const unsupportedLatin = difference(
    extractTokens(narrative, latinTokenPattern).filter(
      (token) => !allowedLatinTokens.has(normalizeToken(token)),
    ),
    sourceText,
  ).map((token) => `용어: ${token}`)
  const unsupportedClaims = [...unsupportedNumbers, ...unsupportedLatin]

  if (unsupportedClaims.length > 0) {
    return { valid: false, unsupportedClaims }
  }

  return {
    valid: true,
    result: {
      source: 'model',
      narrative,
      evidenceIds: sections.evidenceIds,
    },
  }
}

function formatSoapNarrative(
  sections: Pick<StructuredSoapSections, 'subjective' | 'objective' | 'assessment' | 'plan'>,
): string {
  return [
    `S: ${sections.subjective.trim()}`,
    `O: ${sections.objective.trim()}`,
    `A: ${sections.assessment.trim()}`,
    `P: ${sections.plan.trim()}`,
  ].join('\n')
}

function parseStructuredSections(value: unknown): StructuredSoapSections | null {
  if (!isRecord(value)) {
    return null
  }

  const fields = ['subjective', 'objective', 'assessment', 'plan'] as const
  if (fields.some((field) => typeof value[field] !== 'string' || !value[field].trim())) {
    return null
  }

  if (
    !Array.isArray(value.evidenceIds) ||
    value.evidenceIds.length === 0 ||
    !value.evidenceIds.every((id) => typeof id === 'string' && id.trim())
  ) {
    return null
  }

  return {
    subjective: value.subjective as string,
    objective: value.objective as string,
    assessment: value.assessment as string,
    plan: value.plan as string,
    evidenceIds: value.evidenceIds as string[],
  }
}

function isSuggestionEvidence(value: unknown): value is AiSuggestionEvidence {
  if (!isRecord(value)) {
    return false
  }

  const requiredFields = ['id', 'timestamp', 'category', 'label', 'detail', 'subjective'] as const
  const validRequiredFields = requiredFields.every(
    (field) => typeof value[field] === 'string' && value[field].trim().length > 0,
  )
  const validFactText = value.factText === undefined || typeof value.factText === 'string'

  return validRequiredFields && validFactText && categories.includes(value.category as NoteCategory)
}

function extractTokens(text: string, pattern: RegExp): string[] {
  return Array.from(text.matchAll(pattern), (match) => match[0])
}

function difference(tokens: string[], sourceText: string): string[] {
  const sourceTokens = sourceText.toLocaleLowerCase('en-US').replaceAll(' ', '')
  const seen = new Set<string>()

  return tokens.filter((token) => {
    const normalized = normalizeToken(token)
    if (!normalized || seen.has(normalized) || sourceTokens.includes(normalized)) {
      return false
    }

    seen.add(normalized)
    return true
  })
}

function normalizeToken(token: string): string {
  return token.toLocaleLowerCase('en-US').replaceAll(' ', '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
