import { describe, expect, it } from "vitest";

function createMemoryStorage(seed: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const REVIEW_KEY = "sr:0123abcd";
const OTHER_REVIEW_KEY = "sr:fedcba98";

async function loadReviewModule() {
  const modulePath = "./shift-readiness-review";
  return import(/* @vite-ignore */ modulePath);
}

describe("Shift Readiness session review storage", () => {
  it("uses the exact versioned storage key and returns an empty review", async () => {
    const {
      SHIFT_READINESS_REVIEW_STORAGE_KEY,
      emptyShiftReadinessReview,
    } = await loadReviewModule();
    expect(SHIFT_READINESS_REVIEW_STORAGE_KEY).toBe("nurse-handover:shift-readiness-review:v1");
    expect(emptyShiftReadinessReview()).toEqual({ acknowledgedItemIds: [], manualHandoverNote: "" });
  });

  it("reconciles stale IDs and never stores response facts or source refs", async () => {
    const {
      SHIFT_READINESS_REVIEW_STORAGE_KEY,
      loadShiftReadinessReview,
      persistShiftReadinessReview,
    } = await loadReviewModule();
    const storage = createMemoryStorage({
      [SHIFT_READINESS_REVIEW_STORAGE_KEY]: JSON.stringify({
        [REVIEW_KEY]: {
          acknowledgedItemIds: ["valid", "valid", "removed", ""],
          manualHandoverNote: "확인 메모",
        },
      }),
    });
    expect(loadShiftReadinessReview(storage, REVIEW_KEY, new Set(["valid"]))).toEqual({
      acknowledgedItemIds: ["valid"],
      manualHandoverNote: "확인 메모",
    });
    persistShiftReadinessReview(storage, REVIEW_KEY, {
      acknowledgedItemIds: ["valid"],
      manualHandoverNote: "확인 메모",
    });
    expect(storage.getItem(SHIFT_READINESS_REVIEW_STORAGE_KEY)).not.toContain("resultSummary");
  });

  it("falls back safely for corrupt JSON and wrong shapes", async () => {
    const { SHIFT_READINESS_REVIEW_STORAGE_KEY, loadShiftReadinessReview } = await loadReviewModule();
    const corrupt = createMemoryStorage({ [SHIFT_READINESS_REVIEW_STORAGE_KEY]: "{not json" });
    expect(loadShiftReadinessReview(corrupt, REVIEW_KEY, new Set(["valid"]))).toEqual({
      acknowledgedItemIds: [],
      manualHandoverNote: "",
    });
    const wrongShape = createMemoryStorage({
      [SHIFT_READINESS_REVIEW_STORAGE_KEY]: JSON.stringify({
        [REVIEW_KEY]: { acknowledgedItemIds: "not an array", manualHandoverNote: 42 },
        [OTHER_REVIEW_KEY]: null,
      }),
    });
    expect(loadShiftReadinessReview(wrongShape, REVIEW_KEY, new Set(["valid"]))).toEqual({
      acknowledgedItemIds: [],
      manualHandoverNote: "",
    });
  });

  it("keeps keys independent and persists only normalized review fields", async () => {
    const {
      SHIFT_READINESS_REVIEW_STORAGE_KEY,
      loadShiftReadinessReview,
      persistShiftReadinessReview,
    } = await loadReviewModule();
    const storage = createMemoryStorage();
    persistShiftReadinessReview(storage, REVIEW_KEY, {
      acknowledgedItemIds: [" b ", "a", "a", ""],
      manualHandoverNote: "수기 메모",
    });
    persistShiftReadinessReview(storage, OTHER_REVIEW_KEY, {
      acknowledgedItemIds: ["other"],
      manualHandoverNote: "다른 환자",
    });
    expect(loadShiftReadinessReview(storage, REVIEW_KEY, new Set(["a", "b"]))).toEqual({
      acknowledgedItemIds: ["b", "a"],
      manualHandoverNote: "수기 메모",
    });
    expect(loadShiftReadinessReview(storage, OTHER_REVIEW_KEY, new Set(["other"]))).toEqual({
      acknowledgedItemIds: ["other"],
      manualHandoverNote: "다른 환자",
    });
    const serialized = storage.getItem(SHIFT_READINESS_REVIEW_STORAGE_KEY) ?? "";
    expect(serialized).not.toContain("sourceRefs");
    expect(serialized).not.toContain("resultSummary");
  });

  it("toggles acknowledgement immutably and clears one key without disturbing another", async () => {
    const {
      loadShiftReadinessReview,
      persistShiftReadinessReview,
      removeShiftReadinessReview,
      toggleAcknowledgedItem,
    } = await loadReviewModule();
    const storage = createMemoryStorage();
    const initial = { acknowledgedItemIds: ["one"], manualHandoverNote: "" };
    const added = toggleAcknowledgedItem(initial, "two");
    expect(added).toEqual({ acknowledgedItemIds: ["one", "two"], manualHandoverNote: "" });
    expect(initial).toEqual({ acknowledgedItemIds: ["one"], manualHandoverNote: "" });
    expect(toggleAcknowledgedItem(added, "one")).toEqual({ acknowledgedItemIds: ["two"], manualHandoverNote: "" });
    persistShiftReadinessReview(storage, REVIEW_KEY, added);
    persistShiftReadinessReview(storage, OTHER_REVIEW_KEY, {
      acknowledgedItemIds: ["other"],
      manualHandoverNote: "keep",
    });
    removeShiftReadinessReview(storage, REVIEW_KEY);
    expect(loadShiftReadinessReview(storage, REVIEW_KEY, new Set(["one", "two"]))).toEqual({
      acknowledgedItemIds: [],
      manualHandoverNote: "",
    });
    expect(loadShiftReadinessReview(storage, OTHER_REVIEW_KEY, new Set(["other"]))).toEqual({
      acknowledgedItemIds: ["other"],
      manualHandoverNote: "keep",
    });
  });

  it("rejects raw or non-canonical review keys without disturbing canonical entries", async () => {
    const {
      SHIFT_READINESS_REVIEW_STORAGE_KEY,
      loadShiftReadinessReview,
      persistShiftReadinessReview,
      removeShiftReadinessReview,
    } = await loadReviewModule();
    const storage = createMemoryStorage();
    persistShiftReadinessReview(storage, REVIEW_KEY, {
      acknowledgedItemIds: ["valid"],
      manualHandoverNote: "보존 메모",
    });
    const beforeInvalidWrite = storage.getItem(SHIFT_READINESS_REVIEW_STORAGE_KEY);
    const rawKey = "P001:2026-06-28T09:00:00+09:00";
    const upperCaseKey = "sr:0123ABCD";
    persistShiftReadinessReview(storage, rawKey, {
      acknowledgedItemIds: ["raw"],
      manualHandoverNote: "저장 금지",
    });
    persistShiftReadinessReview(storage, upperCaseKey, {
      acknowledgedItemIds: ["upper"],
      manualHandoverNote: "저장 금지",
    });
    removeShiftReadinessReview(storage, rawKey);
    expect(storage.getItem(SHIFT_READINESS_REVIEW_STORAGE_KEY)).toBe(beforeInvalidWrite);
    expect(loadShiftReadinessReview(storage, rawKey, new Set(["raw"]))).toEqual({
      acknowledgedItemIds: [],
      manualHandoverNote: "",
    });

    storage.setItem(
      SHIFT_READINESS_REVIEW_STORAGE_KEY,
      JSON.stringify({
        [rawKey]: { acknowledgedItemIds: ["raw"], manualHandoverNote: "raw" },
        [REVIEW_KEY]: { acknowledgedItemIds: ["valid"], manualHandoverNote: "보존 메모" },
      }),
    );
    expect(loadShiftReadinessReview(storage, REVIEW_KEY, new Set(["valid"]))).toEqual({
      acknowledgedItemIds: ["valid"],
      manualHandoverNote: "보존 메모",
    });
    persistShiftReadinessReview(storage, REVIEW_KEY, {
      acknowledgedItemIds: ["valid"],
      manualHandoverNote: "보존 메모",
    });
    expect(storage.getItem(SHIFT_READINESS_REVIEW_STORAGE_KEY)).not.toContain(rawKey);
    expect(storage.getItem(SHIFT_READINESS_REVIEW_STORAGE_KEY)).toContain(REVIEW_KEY);
  });
});
