export const SHIFT_READINESS_REVIEW_STORAGE_KEY = "nurse-handover:shift-readiness-review:v1";

export type ShiftReadinessReview = {
  acknowledgedItemIds: string[];
  manualHandoverNote: string;
};

export type ShiftReadinessReviewStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

type CurrentItemIds = ReadonlySet<string> | readonly string[] | undefined;
type UnknownRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function itemIdSet(value: CurrentItemIds): ReadonlySet<string> | null {
  if (value === undefined) return null;
  return value instanceof Set ? value : new Set(value);
}

function normalizeReview(value: unknown, currentItemIds?: CurrentItemIds): ShiftReadinessReview {
  if (!isPlainObject(value)) return emptyShiftReadinessReview();
  let acknowledgedItemIds = normalizedIds(value.acknowledgedItemIds);
  const allowedIds = itemIdSet(currentItemIds);
  if (allowedIds) acknowledgedItemIds = acknowledgedItemIds.filter((id) => allowedIds.has(id));
  return {
    acknowledgedItemIds,
    manualHandoverNote: typeof value.manualHandoverNote === "string" ? value.manualHandoverNote : "",
  };
}

function readStoredReviews(storage: ShiftReadinessReviewStorage): Record<string, ShiftReadinessReview> {
  let serialized: string | null;
  try {
    serialized = storage.getItem(SHIFT_READINESS_REVIEW_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!serialized) return {};

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isPlainObject(parsed)) return {};
    const reviews: Record<string, ShiftReadinessReview> = {};
    for (const [reviewKey, value] of Object.entries(parsed)) {
      const review = normalizeReview(value);
      if (isPlainObject(value)) reviews[reviewKey] = review;
    }
    return reviews;
  } catch {
    return {};
  }
}

function writeStoredReviews(
  storage: ShiftReadinessReviewStorage,
  reviews: Record<string, ShiftReadinessReview>,
): void {
  const sanitized: Record<string, ShiftReadinessReview> = {};
  for (const [reviewKey, review] of Object.entries(reviews)) {
    sanitized[reviewKey] = normalizeReview(review);
  }
  if (Object.keys(sanitized).length === 0) {
    try {
      storage.removeItem(SHIFT_READINESS_REVIEW_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in a restricted browser context.
    }
    return;
  }
  try {
    storage.setItem(SHIFT_READINESS_REVIEW_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Session storage is a best-effort review aid; API facts remain outside this boundary.
  }
}

export function emptyShiftReadinessReview(): ShiftReadinessReview {
  return { acknowledgedItemIds: [], manualHandoverNote: "" };
}

export function loadShiftReadinessReview(
  storage: ShiftReadinessReviewStorage,
  reviewKey: string,
  currentItemIds?: CurrentItemIds,
): ShiftReadinessReview {
  const reviews = readStoredReviews(storage);
  return normalizeReview(reviews[reviewKey], currentItemIds);
}

export function persistShiftReadinessReview(
  storage: ShiftReadinessReviewStorage,
  reviewKey: string,
  review: ShiftReadinessReview,
): void {
  const reviews = readStoredReviews(storage);
  reviews[reviewKey] = normalizeReview(review);
  writeStoredReviews(storage, reviews);
}

export function toggleAcknowledgedItem(
  review: ShiftReadinessReview,
  itemId: string,
): ShiftReadinessReview {
  const normalizedReview = normalizeReview(review);
  const id = itemId.trim();
  if (!id) return normalizedReview;
  const acknowledgedItemIds = normalizedReview.acknowledgedItemIds.includes(id)
    ? normalizedReview.acknowledgedItemIds.filter((existingId) => existingId !== id)
    : [...normalizedReview.acknowledgedItemIds, id];
  return { ...normalizedReview, acknowledgedItemIds };
}

export function removeShiftReadinessReview(
  storage: ShiftReadinessReviewStorage,
  reviewKey: string,
): void {
  const reviews = readStoredReviews(storage);
  delete reviews[reviewKey];
  writeStoredReviews(storage, reviews);
}
