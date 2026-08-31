import { describe, expect, it } from "vitest";

import { demoRecordPairs } from "./demo-records";
import {
  DEMO_RECORD_TIMELINES,
  getDemoTimeline,
  listReturnStartOptions,
} from "./demo-timelines";

const PATIENT_IDS = ["P001", "P002", "P003", "P004", "P005"] as const;

describe("demo return timelines", () => {
  it("loads eight P001 snapshots and keeps the final snapshot equal to the current record", () => {
    const timeline = getDemoTimeline("P001");

    expect(timeline.snapshots).toHaveLength(8);
    expect(timeline.snapshots.at(-1)).toEqual(demoRecordPairs.P001?.current);
  });

  it("lists only supplied snapshot timestamps as return-start options", () => {
    const timeline = getDemoTimeline("P001");
    const options = listReturnStartOptions("P001");

    expect(options).toEqual(timeline.snapshots.map((snapshot) => snapshot.updated_at));
    expect(options).toContain("2026-06-29T15:00:00+09:00");
  });

  it("validates all five supplied timelines without inferring new clinical states", () => {
    for (const patientId of PATIENT_IDS) {
      const timeline = getDemoTimeline(patientId);
      expect(timeline.patientId).toBe(patientId);
      expect(timeline.snapshots).toHaveLength(8);
      expect(timeline.snapshots.every((snapshot) => snapshot.patient_id === patientId)).toBe(true);
      expect(timeline.snapshots.at(-1)).toEqual(demoRecordPairs[patientId]?.current);
    }

    expect(getDemoTimeline("P003").coverageGaps).toEqual([
      {
        from: "2026-06-30T18:00:00+09:00",
        to: "2026-07-01T00:00:00+09:00",
        code: "source_unavailable",
      },
    ]);
    expect(getDemoTimeline("P001").coverageGaps).toEqual([]);
  });

  it("does not expose mutable copies of the imported timeline fixture", () => {
    const first = getDemoTimeline("P001");
    first.snapshots[0]!.notes[0] = "changed outside adapter";

    expect(getDemoTimeline("P001").snapshots[0]!.notes[0]).toBe("인후통 시작");
    expect(DEMO_RECORD_TIMELINES.P001.snapshots[0]!.notes[0]).toBe("인후통 시작");
  });

  it("rejects an unknown patient timeline", () => {
    expect(() => getDemoTimeline("P999")).toThrow();
    expect(() => listReturnStartOptions("P999")).toThrow();
  });
});
