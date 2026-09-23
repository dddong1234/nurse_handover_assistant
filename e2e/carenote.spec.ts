import { expect, test } from "@playwright/test";

test("CareNote real API connects source, draft, explicit record and readiness", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "CBC 새 결과", exact: true })).toBeVisible();
  const evidenceButton = page.getByRole("button", { name: /CBC 새 결과 근거/ });
  await evidenceButton.click();
  await expect(page.getByRole("complementary", { name: "선택한 근거" })).toContainText("WBC 12.1");
  await page.getByRole("button", { name: "근거 상세 닫기" }).click();
  await expect(evidenceButton).toBeFocused();

  await page.getByRole("navigation", { name: "환자 모듈" }).getByRole("button", { name: /^간호기록/ }).click();
  const editor = page.getByRole("textbox", { name: "간호기록 입력", exact: true });
  await editor.fill("통증 3점");
  await expect(page.getByRole("region", { name: "SOAP 추천", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "간호기록 타임라인" })).toContainText("0건");
  await page.getByRole("button", { name: /추천 채택/ }).click();
  const accepted = await editor.inputValue();
  expect(accepted).toContain("3점");
  await page.getByRole("navigation", { name: "환자 모듈" }).getByRole("button", { name: /^환자 기록/ }).click();
  await page.getByRole("navigation", { name: "환자 모듈" }).getByRole("button", { name: /^간호기록/ }).click();
  await expect(editor).toHaveValue(accepted);
  await page.getByRole("button", { name: /김영희/ }).click();
  await expect(editor).toHaveValue("");
  await page.getByRole("button", { name: /홍길동/ }).click();
  await expect(editor).toHaveValue(accepted);

  // Complete the fields deliberately: the demo must not invent an assessment or plan.
  const completed = "S: 통증 3점\nO: 관찰 정보 미입력\nA: 평가 정보 미입력\nP: 계획 정보 미입력";
  await editor.fill(completed);

  const refreshed = page.waitForResponse((response) => response.url().includes("/api/handover/shift-readiness") && response.request().method() === "POST");
  await page.getByRole("button", { name: "기록 추가", exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByRole("region", { name: "간호기록 타임라인" })).toContainText("1건");
  await expect(editor).toHaveValue("");
  await page.getByRole("navigation", { name: "환자 모듈" }).getByRole("button", { name: /^환자 기록/ }).click();
  await expect(page.getByRole("article")).toContainText(completed);
  await page.getByRole("navigation", { name: "환자 모듈" }).getByRole("button", { name: /^근무 준비/ }).click();
  await expect(page.getByText("근무 준비 결과가 준비되었습니다", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /펼치기/ }).click();
  await expect(page.getByRole("main")).toContainText("3점");
  await page.reload();
  await page.getByRole("navigation", { name: "환자 모듈" }).getByRole("button", { name: /^간호기록/ }).click();
  await expect(page.getByRole("region", { name: "간호기록 타임라인" })).toContainText("0건");
  expect(errors).toEqual([]);
});

for (const width of [390, 960, 1440]) {
  test(`CareNote viewport ${width} keeps controls in bounds`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/workspace");
    await expect(page.getByRole("heading", { name: "CBC 새 결과", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const overflowing = await page.locator("main button, main input, main select, main textarea").evaluateAll((nodes) => nodes.filter((node) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
    }).map((node) => node.textContent?.slice(0, 60)));
    expect(overflowing).toEqual([]);
    await page.getByRole("button", { name: /CBC 새 결과 근거/ }).click();
    await expect(page.getByRole("heading", { name: "근거 상세", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/carenote-evidence-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "근거 상세 닫기" }).click();
    await page.getByRole("navigation", { name: "환자 모듈" }).getByRole("button", { name: /^간호기록/ }).click();
    await expect(page.getByRole("textbox", { name: "간호기록 입력", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/carenote-charting-${width}.png`, fullPage: true });
  });
}

test("CareNote landing navigation opens the actual charting workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.locator('a[href="/workspace?module=charting"]').first().click();
  await expect(page.getByRole("textbox", { name: "간호기록 입력", exact: true })).toBeVisible();
});

test("CareNote review marks and memo are retained only for the same review context", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "CBC 새 결과", exact: true })).toBeVisible();
  const row = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "CBC 새 결과", exact: true }) });
  await row.getByRole("checkbox").check();
  const source = page.getByRole("button", { name: /CBC 새 결과 근거/ });
  await source.click();
  await page.getByRole("textbox", { name: "검토 메모", exact: true }).fill("회진 전 원본 수치 재확인");
  await page.getByRole("navigation", { name: "환자 모듈" }).getByRole("button", { name: /^환자 기록/ }).click();
  await page.getByRole("navigation", { name: "환자 모듈" }).getByRole("button", { name: /^근무 준비/ }).click();
  await expect(row.getByRole("checkbox")).toBeChecked();
  await source.click();
  await expect(page.getByRole("textbox", { name: "검토 메모", exact: true })).toHaveValue("회진 전 원본 수치 재확인");
  await page.getByRole("combobox", { name: "비교 기준 시각" }).selectOption("2026-07-02T07:00:00+09:00");
  await expect(page.getByText("근무 준비 결과가 준비되었습니다", { exact: true })).toBeVisible();
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await source.click();
  await expect(page.getByRole("textbox", { name: "검토 메모", exact: true })).toHaveValue("");
});
