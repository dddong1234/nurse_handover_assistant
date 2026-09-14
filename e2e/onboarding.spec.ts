import { expect, test } from "@playwright/test";

const ONBOARDING_KEY = "nurse-handover:onboarding:v1";

async function openFirstVisit(page: import("@playwright/test").Page, resetPreference = false) {
  await page.goto("/");
  if (resetPreference) {
    await page.evaluate((key) => window.localStorage.removeItem(key), ONBOARDING_KEY);
    await page.reload();
  }
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 10_000 });
  const dialog = page.getByRole("dialog", { name: "인수인계, 여기서 시작하세요" });
  await expect(dialog).toBeVisible();
  return page.getByRole("dialog");
}

async function expectDialogControlsInViewport(dialog: import("@playwright/test").Locator, viewportWidth: number, viewportHeight: number) {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight);
  await expect(dialog.getByRole("button", { name: "건너뛰기" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /시작하기|다음|안내 마치기/ }).first()).toBeVisible();
}

test("shows the genuine first-visit path and keeps each step bounded at desktop widths", async ({ page }) => {
  for (const [index, viewportWidth] of [960, 1440].entries()) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    const dialog = await openFirstVisit(page, index > 0);
    await expectDialogControlsInViewport(dialog, viewportWidth, 900);
    await dialog.getByRole("button", { name: "시작하기" }).click();

    const targets = [
      page.locator(".patient-queue .queue-row").first(),
      page.locator(".return-handover-controls"),
      page.locator(".comparison-panel .change-card").first(),
      page.locator(".summary-panel .summary-integrity"),
    ];
    const headings = ["담당 환자", "인수인계 범위", "변화 검토", "인계 검토"];

    for (let index = 0; index < targets.length; index += 1) {
      await expect(dialog.getByRole("heading", { name: headings[index] })).toBeVisible();
      await expect(targets[index]).toBeVisible({ timeout: 10_000 });
      await expectDialogControlsInViewport(dialog, viewportWidth, 900);
      if (index === 2) {
        const evidenceAction = page.locator(".evidence-details > summary").first();
        await expect(evidenceAction).toBeVisible({ timeout: 10_000 });
        const evidenceBox = await evidenceAction.boundingBox();
        const cardBox = await dialog.boundingBox();
        expect(evidenceBox).not.toBeNull();
        expect(cardBox).not.toBeNull();
        if (evidenceBox && cardBox) {
          const overlaps = evidenceBox.x < cardBox.x + cardBox.width &&
            evidenceBox.x + evidenceBox.width > cardBox.x &&
            evidenceBox.y < cardBox.y + cardBox.height &&
            evidenceBox.y + evidenceBox.height > cardBox.y;
          expect(overlaps).toBe(false);
        }
      }
      if (index < targets.length - 1) {
        await dialog.getByRole("button", { name: "다음" }).click();
      }
    }

    await dialog.getByRole("button", { name: "안내 마치기" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("keeps the mobile target above the fixed card and supports replay plus Escape dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openFirstVisit(page);
  await dialog.getByRole("button", { name: "시작하기" }).click();

  const target = page.locator(".patient-queue .queue-row").first();
  await expect(target).toBeVisible({ timeout: 10_000 });
  const targetBox = await target.boundingBox();
  const cardBox = await dialog.boundingBox();
  expect(targetBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  if (targetBox && cardBox) {
    expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(cardBox.y + 1);
  }
  await expectDialogControlsInViewport(dialog, 390, 844);

  await dialog.getByRole("button", { name: "다음" }).click();
  await expect(dialog.getByRole("heading", { name: "인수인계 범위" })).toBeVisible();
  await dialog.getByRole("button", { name: "다음" }).click();
  await expect(dialog.getByRole("heading", { name: "변화 검토" })).toBeVisible();
  const mobileEvidenceAction = page.locator(".evidence-details > summary").first();
  await expect(mobileEvidenceAction).toBeVisible({ timeout: 10_000 });
  const mobileEvidenceBox = await mobileEvidenceAction.boundingBox();
  const mobileCardBox = await dialog.boundingBox();
  expect(mobileEvidenceBox).not.toBeNull();
  expect(mobileCardBox).not.toBeNull();
  if (mobileEvidenceBox && mobileCardBox) {
    expect(mobileEvidenceBox.y + mobileEvidenceBox.height).toBeLessThanOrEqual(mobileCardBox.y + 1);
  }

  await dialog.getByRole("button", { name: "건너뛰기" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.getByRole("button", { name: "화면 안내" }).click();
  const replayed = page.getByRole("dialog", { name: "인수인계, 여기서 시작하세요" });
  await expect(replayed).toBeVisible();
  await replayed.getByRole("button", { name: "시작하기" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "화면 안내" })).toBeFocused();
  await expect(page.evaluate((key) => window.localStorage.getItem(key), ONBOARDING_KEY)).resolves.toBe("dismissed");
});

test("repositions the active target when resizing from desktop to mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const dialog = await openFirstVisit(page);
  await dialog.getByRole("button", { name: "시작하기" }).click();
  await dialog.getByRole("button", { name: "다음" }).click();
  await dialog.getByRole("button", { name: "다음" }).click();
  await expect(dialog.getByRole("heading", { name: "변화 검토" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectDialogControlsInViewport(dialog, 390, 844);
  const evidenceAction = page.locator(".evidence-details > summary").first();
  const changeCard = page.locator(".comparison-panel .change-card").first();
  await expect(evidenceAction).toBeVisible({ timeout: 10_000 });
  const evidenceBox = await evidenceAction.boundingBox();
  const targetBox = await changeCard.boundingBox();
  const cardBox = await dialog.boundingBox();
  expect(evidenceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  if (evidenceBox && targetBox && cardBox) {
    expect(evidenceBox.y + evidenceBox.height).toBeLessThanOrEqual(cardBox.y + 1);
    expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(cardBox.y + 1);
    const overlaps = targetBox.x < cardBox.x + cardBox.width &&
      targetBox.x + targetBox.width > cardBox.x &&
      targetBox.y < cardBox.y + cardBox.height &&
      targetBox.y + targetBox.height > cardBox.y;
    expect(overlaps).toBe(false);
  }
});

test("keeps the record-mode target above the mobile guide card after replay", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const initial = await openFirstVisit(page, true);
  await initial.getByRole("button", { name: "건너뛰기" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("tab", { name: "원본 기록" }).click();
  await page.getByRole("button", { name: "화면 안내" }).click();
  const welcome = page.getByRole("dialog", { name: "인수인계, 여기서 시작하세요" });
  await expect(welcome).toBeVisible();
  const dialog = page.getByRole("dialog");
  await welcome.getByRole("button", { name: "시작하기" }).click();
  await dialog.getByRole("button", { name: "다음" }).click();
  await dialog.getByRole("button", { name: "다음" }).click();
  await expect(dialog.getByRole("heading", { name: "원본 기록" })).toBeVisible();

  const target = page.locator(".record-workspace-header");
  await expect(target).toBeVisible({ timeout: 10_000 });
  await expectDialogControlsInViewport(dialog, 390, 844);
  const targetBox = await target.boundingBox();
  const cardBox = await dialog.boundingBox();
  expect(targetBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  if (targetBox && cardBox) {
    expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(cardBox.y + 1);
    const overlaps = targetBox.x < cardBox.x + cardBox.width &&
      targetBox.x + targetBox.width > cardBox.x &&
      targetBox.y < cardBox.y + cardBox.height &&
      targetBox.y + targetBox.height > cardBox.y;
    expect(overlaps).toBe(false);
  }
});
