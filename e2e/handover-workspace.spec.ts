import { expect, test, type Page } from "@playwright/test";

import p001ReturnPeriodStates from "../data/contracts/P001_return_period_states.json";
import { buildDemoWorkspaceData } from "../src/lib/demo-adapter";
import { buildShiftReadinessRecords, getDemoShiftWindow } from "../src/lib/demo-shift-readiness";
import { getDemoTimeline } from "../src/lib/demo-timelines";
import {
  isHandoverPeriodApiResponse,
  type HandoverPeriodApiResponse,
} from "../src/lib/handover-period-contracts";
import {
  createValidShiftReadinessResponse,
} from "../src/test/shift-readiness-fixtures";
import type {
  ShiftReadinessResponse,
  ShiftReadinessStatus,
} from "../src/lib/shift-readiness-contracts";

const FALLBACK_MESSAGE = "서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.";
const RETIRED_SAFETY_NOTICE = ["가상 데이터", "의사결정 보조가 아님"].join(" · ");
const RETIRED_UTILITY_CONTEXT = ["일반 성인병동", "교대 검토"].join(" · ");
const P001_RETURN_START_OPTIONS = getDemoTimeline("P001").snapshots.map((snapshot) => snapshot.updated_at);

async function forceCompareFailure(page: Page, status = 503) {
  await page.route("**/api/handover/compare", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ detail: "provider unavailable" }),
    });
  });
}

function p001Patient(page: Page) {
  return page.getByRole("button", { name: /홍길동, P001, 301호/ });
}

function temperatureChange(page: Page) {
  return page.getByTestId("change-card").filter({
    has: page.getByRole("heading", { name: "체온", exact: true }),
  });
}

async function expectFallbackBanner(page: Page) {
  const banner = page.getByRole("status").filter({ hasText: FALLBACK_MESSAGE });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  return banner;
}

const RETURN_PERIOD_STATES = ["ready", "partial", "no_baseline", "no_events"] as const;
type ReturnResponseState = (typeof RETURN_PERIOD_STATES)[number];

type ReturnPeriodRequestBody = {
  reviewStartAt?: string;
  records?: Array<Record<string, unknown>>;
};

type ReturnPeriodStateHandler = (
  body: ReturnPeriodRequestBody,
  requestIndex: number,
) => ReturnResponseState | Promise<ReturnResponseState>;

type ShiftReadinessRequestBody = {
  reviewStartAt?: unknown;
  shift?: unknown;
  records?: unknown;
  coverageGaps?: unknown;
};

type ValidShiftReadinessRequestBody = {
  reviewStartAt: string;
  shift: ShiftReadinessResponse["shift"];
  records: Array<Record<string, unknown>>;
  coverageGaps: Array<Record<string, unknown>>;
};

type ShiftReadinessStateHandler = (
  body: ValidShiftReadinessRequestBody,
  requestIndex: number,
) => ShiftReadinessStatus | Promise<ShiftReadinessStatus>;

const SHIFT_READINESS_STATES = ["available", "no_baseline", "no_items", "partial"] as const;

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function assertValidShiftReadinessRequestBody(
  body: unknown,
): asserts body is ValidShiftReadinessRequestBody {
  if (!isPlainObject(body)) throw new Error("Shift Readiness request must be an object.");

  const requestKeys = Object.keys(body).sort();
  if (requestKeys.join(",") !== "coverageGaps,records,reviewStartAt,shift") {
    throw new Error("Shift Readiness request must include exactly reviewStartAt, shift, records, and coverageGaps.");
  }
  if (!isIsoTimestamp(body.reviewStartAt)) {
    throw new Error("Shift Readiness request reviewStartAt must be a nonempty ISO timestamp.");
  }
  if (!Array.isArray(body.records) || body.records.length === 0) {
    throw new Error("Shift Readiness request records must be nonempty.");
  }
  if (!body.records.every(isPlainObject)) {
    throw new Error("Shift Readiness request records must contain objects.");
  }
  const records = body.records;
  const patientIds = records.map((record) => record.patient_id);
  if (!patientIds.every((patientId): patientId is string => stringValue(patientId, "").length > 0)) {
    throw new Error("Shift Readiness request records must identify a patient.");
  }
  const patientId = patientIds[0];
  if (!patientId || patientIds.some((candidate) => candidate !== patientId)) {
    throw new Error("Shift Readiness request records must use one consistent patient identity.");
  }

  let timeline: ReturnType<typeof getDemoTimeline>;
  try {
    timeline = getDemoTimeline(patientId);
  } catch {
    throw new Error(`Shift Readiness request patient ${patientId} is not a representative demo patient.`);
  }
  const canonicalTimestamps = timeline.snapshots.map((snapshot) => snapshot.updated_at);
  if (!canonicalTimestamps.includes(body.reviewStartAt)) {
    throw new Error("Shift Readiness request reviewStartAt must identify a known timeline slot.");
  }
  if (records.length !== canonicalTimestamps.length) {
    throw new Error("Shift Readiness request records must include the complete timeline.");
  }
  records.forEach((record, index) => {
    const expectedTimestamp = canonicalTimestamps[index];
    if (!isIsoTimestamp(record.updated_at) || record.updated_at !== expectedTimestamp) {
      throw new Error("Shift Readiness request records must preserve the canonical timeline timestamps.");
    }
  });
  const currentRecord = records.at(-1);
  const currentTimestamp = canonicalTimestamps.at(-1);
  if (!currentRecord || currentRecord.patient_id !== patientId || currentRecord.updated_at !== currentTimestamp) {
    throw new Error("Shift Readiness request must include the current record and its canonical timestamp.");
  }

  if (!isPlainObject(body.shift) ||
      Object.keys(body.shift).sort().join(",") !== "endsAt,startsAt" ||
      !isIsoTimestamp(body.shift.startsAt) ||
      !isIsoTimestamp(body.shift.endsAt) ||
      Date.parse(body.shift.startsAt) >= Date.parse(body.shift.endsAt)) {
    throw new Error("Shift Readiness request shift must include an ordered startsAt/endsAt window.");
  }
  const expectedShift = getDemoShiftWindow(patientId);
  if (body.shift.startsAt !== expectedShift.startsAt || body.shift.endsAt !== expectedShift.endsAt) {
    throw new Error("Shift Readiness request shift does not match the representative patient window.");
  }
  if (!Array.isArray(body.coverageGaps) || !body.coverageGaps.every((gap) => {
    return isPlainObject(gap) && isIsoTimestamp(gap.from) && isIsoTimestamp(gap.to);
  })) {
    throw new Error("Shift Readiness request coverageGaps must contain timestamped gaps.");
  }
}

function parseShiftReadinessRequest(
  request: { method(): string; postData(): string | null },
): ValidShiftReadinessRequestBody {
  if (request.method() !== "POST") throw new Error("Shift Readiness route requires POST.");
  const payload = request.postData();
  if (!payload) throw new Error("Shift Readiness POST body is required.");
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    throw new Error("Shift Readiness POST body must be valid JSON.");
  }
  assertValidShiftReadinessRequestBody(body);
  return body;
}

function validReadinessRequestBody(patientId = "P001"): ValidShiftReadinessRequestBody {
  const timeline = getDemoTimeline(patientId);
  return {
    reviewStartAt: timeline.defaultReturnStartAt,
    shift: getDemoShiftWindow(patientId),
    records: buildShiftReadinessRecords(patientId, timeline.snapshots) as unknown as Array<Record<string, unknown>>,
    coverageGaps: timeline.coverageGaps as unknown as Array<Record<string, unknown>>,
  };
}

function readinessFixtureForRequest(
  body: ShiftReadinessRequestBody,
  state: ShiftReadinessStatus = "available",
): ShiftReadinessResponse {
  assertValidShiftReadinessRequestBody(body);
  const response = structuredClone(createValidShiftReadinessResponse());
  const firstRecord = body.records[0]!;
  const currentRecord = body.records.at(-1)!;
  const patientId = firstRecord.patient_id as string;
  const currentRecordedAt = currentRecord.updated_at as string;
  const baselineRecordedAt = firstRecord.updated_at as string;

  response.patient = {
    ...response.patient,
    id: patientId,
    name: stringValue(firstRecord.name, response.patient.name),
    room: stringValue(firstRecord.room_no, response.patient.room),
    age: typeof firstRecord.age === "number" ? firstRecord.age : response.patient.age,
    sex: stringValue(firstRecord.sex, response.patient.sex),
    diagnoses: Array.isArray(firstRecord.diagnosis)
      ? firstRecord.diagnosis.filter((diagnosis): diagnosis is string => typeof diagnosis === "string")
      : response.patient.diagnoses,
  };
  response.reviewPeriod = {
    requestedStartAt: body.reviewStartAt,
    baselineRecordedAt: state === "no_baseline" ? null : baselineRecordedAt,
    currentRecordedAt,
  };
  response.shift = body.shift;
  response.status = state;
  response.dataWarnings = state === "partial"
    ? ["명시된 데이터 공백이 있어 확인 가능한 항목만 표시합니다."]
    : [];
  if (patientId !== "P001") {
    const representativeId = `${patientId}-patient-status-current`;
    response.items = [{
      id: representativeId,
      patientId,
      domain: "patient_status",
      factStatus: "recent_change",
      title: "현재 기록 변화",
      detail: "현재 기록에서 확인할 변화가 있습니다.",
      relevantAt: currentRecordedAt,
      sourceRefs: [{
        recordedAt: currentRecordedAt,
        path: "vitals.body_temperature",
        label: "현재 활력징후",
        periodEventId: `period-event-${patientId}-vitals`,
      }],
      ruleCode: "STATUS_PERIOD_CHANGE",
    }];
    response.groups = {
      patientStatus: [representativeId],
      investigations: [],
      lineDevices: [],
      medications: [],
      communications: [],
    };
    response.metrics = {
      itemCount: 1,
      newResultCount: 0,
      scheduledThisShiftCount: 0,
      pendingResultCount: 0,
      domainCounts: {
        patient_status: 1,
        investigation: 0,
        line_device: 0,
        medication: 0,
        communication: 0,
      },
    };
  }
  response.items = response.items.map((item) => ({
    ...item,
    patientId,
    sourceRefs: item.sourceRefs.map((source) => ({ ...source, recordedAt: currentRecordedAt })),
  }));

  if (state === "no_items") {
    response.items = [];
    response.groups = {
      patientStatus: [],
      investigations: [],
      lineDevices: [],
      medications: [],
      communications: [],
    };
    response.metrics = {
      itemCount: 0,
      newResultCount: 0,
      scheduledThisShiftCount: 0,
      pendingResultCount: 0,
      domainCounts: {
        patient_status: 0,
        investigation: 0,
        line_device: 0,
        medication: 0,
        communication: 0,
      },
    };
  }
  return response;
}

