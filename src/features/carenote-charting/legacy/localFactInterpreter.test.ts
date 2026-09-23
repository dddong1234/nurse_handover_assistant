// Regression tests ported from charting_assistant 1cec3bb; not new user validation.
import { describe, expect, it } from 'vitest'
import {
  analyzeLocalNurseFacts,
  CURRENT_DRAFT_EVIDENCE_ID,
  interpretLocalNurseFacts,
} from './localFactInterpreter'

const evidence = [
  {
    id: 'sleep-claim',
    timestamp: '21:30',
    category: 'PRN' as const,
    label: '환자 진술',
    detail: '“잠이 안 온다”고 호소함.',
    subjective: '“잠이 안 온다”고 호소함.',
  },
  {
    id: 'vitals',
    timestamp: '21:35',
    category: 'PRN' as const,
    label: '최근 V/S',
    detail: 'BP 110/70 mmHg, HR 80회/분 확인됨.',
    subjective: '특이 호소 없음.',
  },
]

describe('local nurse fact interpreter', () => {
  it('flags a current positive sleep fact that conflicts with prior negative evidence', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '잘잠',
      evidence,
    })

    expect(result?.conflict).toEqual({
      evidenceIds: ['sleep-claim'],
      message: '현재 입력 “잘잠”이 이전 기록 “잠이 안 온다”와 다릅니다. 현재 상태와 기록 시점을 확인하세요.',
    })
    expect(result?.evidenceIds).toEqual([CURRENT_DRAFT_EVIDENCE_ID])
  })

  it('interprets a short negative sleep phrase without an API', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '잠 못잠',
      evidence,
    })

    expect(result?.sections).toEqual({
      subjective: '잠을 자지 못했다고 호소함.',
      objective: '수면 상태에 대한 현재 입력을 확인함.',
      assessment: '수면 불편 호소 상태를 간호사가 확인함.',
      plan: '수면 및 안위 상태 변화를 이어서 관찰함.',
    })
  })

  it('requests a post-medication response when sleep medication was given without follow-up evidence', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '잠 못잠',
      evidence: [
        ...evidence,
        {
          id: 'sleep-medication',
          category: 'PRN',
          label: 'PRN 투약',
          detail: 'Stilnox 10mg PO 투약함.',
          subjective: '잠이 안 온다고 호소함.',
        },
      ],
    })

    expect(result?.reviewPrompts).toEqual([
      {
        id: 'post-medication-response',
        evidenceIds: ['sleep-medication'],
        message: 'PRN 투약 후 수면 상태·반응을 현재 근거에서 찾지 못했습니다. 기록 전 확인하세요.',
      },
    ])
  })

  it('does not request a post-medication response when follow-up sleep evidence exists', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '잠 못잠',
      evidence: [{
        id: 'sleep-response',
        category: 'PRN',
        label: '투약 후 반응',
        detail: 'Stilnox 10mg PO 투약함. 투약 후 잘 잠.',
        subjective: '수면 중임.',
      }],
    })

    expect(result?.reviewPrompts).toBeUndefined()
  })

  it('does not request a sleep response for an unrelated PRN medication', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '잠 못잠',
      evidence: [{
        id: 'pain-medication',
        category: 'PRN',
        label: 'PRN 진통제 투약',
        detail: 'Acetaminophen 1g IV 투약함.',
        subjective: '수술 부위 통증 NRS 5점 호소함.',
      }],
    })

    expect(result?.reviewPrompts).toBeUndefined()
  })

  it('does not treat an unrelated analgesic response as the missing sleep follow-up', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '잠 못잠',
      evidence: [
        {
          id: 'sleep-medication',
          category: 'PRN',
          label: 'PRN 수면제 투약',
          detail: 'Stilnox 10mg PO 투약함.',
          subjective: '잠이 안 온다고 호소함.',
        },
        {
          id: 'pain-response',
          category: 'PRN',
          label: 'PRN 진통제 반응',
          detail: 'Acetaminophen 1g IV 투약함. 투약 후 통증 완화 반응 확인함.',
          subjective: '수술 부위 통증 감소함.',
        },
      ],
    })

    expect(result?.reviewPrompts?.[0]?.evidenceIds).toEqual(['sleep-medication'])
  })

  it('ignores sleep-medication administration outside PRN evidence', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '잠 못잠',
      evidence: [{
        id: 'non-prn-sleep-medication',
        category: '일반',
        label: '자가 투약 진술',
        detail: 'Stilnox 10mg PO 투약함.',
        subjective: '입원 전 복용했다고 말함.',
      }],
    })

    expect(result?.reviewPrompts).toBeUndefined()
  })

  it('does not combine a sleep-medication order mention with another medication administration', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '잠 못잠',
      evidence: [{
        id: 'mixed-medication-evidence',
        category: 'PRN',
        label: '처방 및 투약 확인',
        detail: 'Stilnox 처방 확인 후 Acetaminophen 1g IV 투약함.',
        subjective: '잠이 안 온다고 호소함.',
      }],
    })

    expect(result?.reviewPrompts).toBeUndefined()
  })

  it('flags a current negative sleep fact that conflicts with prior positive evidence', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '잠 못잠',
      evidence: [
        {
          id: 'prior-positive-sleep',
          category: 'PRN',
          label: '이전 수면 기록',
          detail: '숙면했다고 말함.',
          subjective: '잘 잤다고 말함.',
        },
      ],
    })

    expect(result?.conflict?.evidenceIds).toEqual(['prior-positive-sleep'])
    expect(result?.evidenceIds).toEqual([CURRENT_DRAFT_EVIDENCE_ID])
  })

  it('treats negated deep sleep as negative instead of positive sleep', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '숙면 못함',
      evidence,
    })

    expect(result?.sections.subjective).toBe('잠을 자지 못했다고 호소함.')
    expect(result?.sections.subjective).not.toBe('잘 잤다고 말함.')
  })

  it('treats negated good sleep wording as negative sleep', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '수면 상태 양호하지 않음',
      evidence,
    })

    expect(result?.sections.subjective).toBe('잠을 자지 못했다고 호소함.')
    expect(result?.sections.subjective).not.toBe('잘 잤다고 말함.')
  })

  it('preserves negation when the nurse enters that nausea is absent', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '오심 없음',
      evidence,
    })

    expect(result?.sections).toEqual({
      subjective: '오심 없다고 말함.',
      objective: '오심 여부에 대한 현재 입력을 확인함.',
      assessment: '오심 호소 없는 상태를 간호사가 확인함.',
      plan: '오심 발생 여부를 이어서 관찰함.',
    })
  })

  it('extracts a valid pain score from shorthand', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '통증 3점',
      evidence,
    })

    expect(result?.sections).toEqual({
      subjective: '통증 NRS 3점이라고 말함.',
      objective: '통증 점수 NRS 3점 확인함.',
      assessment: '현재 통증 정도를 간호사가 확인함.',
      plan: '통증 점수와 상태 변화를 이어서 관찰함.',
    })
    expect(result?.evidenceIds).toEqual([CURRENT_DRAFT_EVIDENCE_ID])
  })

  it('separates a different historical pain score as a conflict instead of support', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '통증 3점',
      evidence: [
        {
          id: 'prior-pain-seven',
          category: 'PRN',
          label: '이전 통증 기록',
          detail: '통증 NRS 7점 확인함.',
          subjective: '통증 7점이라고 말함.',
        },
      ],
    })

    expect(result?.evidenceIds).toEqual([CURRENT_DRAFT_EVIDENCE_ID])
    expect(result?.conflict?.evidenceIds).toEqual(['prior-pain-seven'])
  })

  it.each(['NRS 100점', 'NRS 10.5점', 'NRS -1점'])(
    'rejects malformed or out-of-range pain score %s',
    (draftText) => {
      const input = { category: 'PRN' as const, draftText, evidence }

      expect(analyzeLocalNurseFacts(input)).toEqual({
        status: 'invalid',
        reason: 'out-of-range-pain',
      })
      expect(interpretLocalNurseFacts(input)).toBeNull()
    },
  )

  it('normalizes a drain amount from cc to mL', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '배액 30cc',
      evidence,
    })

    expect(result?.sections).toEqual({
      subjective: '특이 호소 없음.',
      objective: '배액량 30mL 확인함.',
      assessment: '현재 배액 상태를 간호사가 확인함.',
      plan: '배액량과 양상 변화를 이어서 관찰함.',
    })
  })

  it('interprets ward ambulation shorthand as performed care', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '복도 한바퀴 걸음',
      evidence,
    })

    expect(result?.sections).toEqual({
      subjective: '보행 중 특이 호소 없음.',
      objective: '복도 보행 1회 시행함.',
      assessment: '보행 후 상태를 간호사가 확인함.',
      plan: '보행 후 불편감과 상태 변화를 이어서 관찰함.',
    })
  })

  it('does not convert negated ambulation into completed care', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '보행 못함',
      evidence,
    })

    expect(result?.sections.objective).toBe('보행 시행하지 못함.')
    expect(result?.sections.objective).not.toBe('복도 보행 1회 시행함.')
  })

  it('preserves negation when the nurse writes corridor ambulation was not possible', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '복도 보행 못함',
      evidence,
    })

    expect(result?.sections.objective).toBe('보행 시행하지 못함.')
  })

  it('preserves negation for a short dyspnea statement', () => {
    const result = interpretLocalNurseFacts({
      category: 'PRN',
      draftText: '숨찬건 없음',
      evidence,
    })

    expect(result?.sections).toEqual({
      subjective: '숨찬 증상 없다고 말함.',
      objective: '호흡 불편 여부에 대한 현재 입력을 확인함.',
      assessment: '호흡 불편 호소 없는 상태를 간호사가 확인함.',
      plan: '호흡 양상과 불편 여부를 이어서 관찰함.',
    })
  })
})
