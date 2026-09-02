import type { ShiftReadinessResponse } from "../lib/shift-readiness-contracts";

/**
 * A literal, reference-complete response used only by browser boundary tests.
 * Production modules must not import this fixture.
 */
export function createValidShiftReadinessResponse(): ShiftReadinessResponse {
  return {
    patient: {
      id: "P001",
      name: "홍길동",
      room: "301",
      age: 67,
      sex: "M",
      diagnoses: ["acute pharyngitis", "hypertension"],
    },
    reviewPeriod: {
      requestedStartAt: "2026-06-28T09:00:00+09:00",
      baselineRecordedAt: "2026-06-29T15:00:00+09:00",
      currentRecordedAt: "2026-07-02T09:00:00+09:00",
    },
    shift: {
      startsAt: "2026-07-02T07:00:00+09:00",
      endsAt: "2026-07-02T15:00:00+09:00",
    },
    status: "available",
    dataWarnings: [],
    items: [
      {
        id: "P001-patient-status-recent-change",
        patientId: "P001",
        domain: "patient_status",
        factStatus: "recent_change",
        title: "현재 기록 변화",
        detail: "활력징후와 진단에 기간 중 변화가 있습니다.",
        relevantAt: "2026-07-02T09:00:00+09:00",
        sourceRefs: [
          {
            recordedAt: "2026-07-02T09:00:00+09:00",
            path: "vitals.body_temperature",
            label: "현재 활력징후",
            periodEventId: "period-event-P001-vitals",
          },
        ],
        ruleCode: "STATUS_PERIOD_CHANGE",
      },
      {
        id: "P001-investigation-CBC-new-result",
        patientId: "P001",
        domain: "investigation",
        factStatus: "new_result",
        title: "CBC 결과 확인",
        detail: "CBC 결과가 기록되었습니다.",
        relevantAt: "2026-07-02T08:20:00+09:00",
        sourceRefs: [
          {
            recordedAt: "2026-07-02T09:00:00+09:00",
            path: "investigations[id=INV-P001-CBC]",
            label: "CBC 원본",
          },
        ],
        ruleCode: "INVESTIGATION_NEW_RESULT",
      },
      {
        id: "P001-investigation-CXR-scheduled",
        patientId: "P001",
        domain: "investigation",
        factStatus: "scheduled_this_shift",
        title: "Chest AP 일정 확인",
        detail: "이번 근무 중 Chest AP가 예정되어 있습니다.",
        relevantAt: "2026-07-02T11:00:00+09:00",
        sourceRefs: [
          {
            recordedAt: "2026-07-02T09:00:00+09:00",
            path: "investigations[id=INV-P001-CXR]",
            label: "Chest AP 원본",
          },
        ],
        ruleCode: "INVESTIGATION_SCHEDULED_SHIFT",
      },
      {
        id: "P001-investigation-CXR-pending",
        patientId: "P001",
        domain: "investigation",
        factStatus: "pending_result",
        title: "검사 결과 대기",
        detail: "현재 결과가 기록되지 않은 검사가 있습니다.",
        relevantAt: null,
        sourceRefs: [
          {
            recordedAt: "2026-07-02T09:00:00+09:00",
            path: "investigations[id=INV-P001-PENDING]",
            label: "결과 대기 검사",
          },
        ],
        ruleCode: "INVESTIGATION_PENDING",
      },
      {
        id: "P001-device-PIV-due",
        patientId: "P001",
        domain: "line_device",
        factStatus: "scheduled_this_shift",
        title: "말초정맥관 일정 확인",
        detail: "말초정맥관 교체 예정 시각이 이번 근무에 있습니다.",
        relevantAt: "2026-07-02T14:00:00+09:00",
        sourceRefs: [
          {
            recordedAt: "2026-07-02T09:00:00+09:00",
            path: "devices[id=DEV-P001-PIV-1]",
            label: "말초정맥관 원본",
          },
        ],
        ruleCode: "DEVICE_DUE_SHIFT",
      },
      {
        id: "P001-medication-acetaminophen-effective",
        patientId: "P001",
        domain: "medication",
        factStatus: "scheduled_this_shift",
        title: "타세놀정 500mg 적용 시점",
        detail: "투약 적용 시점이 이번 근무에 있습니다.",
        relevantAt: "2026-07-02T09:00:00+09:00",
        sourceRefs: [
          {
            recordedAt: "2026-07-02T09:00:00+09:00",
            path: "medications[name=%ED%83%80%EC%84%B8%EB%86%80%EC%A0%95%20500mg]",
            label: "투약 원본",
          },
        ],
        ruleCode: "MEDICATION_EFFECTIVE_SHIFT",
      },
      {
        id: "P001-communication-round-follow-up",
        patientId: "P001",
        domain: "communication",
        factStatus: "explicit_follow_up",
        title: "회진 전 발열 경과 전달",
        detail: "명시된 전달 요청을 확인합니다.",
        relevantAt: "2026-07-02T07:40:00+09:00",
        sourceRefs: [
          {
            recordedAt: "2026-07-02T09:00:00+09:00",
            path: "handoffRequests[id=REQ-P001-ROUND-1]",
            label: "전달 요청 원본",
          },
        ],
        ruleCode: "COMMUNICATION_EXPLICIT_OPEN",
      },
    ],
    groups: {
      patientStatus: ["P001-patient-status-recent-change"],
      investigations: [
        "P001-investigation-CBC-new-result",
        "P001-investigation-CXR-scheduled",
        "P001-investigation-CXR-pending",
      ],
      lineDevices: ["P001-device-PIV-due"],
      medications: ["P001-medication-acetaminophen-effective"],
      communications: ["P001-communication-round-follow-up"],
    },
    metrics: {
      itemCount: 7,
      newResultCount: 1,
      scheduledThisShiftCount: 3,
      pendingResultCount: 1,
      domainCounts: {
        patient_status: 1,
        investigation: 3,
        line_device: 1,
        medication: 1,
        communication: 1,
      },
    },
  };
}