async function mockShiftReadinessApi(
  page: Page,
  state: ShiftReadinessStatus = "available",
  handler?: ShiftReadinessStateHandler,
) {
  let requestIndex = 0;
  await page.route("**/api/handover/shift-readiness", async (route) => {
    const body = parseShiftReadinessRequest(route.request());
    requestIndex += 1;
    const selectedState = handler ? await handler(body, requestIndex) : state;
    const response = readinessFixtureForRequest(body, selectedState);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
}

test("shift readiness fixtures fail closed for missing or mismatched request fields", async () => {
  const valid = validReadinessRequestBody();

  expect(() => readinessFixtureForRequest({})).toThrow(/exactly reviewStartAt/);
  expect(() => readinessFixtureForRequest({ ...valid, records: [] })).toThrow(/records must be nonempty/);
  expect(() => readinessFixtureForRequest({ ...valid, reviewStartAt: "" })).toThrow(/reviewStartAt/);
  expect(() => readinessFixtureForRequest({
    ...valid,
    shift: { startsAt: valid.shift.startsAt, endsAt: "2026-07-02T16:00:00+09:00" },
  })).toThrow(/shift/);
  expect(() => readinessFixtureForRequest({
    ...valid,
    records: valid.records.map((record, index) => index === 0 ? { ...record, patient_id: "P002" } : record),
  })).toThrow(/consistent patient identity/);
  expect(() => readinessFixtureForRequest({
    ...valid,
    records: valid.records.slice(0, -1),
  })).toThrow(/complete timeline/);
  expect(() => parseShiftReadinessRequest({
    method: () => "GET",
    postData: () => JSON.stringify(valid),
  })).toThrow(/requires POST/);
});

const RETURN_PERIOD_FIXTURES = p001ReturnPeriodStates as unknown as Record<
  ReturnResponseState,
  HandoverPeriodApiResponse
>;

for (const state of RETURN_PERIOD_STATES) {
  if (!isHandoverPeriodApiResponse(RETURN_PERIOD_FIXTURES[state])) {
    throw new Error(`P001 return period fixture state ${state} violates the response contract.`);
  }
}

function cloneP001ReturnFixture(state: ReturnResponseState): HandoverPeriodApiResponse {
  const fixture = RETURN_PERIOD_FIXTURES[state];
  if (!isHandoverPeriodApiResponse(fixture)) {
    throw new Error(`P001 return period fixture state ${state} violates the response contract.`);
  }
  return structuredClone(fixture);
}

function formatReturnFixtureValue(value: HandoverPeriodApiResponse["events"][number]["change"]["currentValue"]): string {
  if (value === null) return "기록 없음";
  if (typeof value === "object") return `${value.name} · ${value.route} · ${value.frequency}`;
  return String(value);
}

function orderReturnEventsChronologically(
  left: HandoverPeriodApiResponse["events"][number],
  right: HandoverPeriodApiResponse["events"][number],
) {
  return Date.parse(left.detectedAt) - Date.parse(right.detectedAt) || left.id.localeCompare(right.id);
}

async function mockP001ReturnApi(
  page: Page,
  state: ReturnResponseState = "ready",
  handler?: ReturnPeriodStateHandler,
) {
  let requestIndex = 0;
  await page.route("**/api/handover/period-compare", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as ReturnPeriodRequestBody;
    requestIndex += 1;
    const selectedState = handler ? await handler(body, requestIndex) : state;
    const response = cloneP001ReturnFixture(selectedState);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
}

test("return handover P001 completes the 24-event evidence review workflow", async ({ page }) => {
  const [pairResponse] = buildDemoWorkspaceData();
  if (!pairResponse) throw new Error("P001 pair response is unavailable.");

  const ready = cloneP001ReturnFixture("ready");
  const salineLabel = ready.events.find(
    (event) => event.change.category === "medications" &&
      event.change.changeType === "added" &&
      event.classification === "period_only",
  )?.change.label;
  const ibuprofenLabel = ready.events.find(
    (event) => event.change.category === "medications" &&
      event.change.changeType === "modified" &&
      event.classification === "current",
  )?.change.label;
  const latestEditableEvent = ready.events.find(
    (event) => event.interval.currentRecordedAt === ready.period.currentRecordedAt &&
      event.change.category === "medications" &&
      event.change.changeType === "added",
  );
  if (!salineLabel || !ibuprofenLabel || !latestEditableEvent) {
    throw new Error("P001 return fixture is missing expected medication lifecycle events.");
  }

  const recomparisonRelease = { current: null as (() => void) | null };
  const recomparison = new Promise<void>((resolve) => { recomparisonRelease.current = resolve; });
  const secondPeriodRequest = {
    current: null as ReturnPeriodRequestBody | null,
    resolve: null as ((body: ReturnPeriodRequestBody) => void) | null,
  };
  const secondPeriodRequestSeen = new Promise<ReturnPeriodRequestBody>((resolve) => {
    secondPeriodRequest.resolve = resolve;
  });

  await page.route("**/api/handover/compare", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(structuredClone(pairResponse)) });
  });
  await mockP001ReturnApi(page, "ready", async (body, requestIndex): Promise<ReturnResponseState> => {
    if (requestIndex === 2) {
      secondPeriodRequest.current = body;
      secondPeriodRequest.resolve?.(body);
      await recomparison;
    }
    return "ready";
  });
  await mockShiftReadinessApi(page);

  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  await page.getByRole("tab", { name: "변화 근거", exact: true }).click();

  const startSelector = page.getByRole("combobox", { name: "마지막 근무 시각" });
  await expect(startSelector).toHaveValue(ready.period.requestedStartAt);
  const readySituation = ready.summary.sections.situation[0]?.text;
  if (!readySituation) throw new Error("P001 ready fixture has no situation summary.");
  await expect(page.getByText(readySituation, { exact: true })).toBeVisible();
  const returnWorkspace = page.getByTestId("return-comparison-workspace");
  const returnSummary = page.getByRole("complementary", { name: "복귀 인계 검토" });
  await expect(returnSummary.getByText("24/24", { exact: true })).toBeVisible();

  const salineEvents = ready.events
    .filter((event) => event.change.label === salineLabel)
    .sort(orderReturnEventsChronologically);
  expect(salineEvents).toHaveLength(2);
  expect(salineEvents.map((event) => event.change.changeType)).toEqual(["added", "removed"]);
  expect(salineEvents.every((event) => event.classification === "period_only")).toBe(true);

  for (const [index, event] of salineEvents.entries()) {
    const row = returnWorkspace.locator(`[data-testid="return-event-row"][data-event-id="${event.id}"]`);
    await expect(row).toHaveClass(new RegExp(`return-event-${event.classification}`));
    await expect(row.locator(".return-event-value-previous strong")).toHaveText(formatReturnFixtureValue(event.change.previousValue));
    await expect(row.locator(".return-event-value-current strong")).toHaveText(formatReturnFixtureValue(event.change.currentValue));

    const evidence = row.getByRole("button", { name: "근거 보기" });
    await evidence.click();
    const recordPanel = page.getByRole("tabpanel", { name: "원본 기록" });
    await expect(recordPanel.locator(".record-source-interval time")).toHaveText([
      event.interval.previousRecordedAt,
      event.interval.currentRecordedAt,
    ]);
    if (index === 0) {
      await recordPanel.getByRole("tab", { name: /현재 기록/ }).click();
      await expect(recordPanel.getByText("선택 사건의 현재 snapshot", { exact: true })).toBeVisible();
      await expect(recordPanel.getByRole("button", { name: "변경사항 비교" })).not.toBeVisible();
    }
    await recordPanel.getByRole("button", { name: "비교로 돌아가기" }).click();
    await expect(evidence).toBeFocused();
  }

  const ibuprofenEvents = ready.events
    .filter((event) => event.change.label === ibuprofenLabel)
    .sort(orderReturnEventsChronologically);
  expect(ibuprofenEvents).toHaveLength(3);
  expect(ibuprofenEvents.every((event) => event.change.changeType === "modified")).toBe(true);
  expect(ibuprofenEvents.every((event) => event.classification === "current")).toBe(true);
  const ibuprofenFrequencyPath = [
    ibuprofenEvents[0]?.change.previousValue,
    ...ibuprofenEvents.map((event) => event.change.currentValue),
  ].map((value) => {
    if (!value || typeof value !== "object") throw new Error("Ibuprofen fixture value is not a medication.");
    return value.frequency;
  });
  expect(ibuprofenFrequencyPath).toEqual(["BID", "TID", "BID", "TID"]);

  for (const event of ibuprofenEvents) {
    const row = returnWorkspace.locator(`[data-testid="return-event-row"][data-event-id="${event.id}"]`);
    await expect(row).toHaveClass(new RegExp(`return-event-${event.classification}`));
    await expect(row.locator(".return-event-value-previous strong")).toHaveText(formatReturnFixtureValue(event.change.previousValue));
    await expect(row.locator(".return-event-value-current strong")).toHaveText(formatReturnFixtureValue(event.change.currentValue));
    const evidence = row.getByRole("button", { name: "근거 보기" });
    await evidence.click();
    const recordPanel = page.getByRole("tabpanel", { name: "원본 기록" });
    await expect(recordPanel.locator(".record-source-interval time")).toHaveText([
      event.interval.previousRecordedAt,
      event.interval.currentRecordedAt,
    ]);
    await recordPanel.getByRole("button", { name: "비교로 돌아가기" }).click();
    await expect(evidence).toBeFocused();
  }

  const latestEvidence = returnWorkspace.locator(`[data-testid="return-event-row"][data-event-id="${latestEditableEvent.id}"]`).getByRole("button", { name: "근거 보기" });
  await latestEvidence.click();
  const editableRecord = page.getByRole("tabpanel", { name: "원본 기록" });
  await editableRecord.getByRole("tab", { name: /현재 기록/ }).click();
  await expect(editableRecord.getByRole("button", { name: "변경사항 비교" })).toBeVisible();

  const recommendation = returnSummary.getByRole("textbox", { name: "간호사가 확인할 후속 항목" });
  const sourceConfirmation = returnSummary.getByRole("checkbox", { name: "원본 기록을 확인했습니다" });
  await recommendation.fill("다음 교대에서 원본 기록을 다시 확인합니다.");
  await sourceConfirmation.check();
  await expect(returnSummary.getByRole("button", { name: "검토 완료" })).toBeEnabled();

  await editableRecord.getByRole("spinbutton", { name: "체온" }).fill("39.1");
  await editableRecord.getByRole("button", { name: "변경사항 비교" }).click();

  const submittedPeriodRequest = await secondPeriodRequestSeen;
  expect(secondPeriodRequest.current).toBe(submittedPeriodRequest);
  expect(submittedPeriodRequest.reviewStartAt).toBe(ready.period.requestedStartAt);
  expect(submittedPeriodRequest.records).toHaveLength(ready.period.snapshotCount);
  expect(submittedPeriodRequest.records?.every((record) => record.patient_id === ready.patient.id)).toBe(true);
  const submittedCurrent = submittedPeriodRequest.records?.at(-1);
  expect(submittedCurrent?.patient_id).toBe(ready.patient.id);
  expect(submittedCurrent?.updated_at).toBe(ready.period.currentRecordedAt);
  expect((submittedCurrent?.vitals as Record<string, unknown> | undefined)?.body_temperature).toBe(39.1);

  await expect(page.getByRole("status", { name: "기간 비교 상태" })).toContainText("불러오는 중");
  await expect(page.getByRole("tab", { name: "변화 근거" })).toHaveAttribute("aria-selected", "true");
  await expect(recommendation).toHaveValue("다음 교대에서 원본 기록을 다시 확인합니다.");
  await expect(recommendation).toBeDisabled();
  await expect(sourceConfirmation).toBeChecked();
  await expect(sourceConfirmation).toBeDisabled();
  await expect(returnSummary.getByRole("button", { name: "검토 완료" })).toBeDisabled();

  recomparisonRelease.current?.();
  await expect(page.getByText(readySituation, { exact: true })).toBeVisible();
  await expect(recommendation).toHaveValue("");
  await expect(sourceConfirmation).not.toBeChecked();
  await expect(returnSummary.getByRole("button", { name: "검토 완료" })).toBeDisabled();

  await sourceConfirmation.check();
  await returnSummary.getByRole("button", { name: "검토 완료" }).click();
  await expect(returnSummary.getByRole("button", { name: "검토 완료" })).toBeDisabled();
  await expect(p001Patient(page).getByText("검토 완료", { exact: true })).toBeVisible();
});

