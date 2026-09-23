import { isZonedIso } from "./time";

const labels = ["S", "O", "A", "P"];
const placeholder = /\[[^\]]*(?:(?:확인|작성)\s*필요|TODO|미입력)[^\]]*\]|\bTODO\b/i;
const metaOnly = /^(?:미입력|미기재|입력\s*없음|제공(?:된)?\s*(?:정보|자료|입력)\s*없음|(?:직접\s*)?확인[·/\s]*(?:작성)?\s*필요|작성\s*필요)[.!\s]*$/i;

// CareNote synthetic demo only. The original four-section validator remains unchanged.
export function validateChartingDraft(draft: { text: string; recordedAt: string }) {
  const errors: string[] = [];
  if (!isZonedIso(draft.recordedAt)) errors.push("날짜와 한국시간을 확인하세요.");
  const text = draft.text.trim();
  const headings = Array.from(text.matchAll(/^([A-Za-z])([ \t]*):/gm));
  if (!text || text.length > 10_000) errors.push("기록은 1~10,000자로 입력하세요.");
  if (!headings.length || headings[0].index !== 0) {
    errors.push("내용이 있는 SOAP 항목을 하나 이상 입력하세요. 라벨은 줄 시작에 S:, O:, A:, P:로 작성하세요.");
  }
  let previous = -1;
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const position = labels.indexOf(heading[1]);
    if (position < 0 || position <= previous || heading[2] !== "") {
      errors.push("SOAP 라벨은 중복 없이 S, O, A, P 순서로 작성하세요.");
    }
    previous = position;
    const body = text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim();
    const bodyLines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!body || metaOnly.test(body.replace(/\s+/g, " ")) || bodyLines.every((line) => metaOnly.test(line))) {
      errors.push("표시한 항목에는 실제 기록 내용을 입력하세요. 없는 항목은 생략할 수 있습니다.");
    }
    if (/(?:^|[ \t])[A-Za-z][ \t]*:/m.test(body)) errors.push("각 SOAP 라벨은 줄 시작에 작성하세요.");
  }
  if (placeholder.test(text)) errors.push("확인·작성 필요 또는 TODO 표시는 기록에 추가할 수 없습니다.");
  return { valid: errors.length === 0, errors };
}
