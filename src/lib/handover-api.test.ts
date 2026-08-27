import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoWorkspaceData } from "@/lib/demo-adapter";

import { demoRecordPairs } from "./demo-records";
import { comparePatientRecords } from "./handover-api";

const currentRecord = {
  patient_id: "P001",
  updated_at: "2026-07-02T07:00:00+09:00",
  diagnosis: ["acute pharyngitis"],
  vitals: { body_temperature: 37.9 },
  medications: [],
  notes: [],
};

const previousRecord = {
  patient_id: "P001",
  updated_at: "2026-07-01T21:00:00+09:00",
  diagnosis: ["acute pharyngitis"],
  vitals: { body_temperature: 37.4 },
  medications: [],
  notes: [],
};

function responseWith(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("comparePatientRecords", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts the record pair to the same-origin endpoint and returns a validated response", async () => {
    const [demoResponse] = buildDemoWorkspaceData();
    if (!demoResponse) throw new Error("데모 응답이 없습니다.");

    const fetchMock = vi.fn().mockResolvedValue(responseWith(demoResponse));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const result = await comparePatientRecords(previousRecord, currentRecord, controller.signal);

    expect(result).toEqual(demoResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/handover/compare");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(options.signal).toBe(controller.signal);
    expect(JSON.parse(String(options.body))).toEqual({
      previous: previousRecord,
      current: currentRecord,
    });
  });

  it("rejects a non-success HTTP response without exposing response content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWith({ secret: "not for the error" }, false)));

    await expect(comparePatientRecords(previousRecord, currentRecord)).rejects.toThrow(
      "인수인계 비교 요청을 완료하지 못했습니다.",
    );
  });

  it("rejects malformed and structurally invalid JSON responses", async () => {
    const malformed = { ok: true, status: 200, json: vi.fn().mockRejectedValue(new SyntaxError("bad json")) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(malformed));
    await expect(comparePatientRecords(previousRecord, currentRecord)).rejects.toThrow(
      "인수인계 비교 응답을 읽을 수 없습니다.",
    );

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWith({ comparison: {}, summary: {} })));
    await expect(comparePatientRecords(previousRecord, currentRecord)).rejects.toThrow(
      "인수인계 비교 응답을 검증하지 못했습니다.",
    );
  });

  it("rejects a response with an unknown summary evidence ID", async () => {
    const [demoResponse] = buildDemoWorkspaceData();
    if (!demoResponse) throw new Error("데모 응답이 없습니다.");
    const invalid = structuredClone(demoResponse);
    invalid.summary.sections.situation[0]!.evidenceIds = ["unknown-evidence-id"];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWith(invalid)));

    await expect(comparePatientRecords(previousRecord, currentRecord)).rejects.toThrow(
      "인수인계 비교 응답을 검증하지 못했습니다.",
    );
  });

  it("rejects a validated response for a different patient", async () => {
    const [demoResponse] = buildDemoWorkspaceData();
    if (!demoResponse) throw new Error("데모 응답이 없습니다.");
    const mismatched = structuredClone(demoResponse);
    mismatched.comparison.patient.id = "P999";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWith(mismatched)));

    await expect(comparePatientRecords(previousRecord, currentRecord)).rejects.toThrow(
      "인수인계 비교 응답의 환자 식별자가 일치하지 않습니다.",
    );
  });

  it("keeps every browser demo pair aligned with the checked-in API interval", () => {
    const expectedIntervals = {
      P001: ["2026-07-02T07:00:00+09:00", "2026-07-02T09:00:00+09:00"],
      P002: ["2026-07-02T06:00:00+09:00", "2026-07-02T09:10:00+09:00"],
      P003: ["2026-07-02T06:00:00+09:00", "2026-07-02T09:20:00+09:00"],
      P004: ["2026-07-02T06:00:00+09:00", "2026-07-02T08:40:00+09:00"],
      P005: ["2026-07-02T07:00:00+09:00", "2026-07-02T09:30:00+09:00"],
    } as const;
    const apiResponses = buildDemoWorkspaceData();

    for (const [patientId, [previousRecordedAt, currentRecordedAt]] of Object.entries(expectedIntervals)) {
      const pair = demoRecordPairs[patientId];
      expect(pair).toBeDefined();
      expect(pair?.previous?.updated_at).toBe(previousRecordedAt);
      expect(pair?.current.updated_at).toBe(currentRecordedAt);

      const response = apiResponses.find(({ comparison }) => comparison.patient.id === patientId);
      expect(response?.comparison.interval).toEqual({ previousRecordedAt, currentRecordedAt });
    }
  });
});