test("shift readiness P001 follows the task-first evidence journey and retains acknowledgement", async ({ page }) => {
  await mockP001ReturnApi(page);
  await mockShiftReadinessApi(page);
  await page.goto("/");
  await p001Patient(page).click();

  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  await expect(page.getByRole("tab", { name: "근무 준비", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /환자 상태/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /검사·결과/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Line·Device/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /투약 변경/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /보고·확인/ })).toBeVisible();

  const readiness = page.getByTestId("shift-readiness-workspace");
  await expect(readiness.getByTestId("shift-readiness-item-title").filter({ hasText: "CBC 결과 확인" })).toBeVisible();
  await expect(readiness.getByTestId("shift-readiness-item-title").filter({ hasText: "Chest AP 일정 확인" })).toBeVisible();
  await expect(readiness.getByTestId("shift-readiness-item-title").filter({ hasText: "말초정맥관 일정 확인" })).toBeVisible();
  await expect(readiness.getByTestId("shift-readiness-item-title").filter({ hasText: "타세놀정 500mg 적용 시점" })).toBeVisible();
  await expect(readiness.getByTestId("shift-readiness-item-title").filter({ hasText: "회진 전 발열 경과 전달" })).toBeVisible();

  const cbcRow = readiness.locator(".shift-readiness-item").filter({ hasText: "CBC 결과 확인" });
  const cbcAcknowledgement = cbcRow.getByRole("checkbox", { name: "CBC 결과 확인 확인함" });
  await cbcAcknowledgement.check();
  await expect(cbcAcknowledgement).toBeChecked();
  await expect(page.getByTestId("shift-readiness-summary-panel").getByText("1/7", { exact: true })).toBeVisible();
  await expect(p001Patient(page)).toContainText("확인 1/7");

  const cbcEvidence = cbcRow.getByRole("button", { name: /근거 보기/ });
  await cbcEvidence.click();
  const recordPanel = page.getByRole("tabpanel", { name: "원본 기록" });
  await expect(recordPanel).toBeVisible();
  await expect(recordPanel.getByText("CBC", { exact: true })).toBeVisible();
  const cbcSource = recordPanel.locator('[data-source-path="investigations[id=INV-P001-CBC]"]');
  await expect(cbcSource).toHaveAttribute("data-evidence-active", "true");
  await expect(cbcSource.getByText("WBC 12.1 ×10³/μL", { exact: true })).toBeVisible();
  await expect(recordPanel.locator(".record-source-interval time").nth(1)).toHaveText("2026-07-02T09:00:00+09:00");
  await recordPanel.getByRole("tab", { name: /현재 기록/ }).click();
  await expect(recordPanel.getByText("선택 사건의 현재 snapshot", { exact: true })).toBeVisible();
  await expect(recordPanel.locator(".record-chart-time").last().getByText("2026-07-02T09:00:00+09:00", { exact: true })).toBeVisible();
  await expect(recordPanel.getByText("READ ONLY", { exact: true }).first()).toBeVisible();
  await recordPanel.getByRole("button", { name: "비교로 돌아가기" }).click();
  await expect(cbcEvidence).toBeFocused();

  await page.getByRole("tab", { name: "변화 근거", exact: true }).click();
  await expect(page.getByRole("tab", { name: "변화 근거", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("return-comparison-workspace")).toBeVisible();
  await expect(page.getByTestId("return-summary-panel").getByText("24/24", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "근무 준비", exact: true }).click();
  await expect(page.getByRole("tab", { name: "근무 준비", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(readiness).toBeVisible();
  await expect(cbcAcknowledgement).toBeChecked();
  await expect(page.getByTestId("shift-readiness-summary-panel").getByText("1/7", { exact: true })).toBeVisible();
});

const readinessStateCases = [
  {
    state: "no_baseline" as const,
    workspaceCopy: "기준 기록 없음",
    summaryCopy: "기준 기록 없음",
  },
  {
    state: "no_items" as const,
    workspaceCopy: "이번 근무에 표시할 항목 없음",
    summaryCopy: "이번 근무에 표시할 항목 없음",
  },
  {
    state: "partial" as const,
    workspaceCopy: "부분 결과",
    summaryCopy: "부분 결과",
  },
] as const;

for (const { state, workspaceCopy, summaryCopy } of readinessStateCases) {
  test(`shift readiness announces the ${state} state distinctly while period evidence stays available`, async ({ page }) => {
    await mockP001ReturnApi(page);
    await mockShiftReadinessApi(page, state);
    await page.goto("/");
    await p001Patient(page).click();
    await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();

    const readiness = page.getByTestId("shift-readiness-workspace");
    const summary = page.getByTestId("shift-readiness-summary-panel");
    await expect(readiness.locator(".shift-readiness-status").filter({ hasText: workspaceCopy })).toBeVisible();
    await expect(summary.locator(".shift-readiness-summary-status").filter({ hasText: summaryCopy })).toBeVisible();
    await expect(readiness.locator("[aria-live]")).toHaveCount(1);
    await expect(summary.locator("[aria-live]")).toHaveCount(1);
    if (state === "partial") {
      await expect(readiness.locator(".shift-readiness-status")).toContainText("명시된 데이터 공백");
      await expect(summary.locator(".shift-readiness-summary-status")).toContainText("명시된 데이터 공백");
    }
    if (state === "no_items") {
      await expect(readiness.locator(".shift-readiness-item")).toHaveCount(0);
      await expect(readiness.locator(".shift-readiness-domain-empty")).toHaveCount(5);
      await expect(summary.getByRole("heading", { name: "표시 항목 없음", exact: true })).toBeVisible();
      await expect(summary.getByText("이번 근무에 표시 규칙에 해당하는 항목이 없습니다.", { exact: true })).toBeVisible();
      await expect(summary.getByText("0/0", { exact: true })).toHaveCount(0);
      await expect(summary.getByText("확인함", { exact: true })).toHaveCount(0);
      await expect(summary.getByText("미확인 0건", { exact: true })).toHaveCount(0);
      await expect(summary.locator(".shift-readiness-summary-progress-track")).toHaveCount(0);
    }

    const comparisonTab = page.getByRole("tab", { name: "변화 근거", exact: true });
    await expect(comparisonTab).toBeEnabled();
    await comparisonTab.click();
    await expect(page.getByTestId("return-comparison-workspace")).toBeVisible();
    await expect(page.getByTestId("return-summary-panel").getByText("24/24", { exact: true })).toBeVisible();
  });
}

test("shift readiness isolates a failed P002 retry and retains exact-key P001 review state", async ({ page }) => {
  await mockP001ReturnApi(page);
  const requestCountByPatient = new Map<string, number>();
  await page.route("**/api/handover/shift-readiness", async (route) => {
    const body = parseShiftReadinessRequest(route.request());
    const patientId = body.records[0]?.patient_id as string;
    const count = (requestCountByPatient.get(patientId) ?? 0) + 1;
    requestCountByPatient.set(patientId, count);
    if (patientId === "P002" && count === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "readiness unavailable" }) });
      return;
    }
    const response = readinessFixtureForRequest(body);
    if (patientId !== "P001" && response.items[0]) {
      response.items[0] = { ...response.items[0], title: `${patientId} 전용 준비 항목` };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });

  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  const readiness = page.getByTestId("shift-readiness-workspace");
  await expect(readiness).toHaveAttribute("data-shift-readiness-status", "available");
  const p001CbcRow = readiness.locator(".shift-readiness-item").filter({ hasText: "CBC 결과 확인" });
  const p001CbcAcknowledgement = p001CbcRow.getByRole("checkbox", { name: "CBC 결과 확인 확인함" });
  await p001CbcAcknowledgement.check();
  const readinessNote = page.getByTestId("shift-readiness-summary-panel").getByRole("textbox", { name: "인계 메모" });
  await readinessNote.fill("P001 교대 전 확인 메모");
  await expect(p001CbcAcknowledgement).toBeChecked();
  await expect(readinessNote).toHaveValue("P001 교대 전 확인 메모");

  const p002Patient = page.getByRole("button", { name: /김영희, P002, 302호/ });
  await p002Patient.click();
  await expect(p002Patient).toHaveAttribute("aria-current", "true");
  await expect(readiness.getByRole("alert", { name: "근무 준비 오류" })).toContainText("근무 준비 정보를 불러오지 못했습니다.");
  await expect(readiness.getByText("CBC 결과 확인", { exact: true })).toHaveCount(0);
  await expect(readiness.locator(".shift-readiness-item")).toHaveCount(0);
  await expect(readiness.locator("[aria-live]")).toHaveCount(1);
  await expect(readiness.locator("[aria-live]")).toHaveAttribute("role", "alert");
  await expect(readiness.getByRole("button", { name: "검토 완료" })).toHaveCount(0);

  await expect(page.getByRole("tab", { name: "변화 근거", exact: true })).toBeEnabled();
  await expect(readiness.getByRole("button", { name: "다시 시도" })).toBeVisible();

  await readiness.getByRole("button", { name: "다시 시도" }).click();
  await expect(readiness.getByText("P002 전용 준비 항목", { exact: true })).toBeVisible();
  await expect(readiness).toHaveAttribute("data-shift-readiness-status", "available");
  await expect(readiness.getByText("CBC 결과 확인", { exact: true })).toHaveCount(0);

  await p001Patient(page).click();
  await expect(p001Patient(page)).toHaveAttribute("aria-current", "true");
  await expect(readiness.getByText("CBC 결과 확인", { exact: true })).toBeVisible();
  await expect(p001CbcAcknowledgement).toBeChecked();
  await expect(readinessNote).toHaveValue("P001 교대 전 확인 메모");

  await page.getByRole("tab", { name: "변화 근거", exact: true }).click();
  await expect(page.getByTestId("return-summary-panel").getByText("24/24", { exact: true })).toBeVisible();
});

test("shift readiness rejects malformed responses without hiding the period tab", async ({ page }) => {
  await mockP001ReturnApi(page);
  await page.route("**/api/handover/shift-readiness", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "available" }) });
  });

  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  const readiness = page.getByTestId("shift-readiness-workspace");
  await expect(readiness.getByRole("alert", { name: "근무 준비 오류" })).toContainText("근무 준비 정보를 불러오지 못했습니다.");
  await expect(readiness.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "변화 근거", exact: true })).toBeEnabled();
  await page.getByRole("tab", { name: "변화 근거", exact: true }).click();
  await expect(page.getByTestId("return-summary-panel").getByText("24/24", { exact: true })).toBeVisible();
});

