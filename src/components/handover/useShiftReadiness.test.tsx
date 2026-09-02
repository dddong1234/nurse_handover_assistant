import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCurrentRecordFingerprint } from "./useReturnHandover";
import type { ShiftReadinessRequest, ShiftReadinessResponse } from "@/lib/shift-readiness-contracts";
import { buildShiftReadinessRecords } from "@/lib/demo-shift-readiness";
import { getDemoTimeline } from "@/lib/demo-timelines";
import { createValidShiftReadinessResponse } from "@/test/shift-readiness-fixtures";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/shift-readiness-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shift-readiness-api")>();
  return { ...actual, requestShiftReadinessComparison: requestMock };
});

type HookInput = ShiftReadinessRequest & {
  patientId: string;
  currentRecordFingerprint: string;
  enabled: boolean;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const REVIEW_START_AT = "2026-06-28T09:00:00+09:00";
const SHIFT = {
  startsAt: "2026-07-02T07:00:00+09:00",
  endsAt: "2026-07-02T15:00:00+09:00",
} as const;

function inputFor(patientId: string, fingerprint = createCurrentRecordFingerprint({ patientId, version: 1 })): HookInput {
  const sourcePatientId = ["P001", "P002", "P003", "P004", "P005"].includes(patientId)
    ? patientId
    : "P001";
  return {
    patientId,
    reviewStartAt: REVIEW_START_AT,
    shift: { ...SHIFT },
    records: buildShiftReadinessRecords(sourcePatientId, getDemoTimeline(sourcePatientId).snapshots).map(
      (record) => ({ ...record, patient_id: patientId }),
    ),
    coverageGaps: [],
    currentRecordFingerprint: fingerprint,
    enabled: true,
  };
}

const p001Input = inputFor("P001");
const p002Input = inputFor("P002");

function responseFor(patientId: string): ShiftReadinessResponse {
  const response = structuredClone(createValidShiftReadinessResponse());
  if (patientId === "P001") return response;
  response.patient.id = patientId;
  response.items = response.items.map((item) => ({
    ...item,
    id: item.id.replaceAll("P001", patientId),
    patientId,
    sourceRefs: item.sourceRefs.map((source) => ({
      ...source,
      path: source.path.replaceAll("P001", patientId),
      periodEventId: source.periodEventId?.replaceAll("P001", patientId),
    })),
  }));
  response.groups = {
    patientStatus: response.groups.patientStatus.map((id) => id.replaceAll("P001", patientId)),
    investigations: response.groups.investigations.map((id) => id.replaceAll("P001", patientId)),
    lineDevices: response.groups.lineDevices.map((id) => id.replaceAll("P001", patientId)),
    medications: response.groups.medications.map((id) => id.replaceAll("P001", patientId)),
    communications: response.groups.communications.map((id) => id.replaceAll("P001", patientId)),
  };
  return response;
}

async function loadHookModule() {
  const modulePath = "./useShiftReadiness";
  return import(/* @vite-ignore */ modulePath);
}

describe("Shift Readiness request state", () => {
  beforeEach(() => {
    vi.resetModules();
    requestMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("hashes all five key dimensions without exposing raw input", async () => {
    const { createShiftReadinessKey } = await loadHookModule();
    const fingerprint = createCurrentRecordFingerprint({ patientId: "P001", version: 1 });
    const key = createShiftReadinessKey("P001", REVIEW_START_AT, SHIFT, fingerprint);

    expect(key).toMatch(/^sr:[0-9a-f]{8}$/);
    for (const raw of ["P001", REVIEW_START_AT, SHIFT.startsAt, SHIFT.endsAt, fingerprint]) {
      expect(key).not.toContain(raw);
    }
    expect(key).toBe(createShiftReadinessKey("P001", REVIEW_START_AT, { ...SHIFT }, fingerprint));
    expect(key).not.toBe(createShiftReadinessKey("P002", REVIEW_START_AT, SHIFT, fingerprint));
    expect(key).not.toBe(createShiftReadinessKey("P001", "2026-06-29T09:00:00+09:00", SHIFT, fingerprint));
    expect(key).not.toBe(
      createShiftReadinessKey("P001", REVIEW_START_AT, { ...SHIFT, startsAt: "2026-07-02T08:00:00+09:00" }, fingerprint),
    );
    expect(key).not.toBe(
      createShiftReadinessKey("P001", REVIEW_START_AT, { ...SHIFT, endsAt: "2026-07-02T16:00:00+09:00" }, fingerprint),
    );
    expect(key).not.toBe(
      createShiftReadinessKey(
        "P001",
        REVIEW_START_AT,
        SHIFT,
        createCurrentRecordFingerprint({ patientId: "P001", version: 2 }),
      ),
    );
  });

  it("shares an in-flight request and exposes only the latest patient's response", async () => {
    const first = deferred<ShiftReadinessResponse>();
    const second = deferred<ShiftReadinessResponse>();
    requestMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { useShiftReadiness } = await loadHookModule();

    const { result, rerender } = renderHook((props: HookInput) => useShiftReadiness(props), {
      initialProps: p001Input,
    });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const duplicate = renderHook(() => useShiftReadiness(p001Input));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender(p002Input);
    await waitFor(() => expect(result.current.response).toBeNull());
    second.resolve(responseFor("P002"));
    await waitFor(() => expect(result.current.response?.patient.id).toBe("P002"));
    first.resolve(responseFor("P001"));
    await waitFor(() => expect(duplicate.result.current.response?.patient.id).toBe("P001"));
    expect(result.current.response?.patient.id).toBe("P002");
    expect(result.current.status).toBe("success");
    duplicate.unmount();
  });

  it("reuses successful responses and evicts the oldest entry at the 24-response bound", async () => {
    const { useShiftReadiness } = await loadHookModule();
    requestMock.mockImplementation(async (input: HookInput) => responseFor(input.patientId));
    const hooks: Array<ReturnType<typeof renderHook>> = [];

    for (let index = 0; index < 25; index += 1) {
      const patientId = `P${String(index + 1).padStart(3, "0")}`;
      const hook = renderHook(() => useShiftReadiness(inputFor(patientId)), { reactStrictMode: false });
      hooks.push(hook);
      await waitFor(() => expect(hook.result.current.status).toBe("success"));
      hook.unmount();
    }

    expect(requestMock).toHaveBeenCalledTimes(25);
    const cached = renderHook(() => useShiftReadiness(inputFor("P025")));
    await waitFor(() => expect(cached.result.current.status).toBe("success"));
    expect(requestMock).toHaveBeenCalledTimes(25);
    const evicted = renderHook(() => useShiftReadiness(inputFor("P001")));
    await waitFor(() => expect(evicted.result.current.status).toBe("success"));
    expect(requestMock).toHaveBeenCalledTimes(26);
    cached.unmount();
    evicted.unmount();
  });

  it("preserves an exact-key response on refresh failure and retries deterministically", async () => {
    const { HandoverApiError } = await import("@/lib/shift-readiness-api");
    const { useShiftReadiness } = await loadHookModule();
    requestMock
      .mockResolvedValueOnce(responseFor("P001"))
      .mockRejectedValueOnce(new HandoverApiError("NETWORK_ERROR"))
      .mockResolvedValueOnce(responseFor("P001"));
    const { result } = renderHook(() => useShiftReadiness(p001Input));

    await waitFor(() => expect(result.current.status).toBe("success"));
    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.response?.patient.id).toBe("P001");
    expect(result.current.error?.code).toBe("NETWORK_ERROR");
    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it("aborts a disabled request without deleting its successful cache", async () => {
    const pending = deferred<ShiftReadinessResponse>();
    const { useShiftReadiness } = await loadHookModule();
    requestMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(responseFor("P001"));
    const { result, rerender } = renderHook((props: HookInput) => useShiftReadiness(props), {
      initialProps: p001Input,
    });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const signal = (requestMock.mock.calls[0]![1] as { signal: AbortSignal }).signal;
    rerender({ ...p001Input, enabled: false });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(signal.aborted).toBe(true);

    pending.resolve(responseFor("P001"));
    rerender(p001Input);
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe("success"));
  });
});

describe("Shift Readiness roster state", () => {
  beforeEach(() => {
    vi.resetModules();
    requestMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requests at most five unique bundled patients and isolates duplicate keys", async () => {
    const { useShiftReadinessRoster } = await loadHookModule();
    requestMock.mockImplementation(async (input: HookInput) => responseFor(input.patientId));
    const inputs = ["P001", "P001", "P002", "P003", "P004", "P005", "P006"].map((patientId) =>
      inputFor(patientId),
    );
    const { result } = renderHook(() => useShiftReadinessRoster(inputs, true));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(result.current.entriesByPatient.size).toBe(5));
    for (const patientId of ["P001", "P002", "P003", "P004", "P005"]) {
      expect(result.current.entriesByPatient.get(patientId)?.status).toBe("success");
    }
    expect(result.current.entriesByPatient.has("P006")).toBe(false);
  });

  it("shares duplicate-key in-flight work between the single hook and roster", async () => {
    const pending = deferred<ShiftReadinessResponse>();
    const { useShiftReadiness, useShiftReadinessRoster } = await loadHookModule();
    requestMock.mockReturnValue(pending.promise);
    const single = renderHook(() => useShiftReadiness(p001Input));
    const roster = renderHook(() => useShiftReadinessRoster([p001Input], true));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    pending.resolve(responseFor("P001"));
    await waitFor(() => expect(single.result.current.status).toBe("success"));
    await waitFor(() => expect(roster.result.current.entriesByPatient.get("P001")?.status).toBe("success"));
    single.unmount();
    roster.unmount();
  });

  it("invalidates only the active patient when its fingerprint changes", async () => {
    const { useShiftReadinessRoster } = await loadHookModule();
    requestMock.mockImplementation(async (input: HookInput) => responseFor(input.patientId));
    const initial = ["P001", "P002", "P003"].map((patientId) => inputFor(patientId));
    const { result, rerender } = renderHook(
      ({ inputs }: { inputs: HookInput[] }) => useShiftReadinessRoster(inputs, true),
      { initialProps: { inputs: initial } },
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.entriesByPatient.get("P002")?.status).toBe("success"));
    const changed = [
      inputFor("P001", createCurrentRecordFingerprint({ patientId: "P001", version: 2 })),
      ...initial.slice(1),
    ];
    rerender({ inputs: changed });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current.entriesByPatient.get("P001")?.status).toBe("success"));
    expect(result.current.entriesByPatient.get("P002")?.key).toBe(
      result.current.entriesByPatient.get("P002")?.key,
    );
    expect(result.current.entriesByPatient.get("P003")?.status).toBe("success");
  });

  it("keeps one patient's failure and late response from changing another entry", async () => {
    const first = deferred<ShiftReadinessResponse>();
    const { useShiftReadinessRoster } = await loadHookModule();
    requestMock.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error("P002 offline"));
    const { result, rerender } = renderHook(
      ({ inputs }: { inputs: HookInput[] }) => useShiftReadinessRoster(inputs, true),
      { initialProps: { inputs: [p001Input, p002Input] } },
    );
    await waitFor(() => expect(result.current.entriesByPatient.get("P002")?.status).toBe("error"));
    expect(result.current.entriesByPatient.get("P001")?.status).toBe("loading");
    const changedP001 = inputFor("P001", createCurrentRecordFingerprint({ patientId: "P001", version: 3 }));
    requestMock.mockResolvedValueOnce(responseFor("P001"));
    rerender({ inputs: [changedP001, p002Input] });
    await waitFor(() => expect(result.current.entriesByPatient.get("P001")?.status).toBe("success"));
    first.resolve(responseFor("P001"));
    await waitFor(() => expect(result.current.entriesByPatient.get("P001")?.key).toMatch(/^sr:/));
    expect(result.current.entriesByPatient.get("P002")?.status).toBe("error");
  });
});
