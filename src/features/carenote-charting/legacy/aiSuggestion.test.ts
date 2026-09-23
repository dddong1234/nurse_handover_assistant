// Regression tests ported from charting_assistant 1cec3bb; not new user validation.
import { describe, expect, it } from 'vitest'
import {
  buildFallbackSuggestion,
  isSafeModelDraft,
  parseAiSuggestionRequest,
  validateStructuredSuggestion,
  type AiSuggestionRequest,
} from './aiSuggestion'

const request: AiSuggestionRequest = {
  category: 'PRN',
  draftText: '잠이 안 온다고 호소함. V/S 안정적. PRN 수면제 처방 확인함.',
  evidence: [
    {
      id: 'sleep-claim',
      timestamp: '21:30',
      category: 'PRN',
      label: '환자 진술',
      detail: '“잠이 안 온다”고 호소함.',
      subjective: '“잠이 안 온다”고 호소함.',
    },
    {
      id: 'vitals',
      timestamp: '21:35',
      category: 'PRN',
      label: '최근 V/S',
      detail: 'BP 110/70 mmHg, HR 80회/분, RR 18회/분, BT 36.5℃, SpO₂ 98% 확인됨.',
      subjective: '특이 호소 없음.',
    },
    {
      id: 'medication',
      timestamp: '18:12',
      category: 'PRN',
      label: 'PRN 투약 · Dr. 박지훈 처방',
      detail: 'Stilnox 10mg PO 투약함.',
      subjective: '통증 호소 없음.',
    },
  ],
}

const groundedSections = {
  subjective: '“잠이 안 온다”고 호소함.',
  objective: 'BP 110/70 mmHg, HR 80회/분, RR 18회/분, BT 36.5℃, SpO₂ 98% 확인됨.',
  assessment: '수면 불편 호소 상태를 간호사가 확인함.',
  plan: 'Stilnox 10mg PO 투약함.',
  evidenceIds: ['sleep-claim', 'vitals', 'medication'],
}