test("shift readiness isolates a slow P001 response from a faster P002 selection", async ({ page }) => {
  await mockP001ReturnApi(page);
  const p001Gate = { resolve: null as (() => void) | null };
  const p001Held = new Promise<void>((resolve) => { p001Gate.resolve = resolve; });
  const p001Seen = new Promise<void>((resolve) => {
    void page.waitForRequest((request) => {
      const postData = request.postData() ?? "";
      return request.url().includes("/api/handover/shift-readiness") && postData.includes('"P001"');
    }).then(() => resolve());
  });
  await page.route("**/api/handover/shift-readiness", async (route) => {
    const body = parseShiftReadinessRequest(route.request());
    const patientId = body.records[0]?.patient_id as string;
    const response = readinessFixtureForRequest(body);
    response.items[0] = { ...response.items[0]!, title: `${patientId} 전용 준비 항목` };
    if (patientId === "P001") {
      await p001Seen;
      await p001Held;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });

  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  await p001Seen;
  const p001Readiness = page.getByTestId("shift-readiness-workspace");
  await expect(p001Readiness).toHaveAttribute("data-shift-readiness-status", "loading");
  await expect(p001Readiness.locator("[aria-live]")).toHaveCount(1);
  await expect(p001Readiness.locator("[aria-live]")).toHaveAttribute("role", "status");

  const p002Patient = page.getByRole("button", { name: /김영희, P002, 302호/ });
  await p002Patient.click();
  const readiness = page.getByTestId("shift-readiness-workspace");
  await expect(page.getByRole("heading", { name: "김영희", exact: true })).toBeVisible();
  await expect(readiness.getByText("P002 전용 준비 항목", { exact: true })).toBeVisible();

  p001Gate.resolve?.();
  await expect(readiness.getByText("P002 전용 준비 항목", { exact: true })).toBeVisible();
  await expect(readiness.getByText("P001 전용 준비 항목", { exact: true })).toHaveCount(0);
});

test("shift readiness fails closed for a missing direct source and restores its trigger focus", async ({ page }) => {
  await mockP001ReturnApi(page);
  await page.route("**/api/handover/shift-readiness", async (route) => {
    const body = parseShiftReadinessRequest(route.request());
    const response = readinessFixtureForRequest(body);
    if (body.records[0]?.patient_id === "P001") {
      const cbc = response.items.find((item) => item.title === "CBC 결과 확인");
      if (!cbc) throw new Error("CBC readiness item is unavailable.");
      cbc.sourceRefs = cbc.sourceRefs.map((source) => ({ ...source, path: "investigations[id=INV-P001-MISSING]" }));
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });

  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  const readiness = page.getByTestId("shift-readiness-workspace");
  const cbcRow = readiness.locator(".shift-readiness-item").filter({ hasText: "CBC 결과 확인" });
  const evidence = cbcRow.getByRole("button", { name: /근거 보기/ });
  await evidence.click();
  await expect(readiness.getByRole("alert", { name: "근무 준비 오류" })).toContainText("근거를 찾을 수 없습니다");
  await expect(readiness).toBeVisible();
  await expect(evidence).toBeFocused();
  await expect(page.getByRole("tab", { name: "변화 근거", exact: true })).toBeEnabled();
});

test("shift readiness mode tabs, quick links, and keyboard evidence focus are accessible", async ({ page }) => {
  await mockP001ReturnApi(page);
  await mockShiftReadinessApi(page);
  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();

  const modeTablist = page.getByRole("tablist", { name: "환자 기록 모듈" });
  const readinessTab = modeTablist.getByRole("tab", { name: "근무 준비", exact: true });
  const comparisonTab = modeTablist.getByRole("tab", { name: "변화 근거", exact: true });
  const recordTab = modeTablist.getByRole("tab", { name: "원본 기록", exact: true });
  await readinessTab.focus();
  await readinessTab.press("ArrowRight");
  await expect(comparisonTab).toHaveAttribute("aria-selected", "true");
  await expect(comparisonTab).toBeFocused();
  await comparisonTab.press("ArrowRight");
  await expect(recordTab).toHaveAttribute("aria-selected", "true");
  await expect(recordTab).toBeFocused();
  await readinessTab.press("End");
  await expect(recordTab).toHaveAttribute("aria-selected", "true");
  await expect(recordTab).toBeFocused();
  await recordTab.press("Home");
  await expect(readinessTab).toHaveAttribute("aria-selected", "true");
  await expect(readinessTab).toBeFocused();

  const readiness = page.getByTestId("shift-readiness-workspace");
  const cbcItem = readiness.locator(".shift-readiness-item").filter({ hasText: "CBC 결과 확인" });
  const cbcTitle = cbcItem.getByTestId("shift-readiness-item-title");
  const cbcCheckbox = cbcItem.getByRole("checkbox");

  const quickLink = page.getByTestId("shift-readiness-summary-panel").getByRole("button", { name: /CBC 결과 확인/ }).first();
  await quickLink.click();
  await expect(cbcTitle).toBeVisible();
  await expect(page.locator("#shift-readiness-item-P001-investigation-CBC-new-result")).toBeFocused();

  await cbcCheckbox.focus();
  await cbcCheckbox.press("Space");
  await expect(cbcCheckbox).toBeChecked();
  await expect(cbcCheckbox).toBeFocused();
  await expect(cbcCheckbox.evaluate((element) => element.matches(":focus-visible"))).resolves.toBe(true);

  const cbcEvidence = cbcItem.getByRole("button", { name: /근거 보기/ });
  await cbcEvidence.focus();
  await cbcEvidence.press("Enter");
  const recordPanel = page.getByRole("tabpanel", { name: "원본 기록" });
  await expect(recordPanel).toBeVisible();
  await recordPanel.getByRole("button", { name: "비교로 돌아가기" }).press("Enter");
  await expect(cbcEvidence).toBeFocused();

  const domainRegions = readiness.locator(".shift-readiness-domain[role=region]");
  await expect(domainRegions).toHaveCount(5);
  const relationships = await domainRegions.evaluateAll((regions) => regions.map((region) => {
    const labelledBy = region.getAttribute("aria-labelledby");
    const heading = labelledBy ? document.getElementById(labelledBy) : null;
    return { labelledBy, headingText: heading?.textContent?.trim() ?? "" };
  }));
  expect(relationships.map(({ headingText }) => headingText)).toEqual(["환자 상태", "검사·결과", "Line·Device", "투약 변경", "보고·확인"]);
  await expect(readiness.locator('[data-fact-status-label="new_result"]').first()).toHaveText("새 결과 있음");
  await expect(readiness.locator('[aria-label="사실 상태: 새 결과 있음"]').first()).toBeVisible();
});

test("shift readiness uses a dense clinical hierarchy with visible fact-status treatment", async ({ page }) => {
  await mockP001ReturnApi(page);
  await mockShiftReadinessApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  const readiness = page.getByTestId("shift-readiness-workspace");
  await expect(readiness.getByRole("heading", { name: "근무 준비" })).toBeVisible();

  const visualMetrics = await page.evaluate(() => {
    const domains = Array.from(document.querySelectorAll<HTMLElement>(".shift-readiness-domain"));
    const statuses = Array.from(document.querySelectorAll<HTMLElement>(".shift-readiness-fact-status"));
    const header = document.querySelector<HTMLElement>(".shift-readiness-workspace-header h2");
    const itemList = document.querySelector<HTMLElement>(".shift-readiness-item-list");
    if (!domains.length || !statuses.length || !header || !itemList) throw new Error("근무 준비 시각 계층 대상이 없습니다.");
    return {
      domainBorders: domains.map((domain) => Number.parseFloat(getComputedStyle(domain).borderLeftWidth)),
      domainBackgrounds: domains.map((domain) => getComputedStyle(domain).backgroundColor),
      statusBackgrounds: statuses.map((status) => getComputedStyle(status).backgroundColor),
      titleSize: Number.parseFloat(getComputedStyle(header).fontSize),
      itemListGap: getComputedStyle(itemList).rowGap,
    };
  });

  expect(visualMetrics.domainBorders.every((value) => value >= 3)).toBe(true);
  expect(new Set(visualMetrics.domainBackgrounds).size).toBeGreaterThanOrEqual(2);
  expect(visualMetrics.statusBackgrounds.every((value) => value !== "rgba(0, 0, 0, 0)")).toBe(true);
  expect(visualMetrics.titleSize).toBeGreaterThanOrEqual(22);
  expect(Number.parseFloat(visualMetrics.itemListGap)).toBeLessThanOrEqual(12);
});

const readinessViewportMatrix = [390, 960, 1019, 1024, 1279, 1440, 1600, 2544] as const;

for (const viewportWidth of readinessViewportMatrix) {
  test(`shift readiness viewport ${viewportWidth}px keeps clinical text and rails contained`, async ({ page }) => {
    await mockP001ReturnApi(page);
    await mockShiftReadinessApi(page);
    await page.setViewportSize({ width: viewportWidth, height: viewportWidth === 390 ? 844 : 900 });
    await page.goto("/");
    await p001Patient(page).click();
    await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();

    const readiness = page.getByTestId("shift-readiness-workspace");
    const clinicalText = readiness.getByTestId("shift-readiness-item-title").first();
    const evidenceButton = readiness.getByRole("button", { name: /근거 보기/ }).first();
    await expect(clinicalText).toBeVisible();
    await expect(evidenceButton).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await clinicalText.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
    expect(await evidenceButton.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);

    const metrics = await page.evaluate(() => {
      const elements = [
        document.querySelector<HTMLElement>(".patient-queue"),
        document.querySelector<HTMLElement>(".comparison-workspace"),
        document.querySelector<HTMLElement>(".shift-readiness-summary-panel"),
      ];
      if (elements.some((element) => !element)) throw new Error("근무 준비 레일을 찾을 수 없습니다.");
      const overflow = (element: HTMLElement) => element.scrollWidth - element.clientWidth;
      const center = elements[1]!;
      const summary = elements[2]!;
      const firstItem = document.querySelector<HTMLElement>(".shift-readiness-item");
      const acknowledgement = firstItem?.querySelector<HTMLElement>(".shift-readiness-acknowledgement");
      const evidence = firstItem?.querySelector<HTMLElement>(".shift-readiness-evidence");
      const centerRect = center.getBoundingClientRect();
      const summaryRect = summary.getBoundingClientRect();
      const readinessDescendants = Array.from(document.querySelectorAll<HTMLElement>(
        ".shift-readiness-item, .shift-readiness-item *",
      )).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: element.className,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      });
      return {
        railOverflow: elements.map((element) => overflow(element!)),
        centerRight: center.getBoundingClientRect().right,
        summaryLeft: summary.getBoundingClientRect().left,
        centerLeft: centerRect.left,
        summaryRight: summaryRect.right,
        queueWidth: elements[0]!.getBoundingClientRect().width,
        summaryWidth: summary.getBoundingClientRect().width,
        pairedActions: Boolean(acknowledgement && evidence && Math.abs(evidence.getBoundingClientRect().top - acknowledgement.getBoundingClientRect().top) <= 1),
        actionOverflow: firstItem ? overflow(firstItem) : 999,
        readinessDescendants,
      };
    });
    for (const railOverflow of metrics.railOverflow) expect(railOverflow).toBeLessThanOrEqual(1);
    if (viewportWidth >= 960 && viewportWidth <= 1019) {
      expect(metrics.centerRight).toBeLessThanOrEqual(metrics.summaryLeft + 1);
      for (const descendant of metrics.readinessDescendants) {
        expect(descendant.left, `${viewportWidth}px ${descendant.selector} left edge`).toBeGreaterThanOrEqual(metrics.centerLeft - 1);
        expect(descendant.right, `${viewportWidth}px ${descendant.selector} right edge`).toBeLessThanOrEqual(metrics.centerRight + 1);
        expect(descendant.right, `${viewportWidth}px ${descendant.selector} before summary rail`).toBeLessThanOrEqual(metrics.summaryLeft + 1);
        expect(descendant.scrollWidth - descendant.clientWidth, `${viewportWidth}px ${descendant.selector} descendant overflow`).toBeLessThanOrEqual(1);
      }
    }
    if (viewportWidth === 390) {
      expect(metrics.pairedActions).toBe(true);
      expect(metrics.actionOverflow).toBeLessThanOrEqual(1);
    }
    if (viewportWidth >= 1600) {
      expect(Math.round(metrics.queueWidth)).toBe(304);
      expect(Math.round(metrics.summaryWidth)).toBe(400);
    }
  });
}

test("shift readiness mobile order keeps the board before its summary rail", async ({ page }) => {
  await mockP001ReturnApi(page);
  await mockShiftReadinessApi(page);
  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  await expect(page.getByTestId("shift-readiness-workspace")).toBeVisible();

  for (const width of [390, 959] as const) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const positions = await page.evaluate(() => {
      const queue = document.querySelector<HTMLElement>(".patient-queue");
      const center = document.querySelector<HTMLElement>(".comparison-workspace");
      const summary = document.querySelector<HTMLElement>(".shift-readiness-summary-panel");
      if (!queue || !center || !summary) throw new Error("모바일 근무 준비 순서 대상을 찾을 수 없습니다.");
      return {
        queueTop: queue.getBoundingClientRect().top,
        centerTop: center.getBoundingClientRect().top,
        summaryTop: summary.getBoundingClientRect().top,
      };
    });
    expect(positions.queueTop, `${width}px queue should be first`).toBeLessThanOrEqual(positions.centerTop);
    expect(positions.centerTop, `${width}px board should precede summary`).toBeLessThan(positions.summaryTop);
  }
});

