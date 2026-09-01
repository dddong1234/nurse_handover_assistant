import { expect, test, type Page } from "@playwright/test";

import p001ReturnPeriodStates from "../data/contracts/P001_return_period_states.json";
import { buildDemoWorkspaceData } from "../src/lib/demo-adapter";
import { getDemoTimeline } from "../src/lib/demo-timelines";
import {
  isHandoverPeriodApiResponse,
  type HandoverPeriodApiResponse,
} from "../src/lib/handover-period-contracts";

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

  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();

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
  await expect(page.getByRole("tab", { name: "인수인계 비교" })).toHaveAttribute("aria-selected", "true");
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
    const ready = cloneP001ReturnFixture("ready");
    await page.setViewportSize(viewport);
    await page.goto("/");
    await p001Patient(page).click();
    await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
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
  const ready = cloneP001ReturnFixture("ready");
  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
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
    await page.goto("/");
    await p001Patient(page).click();
    await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();

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

  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
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
  await page.route("**/api/handover/period-compare", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as ReturnPeriodRequestBody;
    if (body.reviewStartAt === ready.period.requestedStartAt) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ready) });
      return;
    }
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "period unavailable" }) });
  });

  await page.goto("/");
  await p001Patient(page).click();
  await page.getByRole("tab", { name: "휴무 복귀", exact: true }).click();
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
