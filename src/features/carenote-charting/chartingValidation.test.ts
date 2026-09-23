import { describe, expect, it } from "vitest";
import { validateChartingDraft } from "./chartingValidation";

const recordedAt = "2026-09-24T22:00:00+09:00";

describe("CareNote demo supplied-section validation", () => {
  it.each([
    "O: [검사 결과 확인함] 체온 36.5도.",
    "O: [\n검사 결과 확인함\n] 체온 36.5도.",
    "O: [수기 작성 완료] 체온 36.5도.",
    "O: 직접 확인한 체온 36.5도.\n검사 결과 확인함.",
  ])("allows completed handwritten facts without treating every 확인 or 작성 as unfinished: %s", (text) => {
    expect(validateChartingDraft({ text, recordedAt }).valid).toBe(true);
  });
  it.each([
    "S: [\n직접 확인·작성 필요\n]",
    "S: 확인 필요\n확인 필요",
    "S: 확인\n필요",
    "S: 확인 필요\n\n작성 필요",
    "S: 미입력\n제공된 정보 없음",
    "O: 체온 36.5도. [\n작성 필요\n]",
    "S: [\nTODO\n]",
  ])("rejects explicit unfinished markers across line breaks or repeated meta-only lines: %s", (text) => {
    expect(validateChartingDraft({ text, recordedAt }).valid).toBe(false);
  });
  it.each([
    "S: 잘 잤음.",
    "S: 잠을 이루기 어려움.",
    "O: 배액량 30cc.",
    "S: 통증 정도 3점.\nO: 직접 작성한 객관적 사실.",
    "S: 직접 작성한 주관적 사실.\nO: 직접 작성한 객관적 사실.\nA: 직접 작성한 사정.\nP: 직접 작성한 수행.",
    "O: 첫 관찰 사실.\n추가 관찰 사실.\nP: 직접 작성한 수행.",
  ])("allows only supplied sections without demanding invented missing fields: %s", (text) => {
    expect(validateChartingDraft({ text, recordedAt }).valid).toBe(true);
  });
  it.each([
    "", "잠 못잠", "S:", "S: \nO: 배액량 30cc.", "S: \nO: \nA: \nP:",
    "O: 객관적 사실.\nS: 주관적 사실.", "S: 첫 사실.\nS: 두 번째 사실.",
    "B: 배경.", "s: 잘 잤음.", "S : 잘 잤음.", "S: 잘 잤음.\nB: 배경.",
    "S: 잘 잤음. O: 자료.", "S: 잘 잤음.\nO: [직접 확인·작성 필요]",
    "S: 잘 잤음.\nO: 입력 없음", "S: 잘 잤음.\nA: 제공된 정보 없음",
    "S: 잘 잤음.\nP: TODO", "S: [확인 필요]",
  ])("rejects malformed, empty, duplicate, placeholder, or meta-only sections: %s", (text) => {
    expect(validateChartingDraft({ text, recordedAt }).valid).toBe(false);
  });
  it("rejects a valid partial note without an unambiguous record time", () => {
    expect(validateChartingDraft({ text: "S: 잘 잤음.", recordedAt: "22:00" }).valid).toBe(false);
  });
});
