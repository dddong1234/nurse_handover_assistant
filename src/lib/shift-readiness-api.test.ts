import { afterEach, describe, expect, it, vi } from "vitest";

import { createValidShiftReadinessResponse } from "@/test/shift-readiness-fixtures";

import { getDemoTimeline } from "./demo-timelines";
import {
  HandoverApiError,
  requestShiftReadinessComparison,
  type ShiftReadinessRequest,
} from "./shift-readiness-api";
import { buildShiftReadinessRecords } from "./demo-shift-readiness";

const request: ShiftReadinessRequest = {
  reviewStartAt: "2026-06-28T09:00:00+09:00",
  shift: {
    startsAt: "2026-07-02T07:00:00+09:00",
    endsAt: "2026-07-02T15:00:00+09:00",
  },
  records: buildShiftReadinessRecords("P001", getDemoTimeline("P001").snapshots),
  coverageGaps: [],
};

function validFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(createValidShiftReadinessResponse()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("requestShiftReadinessComparison", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts only the approved request fields and validates the patient", async () => {
    const fetchImpl = validFetch();
    await requestShiftReadinessComparison(request, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/handover/shift-readiness",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const [, options] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toEqual({
      reviewStartAt: request.reviewStartAt,
      shift: request.shift,
      records: request.records,
      coverageGaps: request.coverageGaps,
    });
    expect(JSON.parse(String(options.body))).not.toHaveProperty("summaryMode");
  });

  it("honors an injected signal and aborts before making a request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      requestShiftReadinessComparison(request, { signal: controller.signal, fetchImpl }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps an abort during fetch to a typed aborted error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));

    await expect(requestShiftReadinessComparison(request, { fetchImpl })).rejects.toMatchObject({
      code: "ABORTED",
    });
  });

  it("maps an abort while reading JSON to a typed aborted error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    } as unknown as Response);

    await expect(requestShiftReadinessComparison(request, { fetchImpl })).rejects.toMatchObject({
      code: "ABORTED",
    });
  });

  it("maps network and HTTP failures without exposing response content", async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("network secret"));
    await expect(requestShiftReadinessComparison(request, { fetchImpl: networkFetch })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    const httpFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ secret: "not for the error" }), { status: 503 }),
    );
    await expect(requestShiftReadinessComparison(request, { fetchImpl: httpFetch })).rejects.toMatchObject({
      code: "HTTP_ERROR",
    });
  });

  it("maps malformed JSON and invalid response contracts separately", async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{not json", { status: 200 }),
    );
    await expect(requestShiftReadinessComparison(request, { fetchImpl: malformed })).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });

    const invalid = createValidShiftReadinessResponse();
    invalid.groups.investigations = ["missing-item"];
    const invalidFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(invalid), { status: 200 }),
    );
    await expect(requestShiftReadinessComparison(request, { fetchImpl: invalidFetch })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("rejects a valid response for a different patient", async () => {
    const mismatched = createValidShiftReadinessResponse();
    mismatched.patient.id = "P002";
    mismatched.items.forEach((item) => {
      item.patientId = "P002";
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(mismatched), { status: 200 }),
    );

    await expect(requestShiftReadinessComparison(request, { fetchImpl })).rejects.toMatchObject({
      code: "PATIENT_MISMATCH",
    });
  });

  it("rejects unserializable or mixed-patient requests before fetch", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const unserializable = {
      ...request,
      records: [circular],
    } as unknown as ShiftReadinessRequest;
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(requestShiftReadinessComparison(unserializable, { fetchImpl })).rejects.toMatchObject({
      code: "REQUEST_SERIALIZATION",
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    const mixed = {
      ...request,
      records: [request.records[0], { ...request.records[1], patient_id: "P002" }],
    } as ShiftReadinessRequest;
    await expect(requestShiftReadinessComparison(mixed, { fetchImpl })).rejects.toMatchObject({
      code: "REQUEST_SERIALIZATION",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes the caller signal through and uses the injected fetch only", async () => {
    const fetchImpl = validFetch();
    const controller = new AbortController();
    const globalFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", globalFetch);

    await requestShiftReadinessComparison(request, {
      signal: controller.signal,
      fetchImpl,
    });

    const [, options] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(options.signal).toBe(controller.signal);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("exposes the existing typed API error class for callers", () => {
    const error = new HandoverApiError("INVALID_RESPONSE");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("INVALID_RESPONSE");
  });
});
