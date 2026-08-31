import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HandoverRecord } from "@/lib/handover-api";
import type { HandoverPeriodApiResponse } from "@/lib/handover-period-contracts";

import {
  clearReturnHandoverCache,
  createCurrentRecordFingerprint,
  createReturnHandoverKey,
  useReturnHandover,
} from "./useReturnHandover";

const REVIEW_START_AT = "2026-06-29T15:00:00+09:00";
const CURRENT_RECORDED_AT = "2026-07-02T09:00:00+09:00";

const records: HandoverRecord[] = [
  { patient_id: "P001", updated_at: REVIEW_START_AT },
  { patient_id: "P001", updated_at: CURRENT_RECORDED_AT },
];

function createResponse(label: string, patientId = "P001"): HandoverPeriodApiResponse {
  const eventId = `event-${label}`;
  const changeId = `change-${label}`;
  return {
    patient: {
      id: patientId,
      name: "홍길동",
      room: "301",
      age: 67,
      sex: "M",
      diagnoses: ["acute pharyngitis"],
    },
    period: {
      requestedStartAt: REVIEW_START_AT,
      baselineRecordedAt: REVIEW_START_AT,
      currentRecordedAt: CURRENT_RECORDED_AT,
      snapshotCount: records.length,
      eventCount: 1,
      status: "ready",
    },
    dataWarnings: [],
    events: [
      {
        id: eventId,
        detectedAt: CURRENT_RECORDED_AT,
        interval: {
          previousRecordedAt: REVIEW_START_AT,
          currentRecordedAt: CURRENT_RECORDED_AT,
        },
        classification: "current",
        change: {
          id: changeId,
          category: "diagnosis",
          changeType: "added",
          reviewPriority: "high",
          label,
          previousValue: null,
          currentValue: label,
          delta: null,
          evidence: {
            fieldPath: `diagnosis[\"${label}\"]`,
            previousRecordedAt: REVIEW_START_AT,
            currentRecordedAt: CURRENT_RECORDED_AT,
          },
        },
      },
    ],
    reviewGroups: {
      current: [
        {
          id: `review-${label}`,
          category: "diagnosis",
          label,
          classification: "current",
          eventIds: [eventId],
        },
      ],
      periodOnly: [],
      trends: [],
      recordEvents: [],
    },
    summary: {
      mode: "deterministic",
      sections: {
        situation: [{ text: `기간 변화 ${label}`, evidenceIds: [eventId] }],
        background: [],
        assessment: [],
        recommendation: [{ text: "확인 필요", evidenceIds: [] }],
      },
      evidenceIds: [eventId],
      warnings: [],
    },
  };
}

function responseWith(response: HandoverPeriodApiResponse) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(response),
  };
}

function hookProps(currentRecordFingerprint: string, overrides: Partial<Parameters<typeof useReturnHandover>[0]> = {}) {
  return {
    patientId: "P001",
    reviewStartAt: REVIEW_START_AT,
    records,
    coverageGaps: [],
    currentRecordFingerprint,
    enabled: true,
    ...overrides,
  };
}

