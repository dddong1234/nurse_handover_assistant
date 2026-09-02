import { describe, expect, it } from "vitest";

import type { DemoPatientRecord } from "./demo-records";
import { getDemoTimeline } from "./demo-timelines";

type DemoShiftReadinessAdapter = typeof import("./demo-shift-readiness");

const PATIENT_IDS = ["P001", "P002", "P003", "P004", "P005"] as const;

function loadAdapter() {
  const modulePath = "./demo-shift-readiness";
  return import(/* @vite-ignore */ modulePath) as Promise<DemoShiftReadinessAdapter>;
}

describe("demo Shift Readiness adapter", () => {
  it("merges P001 current operational state without mutating the core timeline", async () => {
    const { buildShiftReadinessRecords } = await loadAdapter();
    const timeline = getDemoTimeline("P001");
    const before = structuredClone(timeline.snapshots);
    const records = buildShiftReadinessRecords("P001", timeline.snapshots);

    expect(records.at(-1)?.investigations.map((item) => item.id)).toEqual([
      "INV-P001-CBC",
      "INV-P001-CXR",
    ]);
    expect(
      records.at(-1)?.medications.find((item) => item.name === "타세놀정 500mg")?.effectiveFrom,
    ).toBe("2026-07-02T09:00:00+09:00");
    expect(timeline.snapshots).toEqual(before);
  });

  it("keeps exact eight-slot parity for every bundled patient", async () => {
    const { buildShiftReadinessRecords } = await loadAdapter();
    for (const patientId of PATIENT_IDS) {
      const timeline = getDemoTimeline(patientId);
      const records = buildShiftReadinessRecords(patientId, timeline.snapshots);

      expect(records).toHaveLength(8);
      expect(records.map((record) => record.updated_at)).toEqual(
        timeline.snapshots.map((snapshot) => snapshot.updated_at),
      );
      expect(records.every((record) => record.patient_id === patientId)).toBe(true);
    }
  });

  it("returns fresh record and nested operational clones", async () => {
    const { buildShiftReadinessRecords } = await loadAdapter();
    const timeline = getDemoTimeline("P001");
    const first = buildShiftReadinessRecords("P001", timeline.snapshots);
    const second = buildShiftReadinessRecords("P001", timeline.snapshots);

    expect(first).not.toBe(second);
    expect(first[7]).not.toBe(second[7]);
    expect(first[7]?.investigations).not.toBe(second[7]?.investigations);
    first[7]!.investigations[0]!.name = "mutated outside adapter";
    first[7]!.medications[0]!.orderStatus = "stopped";

    expect(second[7]?.investigations[0]?.name).toBe("CBC");
    expect(second[7]?.medications[0]?.orderStatus).toBe("planned");
    expect(buildShiftReadinessRecords("P001", timeline.snapshots)[7]?.investigations[0]?.name).toBe(
      "CBC",
    );
  });

  it("returns the configured shift as a fresh value and rejects unknown patients", async () => {
    const { buildShiftReadinessRecords, getDemoShiftWindow } = await loadAdapter();
    const first = getDemoShiftWindow("P001");
    const second = getDemoShiftWindow("P001");
    first.startsAt = "changed";

    expect(second.startsAt).toBe("2026-07-02T07:00:00+09:00");
    expect(() => getDemoShiftWindow("P999")).toThrow();
    expect(() => buildShiftReadinessRecords("P999", [])).toThrow();
  });

  it("rejects a non-final timestamp, count, or order drift", async () => {
    const { buildShiftReadinessRecords } = await loadAdapter();
    const timeline = getDemoTimeline("P001");
    const changedTimestamp = structuredClone(timeline.snapshots) as DemoPatientRecord[];
    changedTimestamp[6]!.updated_at = "2026-07-01T22:00:00+09:00";
    expect(() => buildShiftReadinessRecords("P001", changedTimestamp)).toThrow(
      expect.objectContaining({ code: "INVALID_CORE_TIMELINE" }),
    );

    expect(() => buildShiftReadinessRecords("P001", timeline.snapshots.slice(0, 7))).toThrow(
      expect.objectContaining({ code: "INVALID_CORE_TIMELINE" }),
    );

    const changedOrder = structuredClone(timeline.snapshots) as DemoPatientRecord[];
    const [first] = changedOrder.splice(0, 1);
    if (!first) throw new Error("expected first record");
    changedOrder.push(first);
    expect(() => buildShiftReadinessRecords("P001", changedOrder)).toThrow(
      expect.objectContaining({ code: "INVALID_CORE_TIMELINE" }),
    );
  });

  it("allows a current core draft overlay while preserving sidecar metadata", async () => {
    const { buildShiftReadinessRecords } = await loadAdapter();
    const timeline = getDemoTimeline("P001");
    const records = structuredClone(timeline.snapshots) as DemoPatientRecord[];
    const current = records.at(-1);
    if (!current) throw new Error("expected current record");

    records[7] = {
      ...current,
      name: "홍길동 수정",
      notes: ["세션에서 수정한 메모"],
      updated_at: "2026-07-02T10:00:00+09:00",
    };

    const merged = buildShiftReadinessRecords("P001", records);
    expect(merged.at(-1)?.name).toBe("홍길동 수정");
    expect(merged.at(-1)?.notes).toEqual(["세션에서 수정한 메모"]);
    expect(merged.at(-1)?.updated_at).toBe("2026-07-02T10:00:00+09:00");
    expect(merged.at(-1)?.investigations.map((item) => item.id)).toEqual([
      "INV-P001-CBC",
      "INV-P001-CXR",
    ]);
    expect(merged.at(-1)?.handoffRequests[0]?.id).toBe("REQ-P001-ROUND-1");
  });

  it("rejects a renamed or removed scheduled medication as stale metadata", async () => {
    const { buildShiftReadinessRecords } = await loadAdapter();
    const timeline = getDemoTimeline("P001");
    const renamed = structuredClone(timeline.snapshots) as DemoPatientRecord[];
    const renamedCurrent = renamed.at(-1);
    if (!renamedCurrent) throw new Error("expected current record");
    renamedCurrent.medications[1] = {
      ...renamedCurrent.medications[1]!,
      name: "다른 약",
    };

    expect(() => buildShiftReadinessRecords("P001", renamed)).toThrow(
      expect.objectContaining({ code: "STALE_OPERATIONAL_METADATA" }),
    );

    const removed = structuredClone(timeline.snapshots) as DemoPatientRecord[];
    removed.at(-1)?.medications.splice(1, 1);
    expect(() => buildShiftReadinessRecords("P001", removed)).toThrow(
      expect.objectContaining({ code: "STALE_OPERATIONAL_METADATA" }),
    );
  });

  it("keeps operational merging free of readiness classifications or generated copy", async () => {
    const { buildShiftReadinessRecords } = await loadAdapter();
    const records = buildShiftReadinessRecords("P001", getDemoTimeline("P001").snapshots);

    for (const record of records) {
      expect(record).not.toHaveProperty("items");
      expect(record).not.toHaveProperty("factStatus");
      expect(record).not.toHaveProperty("ruleCode");
      expect(record).not.toHaveProperty("summary");
      expect(record).toHaveProperty("investigations");
      expect(record).toHaveProperty("devices");
      expect(record).toHaveProperty("handoffRequests");
    }
  });

  it("keeps all current core fields when no draft overlay is supplied", async () => {
    const { buildShiftReadinessRecords } = await loadAdapter();
    const timeline = getDemoTimeline("P001");
    const records = buildShiftReadinessRecords("P001", timeline.snapshots);
    expect(records.at(-1)).toMatchObject(timeline.snapshots.at(-1) as DemoPatientRecord);
  });
});
