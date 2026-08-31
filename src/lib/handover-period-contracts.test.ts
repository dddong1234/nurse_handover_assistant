import { describe, expect, it } from "vitest";

import {
  isHandoverPeriodApiResponse,
  parseHandoverPeriodResponse,
} from "./handover-period-contracts";

const previousRecordedAt = "2026-06-29T15:00:00+09:00";
const currentRecordedAt = "2026-06-29T23:00:00+09:00";

function createChange() {
  return {
    id: "diagnosis-hypertension-added",
    category: "diagnosis",
    changeType: "added",
    reviewPriority: "high",
    label: "hypertension",
    previousValue: null,
    currentValue: "hypertension",
    delta: null,
    evidence: {
      fieldPath: 'diagnosis["hypertension"]',
      previousRecordedAt,
      currentRecordedAt,
    },
  };
}

function createResponse(): Record<string, unknown> {
  return {
    patient: {
      id: "P001",
      name: "홍길동",
      room: "301",
      age: 67,
      sex: "M",
      diagnoses: ["acute pharyngitis"],
    },
    period: {
      requestedStartAt: previousRecordedAt,
      baselineRecordedAt: previousRecordedAt,
      currentRecordedAt,
      snapshotCount: 2,
      eventCount: 1,
      status: "ready",
    },
    dataWarnings: [],
    events: [
      {
        id: "event-1",
        detectedAt: currentRecordedAt,
        interval: { previousRecordedAt, currentRecordedAt },
        classification: "current",
        change: createChange(),
      },
    ],
    reviewGroups: {
      current: [
        {
          id: "review-1",
          category: "diagnosis",
          label: "hypertension",
          classification: "current",
          eventIds: ["event-1"],
        },
      ],
      periodOnly: [],
      trends: [],
      recordEvents: [],
    },
    summary: {
      mode: "ai",
      sections: {
        situation: [{ text: "기간 변화 1건", evidenceIds: ["event-1"] }],
        background: [],
        assessment: [],
        recommendation: [{ text: "확인 필요", evidenceIds: [] }],
      },
      evidenceIds: ["event-1"],
      warnings: [],
    },
  };
}

describe("handover period response contract", () => {
  it("parses a complete flat response and preserves the event source shape", () => {
    const response = createResponse();

    expect(isHandoverPeriodApiResponse(response)).toBe(true);
    expect(parseHandoverPeriodResponse(response)).toBe(response);
  });

  it.each([
    ["unknown period status", (response: Record<string, any>) => (response.period.status = "unknown")],
    ["unknown event classification", (response: Record<string, any>) => (response.events[0].classification = "unknown")],
    ["missing event interval", (response: Record<string, any>) => delete response.events[0].interval],
    ["dangling review-group event ID", (response: Record<string, any>) => (response.reviewGroups.current[0].eventIds = ["missing-event"])],
    ["duplicate event ID", (response: Record<string, any>) => response.events.push({ ...response.events[0] })],
    ["blank patient identity", (response: Record<string, any>) => (response.patient.id = "")],
    ["summary evidence ID absent from events", (response: Record<string, any>) => (response.summary.evidenceIds = ["missing-event"])],
  ])("rejects %s", (_caseName, mutate) => {
    const response = createResponse();
    mutate(response);

    expect(isHandoverPeriodApiResponse(response)).toBe(false);
    expect(() => parseHandoverPeriodResponse(response)).toThrow();
  });
});