describe("useReturnHandover", () => {
  beforeEach(() => {
    clearReturnHandoverCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a deterministic normalized current fingerprint and reuses an equivalent cache key", async () => {
    const first = createCurrentRecordFingerprint({ patient_id: "P001", vitals: { b: 2, a: 1 } });
    const reordered = createCurrentRecordFingerprint({ vitals: { a: 1, b: 2 }, patient_id: "P001" });
    expect(first).toBe(reordered);
    expect(createReturnHandoverKey("P001", REVIEW_START_AT, first)).toBe(
      `P001:${REVIEW_START_AT}:${first}`,
    );
    expect(createReturnHandoverKey("P001", REVIEW_START_AT, JSON.stringify({ b: 2, a: 1 }))).toMatch(
      /^P001:2026-06-29T15:00:00\+09:00:[0-9a-f]+$/,
    );

    const fetchMock = vi.fn().mockResolvedValue(responseWith(createResponse("first")));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ fingerprint }) => useReturnHandover(hookProps(fingerprint)),
      { initialProps: { fingerprint: JSON.stringify({ b: 2, a: 1 }) } },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    rerender({ fingerprint: JSON.stringify({ a: 1, b: 2 }) });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards supplied coverage gaps without changing the patient/start/fingerprint cache key", async () => {
    const p003Records: HandoverRecord[] = [
      { patient_id: "P003", updated_at: REVIEW_START_AT },
      { patient_id: "P003", updated_at: CURRENT_RECORDED_AT },
    ];
    const coverageGaps = [
      {
        from: "2026-06-30T18:00:00+09:00",
        to: "2026-07-01T00:00:00+09:00",
        code: "source_unavailable",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(responseWith(createResponse("gap", "P003")));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useReturnHandover(hookProps("p003", {
      patientId: "P003",
      records: p003Records,
      coverageGaps,
    })));

    await waitFor(() => expect(result.current.status).toBe("success"));
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(options.body)).coverageGaps).toEqual(coverageGaps);
  });

  it("requests a new comparison when patient, start time, or current fingerprint changes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseWith(createResponse("patient")))
      .mockResolvedValueOnce(responseWith(createResponse("start")))
      .mockResolvedValueOnce(responseWith(createResponse("draft")));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ patientId, reviewStartAt, fingerprint }) => useReturnHandover(
        hookProps(fingerprint, { patientId, reviewStartAt }),
      ),
      {
        initialProps: {
          patientId: "P001",
          reviewStartAt: REVIEW_START_AT,
          fingerprint: "draft-1",
        },
      },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    rerender({ patientId: "P002", reviewStartAt: REVIEW_START_AT, fingerprint: "draft-1" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    rerender({ patientId: "P002", reviewStartAt: "2026-06-30T07:00:00+09:00", fingerprint: "draft-1" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    rerender({ patientId: "P002", reviewStartAt: "2026-06-30T07:00:00+09:00", fingerprint: "draft-2" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    const requestBodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(String((options as RequestInit).body)));
    expect(requestBodies[0].reviewStartAt).toBe(REVIEW_START_AT);
    expect(requestBodies[1].records[0].patient_id).toBe("P001");
    expect(requestBodies[2].reviewStartAt).toBe("2026-06-30T07:00:00+09:00");
    expect(result.current.response).not.toBeNull();
  });

  it("aborts the superseded request and accepts only the latest response", async () => {
    let resolveFirst!: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
    let resolveSecond!: (response: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
    const first = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => {
      resolveSecond = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ fingerprint }) => useReturnHandover(hookProps(fingerprint)),
      { initialProps: { fingerprint: "old" } },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstSignal = (fetchMock.mock.calls[0]![1] as RequestInit).signal as AbortSignal;

    rerender({ fingerprint: "new" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);

    resolveFirst(responseWith(createResponse("stale")));
    resolveSecond(responseWith(createResponse("latest")));
    await waitFor(() => expect(result.current.response?.events[0]?.change.label).toBe("latest"));
    expect(result.current.status).toBe("success");
  });

  it("reuses a successful same-key response after remount without another request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseWith(createResponse("cached")));
    vi.stubGlobal("fetch", fetchMock);

    const firstHook = renderHook(() => useReturnHandover(hookProps("same")));
    await waitFor(() => expect(firstHook.result.current.status).toBe("success"));
    firstHook.unmount();

    const secondHook = renderHook(() => useReturnHandover(hookProps("same")));
    await waitFor(() => expect(secondHook.result.current.status).toBe("success"));
    expect(secondHook.result.current.response?.events[0]?.change.label).toBe("cached");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the last successful response when a newer request fails and supports retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseWith(createResponse("stable")))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(responseWith(createResponse("retried")));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(
      ({ fingerprint }) => useReturnHandover(hookProps(fingerprint)),
      { initialProps: { fingerprint: "stable" } },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    rerender({ fingerprint: "failed" });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.response?.events[0]?.change.label).toBe("stable");
    expect(result.current.error?.code).toBe("NETWORK_ERROR");

    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.response?.events[0]?.change.label).toBe("retried");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