test("shift readiness narrow item rows pair time with status and acknowledgement with evidence", async ({ page }) => {
  await mockP001ReturnApi(page);
  await mockShiftReadinessApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();

  const item = page.getByTestId("shift-readiness-workspace").locator(".shift-readiness-item").first();
  const layout = await item.evaluate((element) => {
    const child = (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector);
      if (!target) throw new Error(`근무 준비 행의 ${selector} 대상이 없습니다.`);
      const rect = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      return {
        area: style.gridArea,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        scrollWidth: target.scrollWidth,
        clientWidth: target.clientWidth,
      };
    };
    return {
      time: child(".shift-readiness-item-time-block"),
      status: child(".shift-readiness-fact-status"),
      content: child(".shift-readiness-item-content"),
      acknowledgement: child(".shift-readiness-acknowledgement"),
      evidence: child(".shift-readiness-evidence"),
      itemScrollWidth: element.scrollWidth,
      itemClientWidth: element.clientWidth,
    };
  });

  expect(layout.time.area).toBe("time");
  expect(layout.status.area).toBe("status");
  expect(layout.content.area).toBe("content");
  expect(layout.acknowledgement.area).toBe("ack");
  expect(layout.evidence.area).toBe("evidence");
  expect(Math.abs(layout.time.top - layout.status.top)).toBeLessThanOrEqual(1);
  expect(layout.content.top).toBeGreaterThanOrEqual(layout.time.bottom - 1);
  expect(Math.abs(layout.acknowledgement.top - layout.evidence.top)).toBeLessThanOrEqual(1);
  expect(layout.itemScrollWidth - layout.itemClientWidth).toBeLessThanOrEqual(1);
  for (const [name, metrics] of Object.entries(layout)) {
    if (typeof metrics === "object" && metrics !== null && "scrollWidth" in metrics && "clientWidth" in metrics) {
      expect(metrics.scrollWidth - metrics.clientWidth, `${name} overflow`).toBeLessThanOrEqual(1);
    }
  }
});

const returnViewportMatrix = [
  { width: 2544, height: 1258 },
  { width: 1600, height: 1000 },
  { width: 1440, height: 900 },
  { width: 1279, height: 900 },
  { width: 1024, height: 768 },
  { width: 960, height: 768 },
  { width: 390, height: 844 },
] as const;

for (const viewport of returnViewportMatrix) {
  test(`return handover viewport ${viewport.width}x${viewport.height} stays readable and contained`, async ({ page }) => {
    await mockP001ReturnApi(page);
    await mockShiftReadinessApi(page);
    const ready = cloneP001ReturnFixture("ready");
    await page.setViewportSize(viewport);
    await page.goto("/");
    await p001Patient(page).click();
    await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
    await page.getByRole("tab", { name: "변화 근거", exact: true }).click();
    await expect(page.getByText(ready.summary.sections.situation[0]!.text, { exact: true })).toBeVisible();
    const evidenceDisclosure = page.getByTestId("return-summary-panel").locator("details.return-summary-evidence-disclosure").first();
    await expect(evidenceDisclosure).toBeVisible();
    await evidenceDisclosure.getByRole("button").click();

    const metrics = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".workspace-shell");
      const queue = document.querySelector<HTMLElement>(".patient-queue");
      const center = document.querySelector<HTMLElement>(".comparison-workspace");
      const summary = document.querySelector<HTMLElement>(".return-handover-summary");
      const eventChanges = Array.from(document.querySelectorAll<HTMLElement>(".return-event-change"));
      const eventList = document.querySelector<HTMLElement>(".return-event-list");
      const returnSections = document.querySelector<HTMLElement>(".return-clinical-sections");
      if (!shell || !queue || !center || !summary || !eventChanges.length || !eventList || !returnSections) {
        throw new Error("복귀 인계 반응형 측정 대상이 없습니다.");
      }
      const overflow = (element: HTMLElement) => element.scrollWidth - element.clientWidth;
      const isVisible = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const centerRect = center.getBoundingClientRect();
      const summaryRect = summary.getBoundingClientRect();
      const sectionRect = returnSections.getBoundingClientRect();
      const evidenceControls = Array.from(document.querySelectorAll<HTMLElement>(
        ".return-evidence-button, .return-summary-evidence-link, .return-summary-evidence-toggle, .return-summary-evidence-disclosure > summary",
      )).filter(isVisible);
      const bodyTextElements = Array.from(document.querySelectorAll<HTMLElement>(
        ".return-event-time, .return-event-category, .return-event-status, .return-event-main, .return-event-value strong, .return-summary-section p, .return-summary-metric > span, .return-summary-integrity p",
      ));
      return {
        pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
        railOverflow: [overflow(queue), overflow(center), overflow(summary)],
        queueWidth: queue.getBoundingClientRect().width,
        summaryWidth: summaryRect.width,
        centerWidth: centerRect.width,
        centerRight: centerRect.right,
        summaryLeft: summaryRect.left,
        eventListWidth: eventList.getBoundingClientRect().width,
        sectionWidth: sectionRect.width,
        eventValueColumns: eventChanges.map((eventChange) => getComputedStyle(eventChange).gridTemplateColumns.trim().split(/\s+/).length),
        eventChangeOverflows: eventChanges.map(overflow),
        evidenceHeights: evidenceControls.map((element) => element.getBoundingClientRect().height),
        evidenceFonts: evidenceControls.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
        bodyFonts: bodyTextElements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
      };
    });

    expect(metrics.pageOverflow).toBeLessThanOrEqual(1);
    for (const railOverflow of metrics.railOverflow) expect(railOverflow).toBeLessThanOrEqual(1);
    for (const fontSize of metrics.evidenceFonts) expect(fontSize).toBeGreaterThanOrEqual(11);
    for (const height of metrics.evidenceHeights) expect(height).toBeGreaterThanOrEqual(30);
    for (const fontSize of metrics.bodyFonts) expect(fontSize).toBeGreaterThanOrEqual(11);

    if (viewport.width >= 1600) {
      expect(Math.round(metrics.queueWidth)).toBe(304);
      expect(Math.round(metrics.summaryWidth)).toBe(400);
    }
    if (viewport.width >= 1440) {
      expect(metrics.eventListWidth / metrics.sectionWidth).toBeGreaterThanOrEqual(0.9);
    }
    if (viewport.width >= 960 && viewport.width <= 1279) {
      expect(metrics.centerRight).toBeLessThanOrEqual(metrics.summaryLeft + 1);
    }
    if (viewport.width === 390) {
      expect(metrics.eventValueColumns.length).toBe(24);
      expect(metrics.eventValueColumns.every((columnCount) => columnCount === 1)).toBe(true);
      expect(metrics.eventChangeOverflows.every((value) => value <= 1)).toBe(true);
    }
  });
}

test("return handover hierarchy separates group surfaces and SBAR blocks across desktop and narrow viewports", async ({ page }) => {
  await mockP001ReturnApi(page);
  await mockShiftReadinessApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  await page.getByRole("tab", { name: "변화 근거", exact: true }).click();
  await expect(page.getByRole("heading", { name: "복귀 기간 변화" })).toBeVisible();

  const desktopMetrics = await page.evaluate(() => {
    const groups = Array.from(document.querySelectorAll<HTMLElement>("[data-review-group]"));
    const firstEventTitle = document.querySelector<HTMLElement>("[data-review-group] .return-event-main h3");
    if (groups.length !== 4 || !firstEventTitle) throw new Error("복귀 계층 측정 대상이 없습니다.");
    const groupHeadings = groups.map((group) => group.querySelector<HTMLElement>(".return-section-heading h2"));
    if (groupHeadings.some((heading) => !heading)) throw new Error("복귀 그룹 제목이 없습니다.");
    const styleOf = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        borderLeftWidth: style.borderLeftWidth,
        borderLeftStyle: style.borderLeftStyle,
        headingSize: Number.parseFloat(style.fontSize),
      };
    };
    const sbarBlocks = Array.from(document.querySelectorAll<HTMLElement>("[data-summary-section]"));
    return {
      groupStyles: groups.map(styleOf),
      groupHeadingSizes: groupHeadings.map((heading) => Number.parseFloat(getComputedStyle(heading!).fontSize)),
      eventTitleSize: Number.parseFloat(getComputedStyle(firstEventTitle).fontSize),
      sbarBoundaries: sbarBlocks.map((block) => {
        const style = getComputedStyle(block);
        return { border: style.borderLeftWidth, background: style.backgroundColor };
      }),
      count: sbarBlocks.length,
    };
  });

  expect(desktopMetrics.groupStyles).toHaveLength(4);
  expect(new Set(desktopMetrics.groupStyles.map(({ background }) => background)).size).toBeGreaterThanOrEqual(3);
  expect(desktopMetrics.groupStyles.every(({ borderLeftWidth, borderLeftStyle }) => borderLeftStyle !== "none" && Number.parseFloat(borderLeftWidth) >= 3)).toBe(true);
  expect(Math.min(...desktopMetrics.groupHeadingSizes)).toBeGreaterThanOrEqual(desktopMetrics.eventTitleSize + 3);
  expect(desktopMetrics.count).toBe(4);
  expect(desktopMetrics.sbarBoundaries.every(({ border, background }) => Number.parseFloat(border) >= 1 && background !== "rgba(0, 0, 0, 0)")).toBe(true);

  for (const width of [1024, 390] as const) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    expect(overflow, `${width}px hierarchy overflow`).toBeLessThanOrEqual(1);
  }
});

test("return handover exposes keyboard scope, landmarks, text status, and exact evidence focus return", async ({ page }) => {
  await mockP001ReturnApi(page);
  await mockShiftReadinessApi(page);
  const ready = cloneP001ReturnFixture("ready");
  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  await page.getByRole("tab", { name: "변화 근거", exact: true }).click();
  await expect(page.getByText(ready.summary.sections.situation[0]!.text, { exact: true })).toBeVisible();

  const scopeTablist = page.getByRole("tablist", { name: "인수인계 범위" });
  const shiftScopeTab = scopeTablist.getByRole("tab", { name: "직전 교대", exact: true });
  const returnScopeTab = scopeTablist.getByRole("tab", { name: "휴무 복귀", exact: true });
  await expect(scopeTablist).toBeVisible();
  await expect(page.getByRole("combobox", { name: "마지막 근무 시각" })).toBeVisible();
  await expect(page.getByText(/실제 기록 기준/)).toBeVisible();

  await shiftScopeTab.click();
  await shiftScopeTab.press("ArrowRight");
  await expect(returnScopeTab).toHaveAttribute("aria-selected", "true");
  await expect(returnScopeTab).toBeFocused();
  await returnScopeTab.press("ArrowLeft");
  await expect(shiftScopeTab).toHaveAttribute("aria-selected", "true");
  await returnScopeTab.press("End");
  await expect(returnScopeTab).toHaveAttribute("aria-selected", "true");
  await expect(returnScopeTab).toHaveAttribute("tabindex", "0");
  await expect(shiftScopeTab).toHaveAttribute("tabindex", "-1");
  await returnScopeTab.press("Home");
  await expect(shiftScopeTab).toHaveAttribute("aria-selected", "true");
  await expect(shiftScopeTab).toHaveAttribute("tabindex", "0");
  await returnScopeTab.click();
  await page.keyboard.press("Tab");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("region", { name: "환자 컨텍스트" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "복귀 기간 변화" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "현재 확인" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "복귀 인계 검토" })).toBeVisible();

  const returnWorkspace = page.getByTestId("return-comparison-workspace");
  const centerEvidenceEvent = ready.events.find((event) => event.change.category === "medications" && event.change.changeType === "added" && event.classification === "period_only");
  if (!centerEvidenceEvent) throw new Error("P001 ready fixture has no center evidence event.");
  const centerEvidence = returnWorkspace.locator(`[data-testid="return-event-row"][data-event-id="${centerEvidenceEvent.id}"]`).getByRole("button", { name: "근거 보기" });
  await centerEvidence.focus();
  await expect(centerEvidence).toBeFocused();
  const focusMetrics = await centerEvidence.evaluate((element) => ({
    focusVisible: element.matches(":focus-visible"),
    outlineStyle: getComputedStyle(element).outlineStyle,
    outlineWidth: getComputedStyle(element).outlineWidth,
  }));
  expect(focusMetrics.focusVisible).toBe(true);
  expect(focusMetrics.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusMetrics.outlineWidth)).toBeGreaterThanOrEqual(2);

  const eventStatuses = await returnWorkspace.locator(".return-event-status").allTextContents();
  expect(eventStatuses.length).toBeGreaterThan(0);
  expect(eventStatuses.every((status) => status.trim().length > 0)).toBe(true);
  await centerEvidence.click();
  const recordPanel = page.getByRole("tabpanel", { name: "원본 기록" });
  await recordPanel.getByRole("button", { name: "비교로 돌아가기" }).click();
  await expect(centerEvidence).toBeFocused();

  const summary = page.getByRole("complementary", { name: "복귀 인계 검토" });
  const disclosure = summary.getByRole("button", { name: "근거 24건" });
  await disclosure.click();
  const railEvidence = summary.getByRole("button", { name: "근거 1", exact: true });
  await railEvidence.click();
  await page.getByRole("tabpanel", { name: "원본 기록" }).getByRole("button", { name: "비교로 돌아가기" }).click();
  await expect(railEvidence).toBeFocused();
});

