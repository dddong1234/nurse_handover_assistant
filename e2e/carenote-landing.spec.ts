import { expect, test } from "@playwright/test";

test("landing primary CTA text has accessible contrast in normal and hover states", async ({ page }) => {
  await page.goto("/");
  const ctas = page.getByRole("link", { name: "데모 체험하기", exact: true });
  await expect(ctas).toHaveCount(3);
  const contrast = async (index: number) => ctas.nth(index).evaluate((node) => {
    const style = getComputedStyle(node);
    const luminance = (color: string) => {
      const components = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
        const s = Number(value) / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
    };
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  for (let index = 0; index < 3; index += 1) {
    expect(await contrast(index)).toBeGreaterThanOrEqual(4.5);
    await ctas.nth(index).hover();
    await expect.poll(() => contrast(index)).toBeGreaterThanOrEqual(4.5);
  }
});

test("landing product preview supports keyboard navigation and factual panels", async ({ page }) => {
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "제품 미리보기" });
  const readiness = tabs.getByRole("tab", { name: "근무 준비", exact: true });
  const evidence = tabs.getByRole("tab", { name: "원본 근거", exact: true });
  const charting = tabs.getByRole("tab", { name: "간호기록", exact: true });
  await expect(readiness).toHaveAttribute("aria-selected", "true");
  await readiness.press("ArrowRight");
  await expect(evidence).toBeFocused();
  await evidence.press("Enter");
  await expect(evidence).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("12.1");
  await expect(page.getByRole("tabpanel")).toContainText("08:20");
  await evidence.press("End");
  await expect(charting).toBeFocused();
  await charting.press("Enter");
  await expect(page.getByRole("tabpanel")).toContainText("통증 3점");
  await expect(page.getByRole("tabpanel")).toContainText("통증 정도 3점.");
  await expect(page.getByRole("tabpanel")).not.toContainText("직접 확인·작성 필요");
  await charting.press("Home");
  await expect(readiness).toBeFocused();
  await readiness.press("Enter");
  await expect(readiness).toHaveAttribute("aria-selected", "true");
});

test("landing product link leads to the preview and FAQ explains storage", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "제품 둘러보기" }).click();
  await expect(page).toHaveURL(/#product$/);
  await expect(page.locator("#product").getByRole("tablist", { name: "제품 미리보기" })).toBeVisible();
  expect(await page.locator("#product").getByRole("heading", { level: 1 }).count()).toBe(0);
  await expect.poll(async () => Math.round((await page.locator("header").boundingBox())!.y)).toBe(0);
  await page.getByText("저장되는 환자 데이터가 있나요?", { exact: true }).click();
  const storage = page.locator("details").filter({ hasText: "저장되는 환자 데이터가 있나요?" });
  await expect(storage).toHaveAttribute("open", "");
  await expect(storage.locator("p")).toContainText("서버 API");
  await expect(storage.locator("p")).toContainText("새로고침");
});

for (const width of [375, 768, 1024, 1440]) {
  test(`landing at ${width}px keeps preview and actions readable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "제품 미리보기" });
    for (const name of ["근무 준비", "원본 근거", "간호기록"]) {
      await tabs.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByRole("tabpanel")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const clipped = await page.locator('main a, main button, [role="tabpanel"]').evaluateAll((nodes) => nodes.filter((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
      }).map((node) => node.textContent?.slice(0, 60)));
      expect(clipped).toEqual([]);
      const tooSmall = await page.locator('#preview-panel time, #preview-panel small, #preview-panel em').evaluateAll((nodes) => nodes.filter((node) => parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.textContent));
      expect(tooSmall).toEqual([]);
    }
    await expect(page.locator('a[href="/workspace"]').first()).toBeVisible();
    await expect(page.locator('a[href="/workspace?module=charting"]').first()).toBeVisible();
  });
}