describe('AI suggestion domain', () => {
  it('builds one deterministic SOAP narrative that stays available before model output', () => {
    expect(buildFallbackSuggestion(request)).toEqual({
      source: 'fallback',
      narrative:
        'S: “잠이 안 온다”고 호소함.\nO: BP 110/70 mmHg, HR 80회/분, RR 18회/분, BT 36.5℃, SpO₂ 98% 확인됨.\nA: 수면 불편 호소 상태를 간호사가 확인함.\nP: Dr. 박지훈 처방에 따라 Stilnox 10mg PO 투약함.',
      evidenceIds: ['sleep-claim', 'vitals', 'medication'],
    })
  })

  it('uses a current positive sleep fact instead of repeating contradictory prior evidence', () => {
    const suggestion = buildFallbackSuggestion({
      ...request,
      draftText: '잘잠',
    })

    expect(suggestion?.narrative).toBe(
      'S: 잘 잤다고 말함.\nO: 수면 상태에 대한 현재 입력을 확인함.\nA: 수면 상태를 간호사가 확인함.\nP: 수면 및 안위 상태 변화를 이어서 관찰함.',
    )
    expect(suggestion?.narrative).not.toContain('잠이 안 온다')
  })

  it('does not offer a fallback for diagnosis or order language in the current draft', () => {
    expect(buildFallbackSuggestion({
      ...request,
      draftText: '불면증 진단',
    })).toBeNull()
  })

  it('does not recycle old evidence when the current draft cannot be interpreted', () => {
    expect(buildFallbackSuggestion({
      ...request,
      draftText: 'asdf',
    })).toBeNull()
  })

  it('does not turn planned ambulation into completed historical care', () => {
    expect(buildFallbackSuggestion({
      ...request,
      draftText: '보행 예정',
    })).toBeNull()
  })

  it('does not recycle old evidence for an out-of-range NRS score', () => {
    expect(buildFallbackSuggestion({
      ...request,
      draftText: 'NRS 11점',
    })).toBeNull()
  })

  it('allows an unsupported but safe Korean observation to use the model path', () => {
    expect(isSafeModelDraft({
      ...request,
      draftText: '기분이 편안하다고 말함',
    })).toBe(true)
  })

  it('blocks unsafe, invalid, and non-Korean noise from the model path', () => {
    expect(isSafeModelDraft({ ...request, draftText: '불면증 진단' })).toBe(false)
    expect(isSafeModelDraft({ ...request, draftText: 'NRS 11점' })).toBe(false)
    expect(isSafeModelDraft({ ...request, draftText: '보행 예정' })).toBe(false)
    expect(isSafeModelDraft({ ...request, draftText: 'asdf' })).toBe(false)
    expect(isSafeModelDraft({ ...request, draftText: '추가 처방 필요' })).toBe(false)
    expect(isSafeModelDraft({ ...request, draftText: '추가 투약 필요' })).toBe(false)
    expect(isSafeModelDraft({ ...request, draftText: '진통제 투여 필요' })).toBe(false)
  })

  it('rejects a malformed request instead of forwarding it to a model', () => {
    expect(parseAiSuggestionRequest({ category: 'PRN', draftText: '', evidence: [] })).toEqual({
      ok: false,
      error: '간호 사실 입력이 필요합니다.',
    })
  })

  it('accepts grounded structured sections and formats one unified narrative', () => {
    expect(validateStructuredSuggestion(request, groundedSections)).toEqual({
      valid: true,
      result: {
        source: 'model',
        narrative:
          'S: “잠이 안 온다”고 호소함.\nO: BP 110/70 mmHg, HR 80회/분, RR 18회/분, BT 36.5℃, SpO₂ 98% 확인됨.\nA: 수면 불편 호소 상태를 간호사가 확인함.\nP: Stilnox 10mg PO 투약함.',
        evidenceIds: ['sleep-claim', 'vitals', 'medication'],
      },
    })
  })

  it('rejects a model narrative that contradicts the current local sleep fact', () => {
    const validation = validateStructuredSuggestion(
      { ...request, draftText: '잘잠' },
      groundedSections,
    )

    expect(validation).toEqual({
      valid: false,
      unsupportedClaims: ['모델 제안이 현재 간호사 입력과 상충함'],
    })
  })

  it('rejects a model narrative that reverses a current negative sleep fact', () => {
    const validation = validateStructuredSuggestion(
      { ...request, draftText: '잠 못잠' },
      {
        ...groundedSections,
        subjective: '잘 잤다고 말함.',
      },
    )

    expect(validation).toEqual({
      valid: false,
      unsupportedClaims: ['모델 제안이 현재 간호사 입력과 상충함'],
    })
  })

  it.each(['숙면 못함', '수면 상태 양호하지 않음'])(
    'accepts a correctly negative model narrative for negated sleep wording %s',
    (draftText) => {
      const validation = validateStructuredSuggestion(
        { ...request, draftText },
        {
          ...groundedSections,
          subjective: '잠을 자지 못했다고 호소함.',
        },
      )

      expect(validation.valid).toBe(true)
    },
  )

  it('rejects an evidence id that was not supplied with the request', () => {
    const validation = validateStructuredSuggestion(request, {
      ...groundedSections,
      evidenceIds: ['sleep-claim', 'missing-evidence'],
    })

    expect(validation).toEqual({
      valid: false,
      unsupportedClaims: ['근거 ID: missing-evidence'],
    })
  })

  it('rejects hallucinated clinical numbers and medication names', () => {
    const validation = validateStructuredSuggestion(request, {
      ...groundedSections,
      plan: 'Ambien 20mg PO 투약함.',
    })

    expect(validation).toEqual({
      valid: false,
      unsupportedClaims: ['수치: 20mg', '용어: Ambien'],
    })
  })

  it('rejects diagnosis, order, or treatment recommendation language', () => {
    const validation = validateStructuredSuggestion(request, {
      ...groundedSections,
      assessment: '불면증으로 진단함.',
      plan: '추가 검사를 권고함.',
    })

    expect(validation).toEqual({
      valid: false,
      unsupportedClaims: ['허용되지 않은 임상 판단 또는 지시 표현'],
    })
  })
})