const returnDomainStates = [
  {
    state: "partial" as const,
    visibleState: "부분 결과",
    announcement: "명시된 데이터 공백이 있어 확인 가능한 사건만 표시합니다.",
    retentionOnly: false,
  },
  {
    state: "no_events" as const,
    visibleState: "해당 기간에 검출된 변화가 없습니다.",
    announcement: "해당 기간에 검출된 변화가 없습니다.",
    retentionOnly: false,
  },
  {
    state: "no_baseline" as const,
    visibleState: "기준 기록 없음",
    announcement: "선택한 시각 이전의 기준 기록을 확인할 수 없습니다.",
    retentionOnly: true,
  },
];

for (const { state, visibleState, announcement, retentionOnly } of returnDomainStates) {
  test(
    retentionOnly
      ? "return handover retains the prior result when an exact no_baseline response is returned for a real option"
      : `return handover announces the ${state} domain state once with text`,
    async ({ page }) => {
    const fixture = cloneP001ReturnFixture(state);
    const ready = cloneP001ReturnFixture("ready");
    let deliveredState: ReturnResponseState | null = null;
    let deliveredStateResolve: (() => void) | null = null;
    const deliveredStatePromise = new Promise<void>((resolve) => {
      deliveredStateResolve = resolve;
    });
    await mockP001ReturnApi(
      page,
      retentionOnly ? "ready" : state,
      retentionOnly || state === "no_events"
        ? async (_body, requestIndex) => {
          if (requestIndex === 2) {
            deliveredState = state;
            deliveredStateResolve?.();
            return state;
          }
          return "ready";
        }
      : undefined,
    );
    await mockShiftReadinessApi(page);
    await page.goto("/");
    await p001Patient(page).click();
    await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
    await page.getByRole("tab", { name: "변화 근거", exact: true }).click();

    const startSelector = page.getByRole("combobox", { name: "마지막 근무 시각" });
    await expect(startSelector.locator("option")).toHaveCount(P001_RETURN_START_OPTIONS.length);
    await expect(startSelector.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).resolves.toEqual(P001_RETURN_START_OPTIONS);
    await expect(startSelector).toHaveValue(P001_RETURN_START_OPTIONS[0]!);
    expect(P001_RETURN_START_OPTIONS).toContain(await startSelector.inputValue());

    if (retentionOnly || state === "no_events") {
      await expect(page.getByText(ready.summary.sections.situation[0]!.text, { exact: true })).toBeVisible();
      const selectedStartAt = retentionOnly ? P001_RETURN_START_OPTIONS[1]! : fixture.period.requestedStartAt;
      expect(P001_RETURN_START_OPTIONS).toContain(selectedStartAt);
      if (retentionOnly) {
        expect(P001_RETURN_START_OPTIONS).not.toContain(fixture.period.requestedStartAt);
      }
      await startSelector.selectOption(selectedStartAt);
      await deliveredStatePromise;
      expect(deliveredState).toBe(state);
      await expect(startSelector).toHaveValue(selectedStartAt);
      await expect(startSelector.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).resolves.toEqual(P001_RETURN_START_OPTIONS);
    }

    if (retentionOnly) {
      await expect(page.getByText(ready.summary.sections.situation[0]!.text, { exact: true })).toBeVisible();
      await expect(page.getByText(fixture.summary.sections.situation[0]!.text, { exact: true })).toHaveCount(0);
      await expect(page.getByTestId("return-summary-panel").getByText(visibleState, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("status", { name: "기간 비교 상태" })).toHaveCount(0);
      return;
    }

    const statusAnnouncement = page.getByRole("status", { name: "기간 비교 상태" });
    await expect(statusAnnouncement).toHaveCount(1);
    await expect(statusAnnouncement).toContainText(announcement);
    await expect(page.getByText(fixture.summary.sections.situation[0]!.text, { exact: true })).toBeVisible();

    const summary = page.getByTestId("return-summary-panel");
    await expect(summary.getByText(visibleState, { exact: true })).toBeVisible();
    if (fixture.dataWarnings.length > 0) {
      await expect(summary.locator(".return-summary-warnings")).toBeVisible();
      await expect(summary.locator(".return-summary-warnings")).toContainText("추가 데이터 주의가 있습니다. 원본 기록을 확인하세요.");
    } else {
      await expect(summary.locator(".return-summary-warnings")).toHaveCount(0);
    }
    await expect(page.getByRole("alert", { name: "기간 비교 상태" })).toHaveCount(0);
    await expect(page.locator("[role=\"status\"][aria-label=\"기간 비교 상태\"]")).toHaveText(/\S/);
    },
  );
}

test("return handover keeps the fast newer period result when an older request finishes later", async ({ page }) => {
  const ready = cloneP001ReturnFixture("ready");
  const noEvents = cloneP001ReturnFixture("no_events");
  const olderRequestSeen = { resolve: null as (() => void) | null };
  const olderRequestSeenPromise = new Promise<void>((resolve) => {
    olderRequestSeen.resolve = resolve;
  });
  const olderResponseGate = { resolve: null as (() => void) | null };
  const olderResponseHeld = new Promise<void>((resolve) => {
    olderResponseGate.resolve = resolve;
  });
  const olderSettlement = { resolve: null as ((outcome: "fulfilled" | "aborted") => void) | null };
  const olderSettled = new Promise<"fulfilled" | "aborted">((resolve) => {
    olderSettlement.resolve = resolve;
  });

  await page.route("**/api/handover/period-compare", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as ReturnPeriodRequestBody;
    if (body.reviewStartAt === ready.period.requestedStartAt) {
      olderRequestSeen.resolve?.();
      await olderResponseHeld;
      try {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ready) });
        olderSettlement.resolve?.("fulfilled");
      } catch {
        olderSettlement.resolve?.("aborted");
      }
      return;
    }
    if (body.reviewStartAt === noEvents.period.requestedStartAt) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(noEvents) });
      return;
    }
    throw new Error(`Unexpected return period start ${body.reviewStartAt ?? "<missing>"}.`);
  });
  await mockShiftReadinessApi(page);

  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  await page.getByRole("tab", { name: "변화 근거", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "마지막 근무 시각" })).toHaveValue(ready.period.requestedStartAt);
  await olderRequestSeenPromise;

  const startSelector = page.getByRole("combobox", { name: "마지막 근무 시각" });
  await startSelector.selectOption(noEvents.period.requestedStartAt);
  await expect(page.getByText(noEvents.summary.sections.situation[0]!.text, { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "기간 비교 상태" })).toContainText("해당 기간에 검출된 변화가 없습니다.");

  olderResponseGate.resolve?.();
  const outcome = await olderSettled;
  expect(["fulfilled", "aborted"]).toContain(outcome);
  await expect(page.getByText(noEvents.summary.sections.situation[0]!.text, { exact: true })).toBeVisible();
  await expect(page.getByText(ready.summary.sections.situation[0]!.text, { exact: true })).toHaveCount(0);
});

test("return handover keeps the prior result and user input after a replacement failure", async ({ page }) => {
  const ready = cloneP001ReturnFixture("ready");
  let replacementFailureCount = 0;
  await page.route("**/api/handover/period-compare", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as ReturnPeriodRequestBody;
    if (body.reviewStartAt === ready.period.requestedStartAt) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ready) });
      return;
    }
    replacementFailureCount += 1;
    if (replacementFailureCount > 1) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ready) });
      return;
    }
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "period unavailable" }) });
  });
  await mockShiftReadinessApi(page);

  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
  await page.getByRole("tab", { name: "변화 근거", exact: true }).click();
  await expect(page.getByText(ready.summary.sections.situation[0]!.text, { exact: true })).toBeVisible();

  const summary = page.getByRole("complementary", { name: "복귀 인계 검토" });
  const recommendation = summary.getByRole("textbox", { name: "간호사가 확인할 후속 항목" });
  const sourceConfirmation = summary.getByRole("checkbox", { name: "원본 기록을 확인했습니다" });
  await recommendation.fill("실패 뒤에도 유지해야 하는 확인 메모");
  await sourceConfirmation.check();

  await page.getByRole("combobox", { name: "마지막 근무 시각" }).selectOption({ index: 1 });
  const errorAnnouncement = page.getByRole("alert", { name: "기간 비교 상태" });
  await expect(errorAnnouncement).toHaveCount(1);
  await expect(errorAnnouncement).toContainText("기간 비교를 불러오지 못했습니다");
  await expect(page.getByRole("status", { name: "기간 비교 상태" })).toHaveCount(0);
  await expect(page.getByText(ready.summary.sections.situation[0]!.text, { exact: true })).toBeVisible();
  await expect(recommendation).toHaveValue("실패 뒤에도 유지해야 하는 확인 메모");
  await expect(recommendation).toBeEnabled();
  await expect(sourceConfirmation).toBeChecked();
  await expect(sourceConfirmation).toBeEnabled();
  await expect(summary.getByRole("button", { name: "검토 완료" })).toBeEnabled();

  await expect(summary.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await summary.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("alert", { name: "기간 비교 상태" })).toHaveCount(0);
  await expect(page.getByText(ready.summary.sections.situation[0]!.text, { exact: true })).toBeVisible();
  await expect(recommendation).toHaveValue("실패 뒤에도 유지해야 하는 확인 메모");
  await expect(sourceConfirmation).toBeChecked();
  await expect(summary.getByRole("button", { name: "검토 완료" })).toBeEnabled();

  await summary.getByRole("button", { name: "검토 완료" }).click();
  await expect(summary.getByRole("button", { name: "검토 완료" })).toBeDisabled();
  await expect(p001Patient(page).getByText("검토 완료", { exact: true })).toBeVisible();
});

test("P001 exposes a visible before/current pair with traceable evidence", async ({ page }) => {
  await page.goto("/");

  const patient = page.getByRole("button", { name: /홍길동, P001, 301호/ });
  await expect(patient).toBeVisible();
  await patient.click();
  await expect(patient).toHaveAttribute("aria-current", "true");

  const temperature = page
    .getByTestId("change-card")
    .filter({ has: page.getByRole("heading", { name: "체온" }) });
  await expect(temperature).toBeVisible();
  await expect(temperature.getByText("이전 값", { exact: true })).toBeVisible();
  await expect(temperature.getByText("37.9", { exact: true })).toBeVisible();
  await expect(temperature.getByText("현재 값", { exact: true })).toBeVisible();
  await expect(temperature.getByText("38.2", { exact: true })).toBeVisible();
  await expect(temperature.getByTitle("vitals.body_temperature")).toBeVisible();
  const temperatureValues = temperature.getByLabel("체온 이전과 현재 값");
  await expect(temperatureValues.getByText("07/02 07:00", { exact: true })).toBeVisible();
  await expect(temperatureValues.getByText("07/02 09:00", { exact: true })).toBeVisible();
  await expect(temperature.getByText(/근거 ID · vitals-body_temperature-modified/)).toBeVisible();
});

