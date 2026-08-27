import { describe, expect, it, vi } from "vitest";

import { buildDemoWorkspaceData } from "./demo-adapter";

describe("buildDemoWorkspaceData", () => {
  it("returns five API-shaped patient responses with ISO comparison timestamps", () => {
    const responses = buildDemoWorkspaceData();

    expect(responses).toHaveLength(5);
    expect(responses.map(({ comparison }) => comparison.patient.id)).toEqual([
      "P001",
      "P002",
      "P003",
      "P004",
      "P005",
    ]);

    for (const response of responses) {
      expect(response).toEqual(
        expect.objectContaining({ comparison: expect.any(Object), summary: expect.any(Object) }),
      );
      expect(response.comparison.interval.previousRecordedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/,
      );
      expect(response.comparison.interval.currentRecordedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/,
      );

      for (const change of response.comparison.changes) {
        expect(Object.keys(change).sort()).toEqual([
          "category",
          "changeType",
          "currentValue",
          "delta",
          "evidence",
          "id",
          "label",
          "previousValue",
          "reviewPriority",
        ]);
        expect(Object.keys(change.evidence).sort()).toEqual([
          "currentRecordedAt",
          "fieldPath",
          "previousRecordedAt",
        ]);
        expect(change.id).toBeTruthy();
        expect(change.evidence.fieldPath).toBeTruthy();
      }
    }

    for (const { comparison, summary } of responses) {
      const ids = comparison.changes.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(summary.evidenceIds).toEqual(ids);
    }
  });

  it("does not fetch, persist, or mutate browser storage while loading demo data", async () => {
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

    const { buildDemoWorkspaceData: importedBuilder } = await import("./demo-adapter");
    importedBuilder();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();
  });
});
