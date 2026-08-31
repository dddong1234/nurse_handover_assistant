import { afterEach, describe, expect, it, vi } from "vitest";

import type { HandoverPeriodApiResponse } from "./handover-period-contracts";
import {
  requestHandoverPeriodComparison,
  type HandoverPeriodRequest,
} from "./handover-period-api";

const previousRecordedAt = "2026-06-29T15:00:00+09:00";
const currentRecordedAt = "2026-06-29T23:00:00+09:00";

function createResponse(): HandoverPeriodApiResponse {
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
        change: {
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
        },
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
      mode: "deterministic",
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

const request: HandoverPeriodRequest = {
  reviewStartAt: previousRecordedAt,
  records: [
    { patient_id: "P001", updated_at: previousRecordedAt },
    { patient_id: "P001", updated_at: currentRecordedAt },
  ],
  coverageGaps: [],
  summaryMode: "deterministic",
};

function responseWith(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("requestHandoverPeriodComparison", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts only the flat period request contract and validates the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseWith(createResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const result = await requestHandoverPeriodComparison(request, {
      signal: controller.signal,
    });

    expect(result).toEqual(createResponse());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/handover/period-compare");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(options.signal).toBe(controller.signal);
    expect(JSON.parse(String(options.body))).toEqual(request);
  });

  it("maps 422 responses to the existing typed HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWith({ detail: "invalid" }, false, 422)));

    await expect(requestHandoverPeriodComparison(request)).rejects.toMatchObject({ code: "HTTP_ERROR" });
  });

  it("maps network failures and aborts without swallowing cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(requestHandoverPeriodComparison(request)).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestHandoverPeriodComparison(request, { signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
    await expect(requestHandoverPeriodComparison(request, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: "ABORTED",
    });
  });

  it("maps malformed and invalid response bodies to typed response errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError("bad json")),
      }),
    );
    await expect(requestHandoverPeriodComparison(request)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWith({ patient: {} })));
    await expect(requestHandoverPeriodComparison(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("never sends an API key in browser headers or request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseWith(createResponse()));
    vi.stubGlobal("fetch", fetchMock);

    await requestHandoverPeriodComparison(request);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(JSON.stringify(JSON.parse(String(options.body)))).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(JSON.parse(String(options.body)))).not.toContain("api_key");
  });
});
