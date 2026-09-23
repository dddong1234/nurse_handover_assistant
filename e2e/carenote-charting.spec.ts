import { expect, test } from "@playwright/test";

const cases = [
  ["잘잠", "S: 잘 잤음."],
  ["잠 못잠", "S: 잠을 이루기 어려움."],
  ["통증 3점", "S: 통증 정도 3점."],
  ["오심 없음", "S: 오심 없음."],
] as const;

for (const [input, sentence] of cases) {
  test(`charting phrases ${input} and adds only after explicit acceptance and add`, async ({ page }) => {
    await page.goto("/workspace?module=charting");
    const editor = page.getByRole("textbox", { name: "간호기록 입력", exact: true });
    const timeline = page.getByRole("region", { name: "간호기록 타임라인" });
    await editor.fill(input);
    const suggestion = page.getByRole("region", { name: "SOAP 추천", exact: true });
    await expect(suggestion).toContainText(sentence);
    await expect(suggestion).not.toContainText("직접 확인·작성 필요");
    await expect(editor).toHaveValue(input);
    await expect(timeline).toContainText("0건");
    await page.getByRole("button", { name: "추천 채택", exact: true }).click();
    await expect(editor).toHaveValue(sentence);
    await expect(page.getByRole("region", { name: "입력 원문", exact: true })).toContainText(input);
    await expect(timeline).toContainText("0건");
    const refreshed = page.waitForResponse((response) => response.url().includes("/api/handover/shift-readiness") && response.request().method() === "POST");
    await page.getByRole("button", { name: "기록 추가", exact: true }).click();
    expect((await refreshed).status()).toBe(200);
    await expect(timeline).toContainText("1건");
    await expect(timeline).toContainText(sentence);
    await expect(editor).toHaveValue("");
    await page.reload();
    await expect(timeline).toContainText("0건");
  });
}

test("charting preserves unsupported correction and rejects pasted unresolved fields", async ({ page }) => {
  await page.goto("/workspace?module=charting");
  const editor = page.getByRole("textbox", { name: "간호기록 입력", exact: true });
  await editor.fill("통증 3점 아니고 7점");
  await expect(page.getByRole("region", { name: "SOAP 추천", exact: true })).toHaveCount(0);
  await editor.press("Tab");
  await expect(editor).toHaveValue("통증 3점 아니고 7점");
  const incomplete = "S: 잘 잤음.\nO: [직접 확인·작성 필요]";
  await editor.fill(incomplete);
  await page.getByRole("button", { name: "기록 추가", exact: true }).click();
  await expect(page.getByRole("region", { name: "간호기록 작성", exact: true }).getByRole("alert")).toContainText("추가할 수 없습니다");
  await expect(editor).toHaveValue(incomplete);
  await expect(page.getByRole("region", { name: "간호기록 타임라인" })).toContainText("0건");
});
