import { expect, test, type Page } from "@playwright/test";

const FALLBACK_MESSAGE = "서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.";
const SAFETY_NOTICE = "가상 데이터 · 의사결정 보조가 아님";

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

test("an SBAR evidence link visibly selects the matching change", async ({ page }) => {
  await page.goto("/");

  const temperature = temperatureChange(page);
  const evidenceLink = page
    .locator('a[title="vitals-body_temperature-modified"][href="#evidence-vitals-body_temperature-modified"]')
    .first();
  await expect(evidenceLink).toBeVisible();

  await evidenceLink.click();

  await expect(temperature).toHaveAttribute("aria-current", "true");
  await expect(temperature.locator("details.evidence-details")).toHaveAttribute("open", "");
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
  await expect(page.getByText("deterministic", { exact: true })).toBeVisible();
  await expect(temperatureChange(page)).toBeVisible();
  await expect(page.getByText("37.9", { exact: true })).toBeVisible();
  await expect(page.getByText("38.2", { exact: true })).toBeVisible();
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

    const safetyNotice = page
      .getByRole("complementary", { name: "인계 검토" })
      .getByText(SAFETY_NOTICE, { exact: true });
    await safetyNotice.scrollIntoViewIfNeeded();
    await expect(safetyNotice).toBeVisible();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const rootWidth = document.documentElement.scrollWidth;
          const bodyWidth = document.body?.scrollWidth ?? 0;
          return Math.max(rootWidth, bodyWidth) - window.innerWidth;
        }),
      )
      .toBeLessThanOrEqual(1);
  });
}
