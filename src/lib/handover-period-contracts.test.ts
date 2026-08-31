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

function createResponse(): Record<string, any> {
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

function addSecondEvent(response: Record<string, any>): void {
  const firstEvent = response.events[0];
  response.period.eventCount = 2;
  response.events.push({
    ...firstEvent,
    id: "event-2",
    change: {
      ...firstEvent.change,
      id: "vitals-body-temperature-modified",
      category: "vitals",
      label: "체온",
      previousValue: 37.4,
      currentValue: 38,
      delta: 0.6,
      evidence: {
        ...firstEvent.change.evidence,
        fieldPath: "vitals.body_temperature",
      },
    },
    classification: "trend",
  });
  response.reviewGroups.current[0].eventIds = ["event-1"];
  response.reviewGroups.trends = [
    {
      id: "review-2",
      category: "vitals",
      label: "체온",
      classification: "trend",
      eventIds: ["event-2"],
    },
  ];
  response.summary.evidenceIds = ["event-1", "event-2"];
  response.summary.sections.situation[0].evidenceIds = ["event-1", "event-2"];
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

  it("rejects an event whose detected timestamp differs from its current interval timestamp", () => {
    const response = createResponse();
    response.events[0].detectedAt = previousRecordedAt;

    expect(isHandoverPeriodApiResponse(response)).toBe(false);
  });

  it("rejects evidence timestamps that differ from the event interval", () => {
    const previousMismatch = createResponse();
    previousMismatch.events[0].change.evidence.previousRecordedAt = currentRecordedAt;
    const currentMismatch = createResponse();
    currentMismatch.events[0].change.evidence.currentRecordedAt = previousRecordedAt;

    expect(isHandoverPeriodApiResponse(previousMismatch)).toBe(false);
    expect(isHandoverPeriodApiResponse(currentMismatch)).toBe(false);
  });

  it("rejects an event interval that does not move forward in time", () => {
    const response = createResponse();
    response.events[0].interval.previousRecordedAt = currentRecordedAt;

    expect(isHandoverPeriodApiResponse(response)).toBe(false);
  });

  it("accepts summary evidence IDs that cover every event exactly once", () => {
    const complete = createResponse();
    addSecondEvent(complete);
    expect(isHandoverPeriodApiResponse(complete)).toBe(true);
  });

  it("rejects duplicate summary evidence IDs", () => {
    const duplicate = createResponse();
    addSecondEvent(duplicate);
    duplicate.summary.evidenceIds = ["event-1", "event-1"];
    expect(isHandoverPeriodApiResponse(duplicate)).toBe(false);
  });

  it("rejects summary evidence that omits an event", () => {
    const missing = createResponse();
    addSecondEvent(missing);
    missing.summary.evidenceIds = ["event-1"];
    expect(isHandoverPeriodApiResponse(missing)).toBe(false);
  });

  it("accepts review items whose buckets and references match every event", () => {
    const valid = createResponse();
    addSecondEvent(valid);
    expect(isHandoverPeriodApiResponse(valid)).toBe(true);
  });

  it("rejects a review item in the wrong classification bucket", () => {
    const wrongBucket = createResponse();
    wrongBucket.reviewGroups.current[0].classification = "trend";
    expect(isHandoverPeriodApiResponse(wrongBucket)).toBe(false);
  });

  it("rejects a review item with a category that differs from its event", () => {
    const wrongCategory = createResponse();
    wrongCategory.reviewGroups.current[0].category = "vitals";
    expect(isHandoverPeriodApiResponse(wrongCategory)).toBe(false);
  });

  it("rejects a review item with a label that differs from its event", () => {
    const wrongLabel = createResponse();
    wrongLabel.reviewGroups.current[0].label = "체온";
    expect(isHandoverPeriodApiResponse(wrongLabel)).toBe(false);
  });

  it("rejects a review item with a classification that differs from its event", () => {
    const wrongEventClassification = createResponse();
    wrongEventClassification.reviewGroups.current[0].eventIds = ["event-1"];
    wrongEventClassification.events[0].classification = "trend";
    expect(isHandoverPeriodApiResponse(wrongEventClassification)).toBe(false);
  });

  it("rejects a review-group reference that leaves an event ungrouped", () => {
    const missingGroupReference = createResponse();
    addSecondEvent(missingGroupReference);
    missingGroupReference.reviewGroups.trends[0].eventIds = [];
    expect(isHandoverPeriodApiResponse(missingGroupReference)).toBe(false);
  });

  it("rejects a review-group reference that duplicates an event", () => {
    const duplicateGroupReference = createResponse();
    addSecondEvent(duplicateGroupReference);
    duplicateGroupReference.reviewGroups.trends[0].eventIds = ["event-2", "event-1"];
    expect(isHandoverPeriodApiResponse(duplicateGroupReference)).toBe(false);
  });
});
