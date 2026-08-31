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
  await expect(page.getByText("37.9", { exact: true })).toBeVisible();
  await expect(page.getByText("38.2", { exact: true })).toBeVisible();
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
  const openButton = page.getByRole("button", { name: "원본 기록", exact: true });
  await expect(openButton).toBeVisible();
  await openButton.click();

  const dialog = page.getByRole("dialog", { name: /홍길동/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: /현재 기록/ }).click();
  await dialog.getByRole("spinbutton", { name: "체온" }).fill("39.1");
  await dialog.getByRole("button", { name: "변경사항 비교" }).click();

  await expect(page.getByText("편집 비교 성공 · 체온 39.1", { exact: true })).toBeVisible();
  const temperatureCard = temperatureChange(page);
  await expect(temperatureCard.getByText("39.1", { exact: true })).toBeVisible();
  await expect(page.getByText("편집 비교 성공 · 체온 39.1", { exact: true })).toContainText("39.1");
  await expect(dialog).not.toBeVisible();
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

    const queueHeading = page.getByRole("heading", { name: "환자 큐" });
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

    const recordButton = page.getByRole("button", { name: "원본 기록", exact: true });
    await recordButton.scrollIntoViewIfNeeded();
    await expect(recordButton).toBeVisible();
    await recordButton.click();
    const recordDialog = page.getByRole("dialog", { name: /홍길동/ });
    await expect(recordDialog).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const rootWidth = document.documentElement.scrollWidth;
          const bodyWidth = document.body?.scrollWidth ?? 0;
          return Math.max(rootWidth, bodyWidth) - window.innerWidth;
        }),
      )
      .toBeLessThanOrEqual(1);
    await recordDialog.getByRole("button", { name: "원본 기록 닫기" }).click();
    await expect(recordDialog).not.toBeVisible();
  });
}