test("summary evidence stays collapsed until requested", async ({ page }) => {
  await page.goto("/");

  const summary = page.getByRole("complementary", { name: "인계 검토" });
  const situation = summary.getByRole("region", { name: "Situation" });
  const disclosure = situation.getByRole("button", { name: "근거 9건" });
  await expect(disclosure).toBeVisible();
  const evidenceDetails = disclosure.locator("xpath=..");
  await expect(evidenceDetails).not.toHaveAttribute("open", "");
  const evidenceLink = evidenceDetails.getByRole("link", { name: /^근거 1/ });
  await expect(evidenceLink).toBeHidden();

  await disclosure.click();

  await expect(evidenceDetails).toHaveAttribute("open", "");
  await expect(evidenceLink).toBeVisible();
});

test("an expanded SBAR evidence link visibly selects the matching change", async ({ page }) => {
  await page.goto("/");

  const temperature = temperatureChange(page);
  const summary = page.getByRole("complementary", { name: "인계 검토" });
  const situation = summary.getByRole("region", { name: "Situation" });
  const disclosure = situation.getByRole("button", { name: "근거 9건" });
  await disclosure.click();
  const evidenceLink = disclosure.locator("xpath=..").locator('a[title="vitals-body_temperature-modified"]');
  await expect(evidenceLink).toBeVisible();
  await expect(evidenceLink).toHaveText("근거 3");

  await evidenceLink.click();

  await expect(temperature).toHaveAttribute("aria-current", "true");
  await expect(temperature.locator("details.evidence-details")).toHaveAttribute("open", "");
  await expect(temperature).toBeFocused();

  const sourceConfirmation = page.getByRole("checkbox", { name: "원본 기록을 확인했습니다" });
  await sourceConfirmation.click();
  await expect(sourceConfirmation).toBeFocused();

  await evidenceLink.click();

  await expect(temperature).toHaveAttribute("aria-current", "true");
  await expect(temperature).toBeFocused();
});

test("a failed comparison is not reviewed until source confirmation, then review locks the workspace", async ({ page }) => {
  await forceCompareFailure(page);
  await page.goto("/");

  const patient = p001Patient(page);
  const reviewButton = page.getByRole("button", { name: "검토 완료" });
  await expect(reviewButton).toBeDisabled();
  await expect(patient.getByText("변화 검출", { exact: true })).toBeVisible();
  await expect(patient.getByText("검토 완료", { exact: true })).not.toBeVisible();

  await expectFallbackBanner(page);
  await expect(reviewButton).toBeDisabled();

  const sourceConfirmation = page.getByRole("checkbox", { name: "원본 기록을 확인했습니다" });
  await expect(sourceConfirmation).toBeEnabled();
  await sourceConfirmation.check();
  await expect(reviewButton).toBeEnabled();

  await reviewButton.click();

  await expect(reviewButton).toBeDisabled();
  await expect(sourceConfirmation).toBeChecked();
  await expect(sourceConfirmation).toBeDisabled();
  await expect(patient.getByText("검토 완료", { exact: true })).toBeVisible();
});

test("a provider failure shows the deterministic fallback banner without hiding the demo evidence", async ({ page }) => {
  await forceCompareFailure(page, 503);
  await page.goto("/");

  const banner = await expectFallbackBanner(page);
  await expect(banner.getByText("서버 연결", { exact: true })).toBeVisible();
  await expect(page.locator(".source-tag")).toHaveText(/^(AI 요약|규칙 요약)$/);
  await expect(temperatureChange(page)).toBeVisible();
  await expect(page.getByTestId("comparison-workspace").getByText("37.9", { exact: true })).toBeVisible();
  await expect(page.getByTestId("comparison-workspace").getByText("38.2", { exact: true })).toBeVisible();
});

test("the workspace uses clinician source labels without portfolio chrome or raw medication JSON", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".source-tag")).toHaveText(/^(AI 요약|규칙 요약)$/);
  await expect(page.getByText(RETIRED_SAFETY_NOTICE, { exact: true })).toHaveCount(0);
  await expect(page.getByText(RETIRED_UTILITY_CONTEXT, { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText('{"frequency"');
});

test("applies an edited P001 temperature through the route-controlled compare workflow", async ({ page }) => {
  const [baseResponse] = buildDemoWorkspaceData();
  if (!baseResponse) throw new Error("P001 데모 응답이 없습니다.");
  const successResponse = structuredClone(baseResponse);
  successResponse.summary.sections.situation[0]!.text = "편집 비교 성공 · 체온 39.1";
  const editedTemperatureChange = successResponse.comparison.changes.find(
    (change) => change.evidence.fieldPath === "vitals.body_temperature",
  );
  if (!editedTemperatureChange) throw new Error("체온 변화 근거가 없습니다.");
  editedTemperatureChange.currentValue = 39.1;
  editedTemperatureChange.delta = 1.2;
  const editedRequestBodies: Array<{
    current: { patient_id: string; vitals: Record<string, unknown> };
  }> = [];

  await page.route("**/api/handover/compare", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      current?: { patient_id?: string; vitals?: Record<string, unknown> };
    };
    const isEditedRequest = body.current?.vitals?.body_temperature === 39.1;
    if (isEditedRequest) {
      editedRequestBodies.push({
        current: {
          patient_id: body.current?.patient_id ?? "",
          vitals: body.current?.vitals ?? {},
        },
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(isEditedRequest ? successResponse : baseResponse),
    });
  });

  await page.goto("/");
  const openButton = page.getByRole("tab", { name: "원본 기록", exact: true });
  await expect(openButton).toBeVisible();
  await openButton.click();

  const recordPanel = page.getByRole("tabpanel", { name: "원본 기록" });
  await expect(recordPanel).toBeVisible();
  await recordPanel.getByRole("tab", { name: /현재 기록/ }).click();
  await recordPanel.getByRole("spinbutton", { name: "체온" }).fill("39.1");
  await recordPanel.getByRole("button", { name: "변경사항 비교" }).click();

  await expect(page.getByText("편집 비교 성공 · 체온 39.1", { exact: true })).toBeVisible();
  const temperatureCard = temperatureChange(page);
  await expect(temperatureCard.getByText("39.1", { exact: true })).toBeVisible();
  await expect(page.getByText("편집 비교 성공 · 체온 39.1", { exact: true })).toContainText("39.1");
  await expect(recordPanel).not.toBeVisible();
  expect(editedRequestBodies.length).toBeGreaterThanOrEqual(1);
  expect(editedRequestBodies[0]?.current.patient_id).toBe("P001");
  expect(editedRequestBodies[0]?.current.vitals.body_temperature).toBe(39.1);
});

const responsiveViewports = [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

for (const viewport of responsiveViewports) {
  test(`responsive smoke at ${viewport.width}x${viewport.height} keeps the workflow reachable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const queueHeading = page.getByRole("heading", { name: "담당 환자" });
    const comparisonHeading = page.getByRole("heading", { name: "변화 검토" });
    const summaryHeading = page.getByRole("heading", { name: "인계 검토" });

    await queueHeading.scrollIntoViewIfNeeded();
    await expect(queueHeading).toBeVisible();
    await comparisonHeading.scrollIntoViewIfNeeded();
    await expect(comparisonHeading).toBeVisible();
    await summaryHeading.scrollIntoViewIfNeeded();
    await expect(summaryHeading).toBeVisible();

    const search = page.getByRole("searchbox", { name: "환자 검색" });
    await search.scrollIntoViewIfNeeded();
    await expect(search).toBeVisible();
    await expect(search).toBeEnabled();

    const patient = p001Patient(page);
    await patient.scrollIntoViewIfNeeded();
    await expect(patient).toBeVisible();
    await expect(patient).toBeEnabled();

    const reviewButton = page.getByRole("button", { name: "검토 완료" });
    await reviewButton.scrollIntoViewIfNeeded();
    await expect(reviewButton).toBeVisible();
    await expect(reviewButton).toBeDisabled();

    await expect(page.getByText(RETIRED_SAFETY_NOTICE, { exact: true })).toHaveCount(0);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const rootWidth = document.documentElement.scrollWidth;
          const bodyWidth = document.body?.scrollWidth ?? 0;
          return Math.max(rootWidth, bodyWidth) - window.innerWidth;
        }),
      )
      .toBeLessThanOrEqual(1);

    const recordButton = page.getByRole("tab", { name: "원본 기록", exact: true });
    await recordButton.scrollIntoViewIfNeeded();
    await expect(recordButton).toBeVisible();
    await recordButton.click();
    const recordPanel = page.getByRole("tabpanel", { name: "원본 기록" });
    await expect(recordPanel).toBeVisible();
    await recordPanel.getByRole("tab", { name: /현재 기록/ }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const rootWidth = document.documentElement.scrollWidth;
          const bodyWidth = document.body?.scrollWidth ?? 0;
          return Math.max(rootWidth, bodyWidth) - window.innerWidth;
        }),
      )
      .toBeLessThanOrEqual(1);
    await page.getByRole("tab", { name: "인수인계 비교" }).click();
    await expect(recordPanel).not.toBeVisible();
  });
}

const shellGeometryCases = [
  { width: 1440, height: 900, queueWidth: 268, reviewWidth: 320 },
  { width: 960, height: 768, queueWidth: 220, reviewWidth: 280 },
  { width: 1024, height: 768, queueWidth: 220, reviewWidth: 280 },
  { width: 1279, height: 768, queueWidth: 220, reviewWidth: 280 },
] as const;

for (const geometryCase of shellGeometryCases) {
  test(`uses the integrated clinical shell geometry at ${geometryCase.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: geometryCase.width, height: geometryCase.height });
    await page.goto("/");
    await expect(page.locator(".workspace-shell")).toBeVisible({ timeout: 10_000 });

    const metrics = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".clinical-header");
      const shell = document.querySelector<HTMLElement>(".workspace-shell");
      const queue = document.querySelector<HTMLElement>(".patient-queue");
      const summary = document.querySelector<HTMLElement>(".summary-panel");
      if (!header || !shell || !queue || !summary) throw new Error("임상 쉘 측정 대상이 없습니다.");
      const shellStyle = getComputedStyle(shell);
      return {
        headerHeight: header.getBoundingClientRect().height,
        queueWidth: queue.getBoundingClientRect().width,
        summaryWidth: summary.getBoundingClientRect().width,
        shellGap: shellStyle.columnGap,
      };
    });

    expect(Math.round(metrics.headerHeight)).toBe(56);
    expect(Math.round(metrics.queueWidth)).toBe(geometryCase.queueWidth);
    expect(Math.round(metrics.summaryWidth)).toBe(geometryCase.reviewWidth);
    expect(metrics.shellGap).toBe("0px");
  });
}

const tabletOverflowCases = [960, 1024, 1279] as const;

