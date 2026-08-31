import { expect, test, type Page } from "@playwright/test";

import { buildDemoWorkspaceData } from "../src/lib/demo-adapter";

const FALLBACK_MESSAGE = "서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.";
const RETIRED_SAFETY_NOTICE = ["가상 데이터", "의사결정 보조가 아님"].join(" · ");
const RETIRED_UTILITY_CONTEXT = ["일반 성인병동", "교대 검토"].join(" · ");

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
      await disclosure.locator(":scope > summary").click();
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