for (const viewportWidth of tabletOverflowCases) {
  test(`keeps tablet center descendants inside the center column at ${viewportWidth}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewportWidth, height: 768 });
    await page.goto("/");
    await expect(page.locator(".workspace-shell")).toBeVisible({ timeout: 10_000 });

    const metrics = await page.evaluate(() => {
      const center = document.querySelector<HTMLElement>(".comparison-workspace");
      const context = document.querySelector<HTMLElement>(".patient-context");
      const shiftSummary = document.querySelector<HTMLElement>(".shift-summary-strip");
      const shiftSummaryStats = document.querySelector<HTMLElement>(".shift-summary-stats");
      if (!center || !context || !shiftSummary || !shiftSummaryStats) throw new Error("센터 overflow 측정 대상이 없습니다.");

      const centerRect = center.getBoundingClientRect();
      const statCrossings = Array.from(shiftSummary.querySelectorAll<HTMLElement>(".shift-summary-stat"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { text: element.textContent?.trim() ?? "", right: rect.right, centerRight: centerRect.right };
        })
        .filter(({ right }) => right > centerRect.right + 1);

      return {
        centerWidth: centerRect.width,
        centerOverflow: center.scrollWidth - center.clientWidth,
        contextOverflow: context.scrollWidth - context.clientWidth,
        shiftSummaryOverflow: shiftSummary.scrollWidth - shiftSummary.clientWidth,
        shiftSummaryStatsOverflow: shiftSummaryStats.scrollWidth - shiftSummaryStats.clientWidth,
        statCrossings,
      };
    });

    expect(metrics.centerOverflow).toBeLessThanOrEqual(1);
    expect(metrics.contextOverflow).toBeLessThanOrEqual(1);
    expect(metrics.shiftSummaryOverflow).toBeLessThanOrEqual(1);
    expect(metrics.shiftSummaryStatsOverflow).toBeLessThanOrEqual(1);
    expect(metrics.statCrossings).toEqual([]);
  });
}

test("keeps both shift-summary timestamps readable at 960px", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 768 });
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toBeVisible({ timeout: 10_000 });

  const timestampPoints = page.locator(".shift-summary-strip .shift-summary-point");
  await expect(timestampPoints).toHaveCount(2);
  const metrics = await timestampPoints.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent?.trim() ?? "",
        visible: style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0,
        overflow: element.scrollWidth - element.clientWidth,
      };
    }),
  );

  expect(metrics.map(({ text }) => text)).toEqual(["07/02 07:00", "07/02 09:00"]);
  for (const metric of metrics) {
    expect(metric.visible).toBe(true);
    expect(metric.overflow).toBeLessThanOrEqual(1);
  }
});

test("keeps both center modules reachable and stacks structured medication inputs on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("tab", { name: "인수인계 비교" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "인계 검토" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth),
    )
    .toBeLessThanOrEqual(1);

  await page.getByRole("tab", { name: "원본 기록" }).click();
  const recordPanel = page.getByRole("tabpanel", { name: "원본 기록" });
  await expect(recordPanel).toBeVisible();
  await recordPanel.getByRole("tab", { name: /현재 기록/ }).click();
  const medicationRow = recordPanel.locator(".record-medication-edit-row").first();
  await expect(medicationRow).toBeVisible();
  const medicationColumns = await medicationRow.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
  );
  expect(medicationColumns).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth),
    )
    .toBeLessThanOrEqual(1);
});

const densityCapViewports = [1440, 1279, 1024] as const;

for (const viewportWidth of densityCapViewports) {
  test(`keeps the patient context dense and unclipped at ${viewportWidth}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewportWidth, height: 768 });
    await page.goto("/");

    const context = page.locator(".patient-context");
    await expect(context).toBeVisible();

    const metrics = await context.evaluate((element) => {
      const contextRect = element.getBoundingClientRect();
      const textElements = Array.from(element.querySelectorAll<HTMLElement>("h2, h3, p, span"));
      const clippedText = textElements
        .filter((textElement) => (textElement.textContent ?? "").trim().length > 0)
        .map((textElement) => {
          const rect = textElement.getBoundingClientRect();
          const style = getComputedStyle(textElement);
          return {
            text: textElement.textContent?.trim() ?? "",
            clippedByContext:
              rect.top < contextRect.top - 1 ||
              rect.bottom > contextRect.bottom + 1 ||
              rect.left < contextRect.left - 1 ||
              rect.right > contextRect.right + 1,
            clippedByElement:
              (style.overflow === "hidden" || style.overflowY === "hidden") &&
              (textElement.scrollWidth - textElement.clientWidth > 1 ||
                textElement.scrollHeight - textElement.clientHeight > 1),
          };
        })
        .filter(({ clippedByContext, clippedByElement }) => clippedByContext || clippedByElement);

      return {
        height: contextRect.height,
        clippedText,
      };
    });

    expect(metrics.height).toBeLessThanOrEqual(138);
    expect(metrics.height).toBeLessThanOrEqual(142);
    expect(metrics.clippedText).toEqual([]);
  });
}

const evidenceLegibilityViewports = [1440, 1279, 1024, 960, 390] as const;

for (const viewportWidth of evidenceLegibilityViewports) {
  test(`keeps evidence controls legible at ${viewportWidth}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewportWidth, height: viewportWidth === 390 ? 844 : 768 });
    await page.goto("/");

    const evidenceDisclosures = page.locator(".summary-evidence-disclosure");
    await expect(evidenceDisclosures.first()).toBeVisible();
    const bodyOverflowBeforeEvidence = await page.evaluate(
      () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    );
    const disclosureCount = await evidenceDisclosures.count();
    expect(disclosureCount).toBeGreaterThan(0);
    for (let index = 0; index < disclosureCount; index += 1) {
      const disclosure = evidenceDisclosures.nth(index);
      await expect(disclosure).toBeVisible();
      await disclosure.evaluate((element) => {
        (element as HTMLDetailsElement).open = true;
      });
      await expect(disclosure).toHaveAttribute("open", "");
    }

    const metrics = await page.evaluate(() => {
      const measure = (selector: string) =>
        Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            fontSize: Number.parseFloat(style.fontSize),
            height: rect.height,
            overflow: element.scrollWidth - element.clientWidth,
            borderBottomColor: style.borderBottomColor,
          };
        });

      return {
        evidenceLinks: measure(".evidence-link"),
        disclosureSummaries: measure(".summary-evidence-disclosure > summary"),
        evidenceIds: measure(".evidence-id"),
        evidenceDetails: measure(".evidence-details"),
        summaryCopies: measure(".summary-item-copy p"),
        bodyOverflowAfterEvidence:
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      };
    });

    expect(bodyOverflowBeforeEvidence).toBeLessThanOrEqual(1);
    expect(metrics.bodyOverflowAfterEvidence).toBeLessThanOrEqual(1);
    for (const metric of metrics.evidenceLinks) {
      expect(metric.fontSize).toBeGreaterThanOrEqual(11);
      expect(metric.height).toBeGreaterThanOrEqual(24);
      expect(metric.overflow).toBeLessThanOrEqual(1);
      expect(metric.borderBottomColor).toBe("rgb(183, 204, 239)");
    }
    for (const metric of metrics.disclosureSummaries) {
      expect(metric.fontSize).toBeGreaterThanOrEqual(11);
      expect(metric.height).toBeGreaterThanOrEqual(24);
    }
    for (const metric of metrics.evidenceIds) {
      expect(metric.fontSize).toBeGreaterThanOrEqual(10);
      expect(metric.overflow).toBeLessThanOrEqual(1);
    }
    for (const metric of metrics.evidenceDetails) {
      expect(metric.fontSize).toBeGreaterThanOrEqual(10);
    }
    for (const metric of metrics.summaryCopies) {
      expect(metric.fontSize).toBeGreaterThanOrEqual(11);
    }
  });
}

test("wide-screen 2544px restores clinical readability without horizontal clipping", async ({ page }) => {
  await page.setViewportSize({ width: 2544, height: 1258 });
  await page.goto("/");
  await expect(page.locator(".workspace-shell")).toBeVisible({ timeout: 10_000 });

  await page.locator("details.evidence-details, details.summary-evidence-disclosure").evaluateAll((elements) => {
    for (const element of elements) {
      (element as HTMLDetailsElement).open = true;
    }
  });

  const metrics = await page.evaluate(() => {
    const readFontSizes = (selector: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          fontSize: Number.parseFloat(style.fontSize),
          height: rect.height,
          overflow: element.scrollWidth - element.clientWidth,
        };
      });

    const minFontSize = (selector: string) => {
      const values = readFontSizes(selector).map(({ fontSize }) => fontSize);
      if (values.length === 0) throw new Error(`측정 대상이 없습니다: ${selector}`);
      return Math.min(...values);
    };

    const firstFontSize = (selector: string) => {
      const values = readFontSizes(selector);
      if (values.length === 0) throw new Error(`측정 대상이 없습니다: ${selector}`);
      return values[0]!.fontSize;
    };

    const shell = document.querySelector<HTMLElement>(".workspace-shell");
    const queue = document.querySelector<HTMLElement>(".patient-queue");
    const center = document.querySelector<HTMLElement>(".comparison-workspace");
    const summary = document.querySelector<HTMLElement>(".summary-panel");
    if (!shell || !queue || !center || !summary) throw new Error("임상 쉘 측정 대상이 없습니다.");

    const panels = [
      ["patient rail", queue],
      ["center workspace", center],
      ["review rail", summary],
      ...Array.from(document.querySelectorAll<HTMLElement>("details[open]"), (element) => ["expanded evidence", element] as const),
    ] as const;

    return {
      queueWidth: queue.getBoundingClientRect().width,
      centerWidth: center.getBoundingClientRect().width,
      summaryWidth: summary.getBoundingClientRect().width,
      shellColumns: getComputedStyle(shell).gridTemplateColumns,
      pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      panelOverflow: panels.map(([name, element]) => ({
        name,
        overflow: element.scrollWidth - element.clientWidth,
        right: element.getBoundingClientRect().right,
      })),
      microMetadata: minFontSize(
        ".eyebrow, .clinical-header-mode, .clinical-header-recorded-at, .clinical-header-user, .search-label, .search-shortcut, .queue-toolbar, .queue-room, .queue-id, .queue-status, .queue-diagnosis, .queue-change-count, .queue-priority-count, .queue-footnote, .field-label, .context-id, .context-facts, .value-label, .value-time, .group-helper, .group-count, .category-label, .type-label, .priority-label, .change-field, .shift-seam, .delta-label, .evidence-id, .summary-rail-intro, .integrity-heading, .integrity-track + p",
      ),
      ordinaryBody: minFontSize(
        ".summary-item-copy p, .small-tag, .context-facts strong, .value-text, .evidence-details, .evidence-detail-grid, .evidence-detail-grid span, .evidence-detail-grid strong",
      ),
      queuePatientName: firstFontSize(".queue-patient-name"),
      currentValue: firstFontSize(".current-value .value-text"),
      changeTitle: firstFontSize(".change-card h4"),
      majorHeadings: readFontSizes(".queue-heading h2, .comparison-header h2, .summary-header h2"),
      evidenceControls: readFontSizes(".evidence-link, .summary-evidence-disclosure > summary, .evidence-details > summary"),
      evidenceToggles: readFontSizes(".evidence-toggle"),
    };
  });

  expect(Math.round(metrics.queueWidth)).toBe(304);
  expect(Math.round(metrics.summaryWidth)).toBe(400);
  expect(Math.round(metrics.centerWidth)).toBe(1840);
  expect(metrics.shellColumns).toBe("304px 1840px 400px");
  expect(metrics.pageOverflow).toBeLessThanOrEqual(1);
  for (const panel of metrics.panelOverflow) {
    expect(panel.overflow, `${panel.name} overflow`).toBeLessThanOrEqual(1);
    expect(panel.right, `${panel.name} crosses viewport`).toBeLessThanOrEqual(2545);
  }

  expect(metrics.microMetadata).toBeGreaterThanOrEqual(11);
  expect(metrics.ordinaryBody).toBeGreaterThanOrEqual(13);
  expect(metrics.queuePatientName).toBeGreaterThanOrEqual(15);
  expect(metrics.currentValue).toBeGreaterThanOrEqual(15);
  expect(metrics.changeTitle).toBeGreaterThanOrEqual(17);

  for (const heading of metrics.majorHeadings) {
    expect(heading.fontSize).toBeGreaterThanOrEqual(20);
    expect(heading.fontSize).toBeLessThanOrEqual(22);
  }
  for (const control of metrics.evidenceControls) {
    expect(control.fontSize).toBeGreaterThanOrEqual(13);
    expect(control.height).toBeGreaterThanOrEqual(30);
    expect(control.overflow).toBeLessThanOrEqual(1);
  }
  for (const toggle of metrics.evidenceToggles) {
    expect(toggle.fontSize).toBeGreaterThanOrEqual(13);
    expect(toggle.height).toBeGreaterThanOrEqual(30);
  }
});
