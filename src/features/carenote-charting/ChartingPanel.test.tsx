import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChartingPanelProps, CareDraft, CareNoteInput } from "@/lib/carenote/types";
import { ChartingPanel } from "./ChartingPanel";

const patient = { id: "p1", encounterId: "admission1", name: "합성 환자" };
const initialDraft: CareDraft = { text: "잠 못잠", recordedAt: "2026-09-23T22:00:00+09:00", category: "PRN" };
const nurseCompletedText = "S: 잠 못잠\nO: 합성 과업의 관찰 내용을 직접 작성함.\nA: 합성 과업의 사정 내용을 직접 작성함.\nP: 합성 과업의 수행 내용을 직접 작성함.";
const medication = {
  id: "dose1", patientId: "p1", encounterId: "admission1",
  recordedAt: "2026-09-23T21:00:00+09:00", category: "PRN" as const,
  label: "합성 PRN 투약", text: "Stilnox 10mg PO 투약함.",
};

function Harness({ onAddNote = () => {}, ...overrides }: Partial<ChartingPanelProps>) {
  const [draft, setDraft] = useState(overrides.draft ?? initialDraft);
  return <ChartingPanel patient={patient} evidence={[medication]} notes={[]} onOpenEvidence={() => {}}
    {...overrides} draft={draft} onDraftChange={setDraft} onAddNote={onAddNote} />;
}

afterEach(cleanup);

describe("ChartingPanel explicit authorship", () => {
  it("invalidates source provenance after direct editing instead of retaining the accepted links", async () => {
    const user = userEvent.setup();
    const added: CareNoteInput[] = [];
    render(<Harness evidence={[{ ...medication, id: "prior-sleep", text: "잠 못잠" }]} onAddNote={(note) => added.push(note)} />);
    await user.click(screen.getByRole("button", { name: "추천 채택" }));
    await user.click(screen.getByRole("button", { name: "기록 추가" }));
    expect(added[0].sourceEvidenceIds).toEqual(["prior-sleep"]);
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    fireEvent.change(editor, { target: { value: "S: 간호사가 직접 수정한 기록." } });
    await user.click(screen.getByRole("button", { name: "기록 추가" }));
    expect(added[1].sourceEvidenceIds).toEqual([]);
    expect(added[1].narrative).toBe("S: 간호사가 직접 수정한 기록.");
    expect(screen.queryByRole("region", { name: "입력 원문" })).not.toBeInTheDocument();
  });
  it("keeps an accepted objective-only note editable and addable without generating other fields", async () => {
    const user = userEvent.setup();
    const added: CareNoteInput[] = [];
    render(<Harness draft={{ ...initialDraft, text: "배액 30cc", category: "일반" }} onAddNote={(note) => added.push(note)} />);
    await user.click(screen.getByRole("button", { name: "추천 채택" }));
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    expect(editor).toHaveValue("O: 배액량 30cc.");
    fireEvent.change(editor, { target: { value: "O: 배액량 35cc." } });
    editor.focus();
    await user.keyboard("{Tab}");
    expect(editor).toHaveValue("O: 배액량 35cc.");
    await user.click(screen.getByRole("button", { name: "기록 추가" }));
    expect(added[0].narrative).toBe("O: 배액량 35cc.");
  });
  it("still blocks a pasted unresolved placeholder without changing the input", async () => {
    const user = userEvent.setup();
    const added: CareNoteInput[] = [];
    const text = "S: 잘 잤음.\nO: [직접 확인·작성 필요]";
    render(<Harness draft={{ ...initialDraft, text }} onAddNote={(note) => added.push(note)} />);
    await user.click(screen.getByRole("button", { name: "기록 추가" }));
    expect(added).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("추가할 수 없습니다");
    expect(screen.getByRole("textbox", { name: "간호기록 입력" })).toHaveValue(text);
  });
  it("keeps charting copy concise and shows the reset boundary near add", () => {
    render(<Harness />);

    expect(screen.getByRole("heading", { name: "간호기록" })).toBeInTheDocument();
    expect(screen.getByText("기록 기반 추천")).toBeInTheDocument();
    expect(screen.getByText("짧은 입력을 기록 문장으로 다듬습니다.")).toBeInTheDocument();
    expect(screen.getByText("세션 기록 · 새로고침 시 초기화 · 미서명")).toBeInTheDocument();
    expect(screen.queryByText("NURSING NOTES")).not.toBeInTheDocument();
    expect(screen.queryByText("지원하는 단문 사실만 옮깁니다.")).not.toBeInTheDocument();
  });

  it("lets the nurse accept and explicitly add a supported phrase without filling three invented fields", async () => {
    const user = userEvent.setup();
    const added: CareNoteInput[] = [];
    render(<Harness onAddNote={(note) => added.push(note)} />);
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    expect(editor).toHaveValue("잠 못잠");
    expect(added).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "추천 채택" }));
    expect(editor).toHaveValue("S: 잠을 이루기 어려움.");
    expect(screen.getByRole("region", { name: "입력 원문" })).toHaveTextContent("잠 못잠");
    expect(added).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "기록 추가" }));
    expect(added[0].narrative).toBe("S: 잠을 이루기 어려움.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("keeps every word of an unsupported compound observation on Tab", async () => {
    const user = userEvent.setup();
    render(<Harness draft={{ ...initialDraft, text: "호흡곤란 있음. 오심 없음" }} />);
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    await user.click(editor);
    await user.keyboard("{Tab}");
    expect(editor).toHaveValue("호흡곤란 있음. 오심 없음");
    expect(screen.queryByRole("button", { name: "추천 채택" })).not.toBeInTheDocument();
  });
  it("does not expose a future evidence link or review in an earlier draft", () => {
    render(<Harness draft={{ ...initialDraft, recordedAt: "2026-09-23T20:00:00+09:00" }} />);
    expect(screen.queryByRole("region", { name: "기록 전 확인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "투약 근거 보기" })).not.toBeInTheDocument();
  });
  it("clears a previously accepted review when the parent replaces the draft", async () => {
    const user = userEvent.setup();
    const props = { patient, evidence: [medication], notes: [], draft: initialDraft,
      onOpenEvidence: () => {}, onAddNote: () => {}, onDraftChange: () => {} };
    const view = render(<ChartingPanel {...props} />);
    await user.click(screen.getByRole("button", { name: "추천 채택" }));
    view.rerender(<ChartingPanel {...props} draft={{ ...initialDraft, text: "" }} />);
    expect(screen.queryByRole("region", { name: "기록 전 확인" })).not.toBeInTheDocument();
  });

  it("keeps input and reports a rejected record-add callback", async () => {
    const user = userEvent.setup();
    render(<Harness onAddNote={() => { throw new Error("outside shift"); }} />);
    await user.click(screen.getByRole("button", { name: "추천 채택" }));
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    const acceptedText = (editor as HTMLTextAreaElement).value;
    await user.click(screen.getByRole("button", { name: "기록 추가" }));
    expect(screen.getByRole("alert")).toHaveTextContent("입력은 유지됩니다");
    expect(editor).toHaveValue(acceptedText);
  });

  it("resets acceptance and dismissal on patient or admission change", async () => {
    const user = userEvent.setup();
    const props = { patient, evidence: [medication], notes: [], draft: initialDraft,
      onOpenEvidence: () => {}, onAddNote: () => {}, onDraftChange: () => {} };
    const view = render(<ChartingPanel {...props} />);
    await user.click(screen.getByRole("button", { name: "무시" }));
    expect(screen.queryByRole("button", { name: "추천 채택" })).not.toBeInTheDocument();
    view.rerender(<ChartingPanel {...props} patient={{ ...patient, encounterId: "admission2" }} />);
    expect(screen.getByRole("button", { name: "추천 채택" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "기록 전 확인" })).not.toBeInTheDocument();
  });

  it("keeps nurse edits after acceptance and does not re-accept on the next Tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    await user.click(screen.getByRole("button", { name: "추천 채택" }));
    const edited = (editor as HTMLTextAreaElement).value + "\n22:15 추가 관찰 내용을 직접 기록함.";
    fireEvent.change(editor, { target: { value: edited } });
    editor.focus();
    await user.keyboard("{Tab}");
    expect(editor).toHaveValue(edited);
    expect(screen.queryByRole("button", { name: "추천 채택" })).not.toBeInTheDocument();
  });

  it("dismisses with Escape without modifying or adding a record", async () => {
    const user = userEvent.setup();
    const added: CareNoteInput[] = [];
    render(<Harness onAddNote={(note) => added.push(note)} />);
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    await user.click(editor);
    await user.keyboard("{Escape}");
    expect(editor).toHaveValue("잠 못잠");
    expect(screen.queryByRole("button", { name: "추천 채택" })).not.toBeInTheDocument();
    expect(added).toHaveLength(0);
    fireEvent.change(editor, { target: { value: "잘잠" } });
    expect(screen.getByRole("button", { name: "추천 채택" })).toBeInTheDocument();
  });

  it("does not hijack Shift+Tab or an external control's Tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    await user.click(editor);
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(editor).toHaveValue("잠 못잠");
    screen.getByRole("combobox", { name: "기록 분류" }).focus();
    await user.keyboard("{Tab}");
    expect(editor).toHaveValue("잠 못잠");
  });

  it("does not recycle a sleep recommendation for unsupported text or after clearing", () => {
    render(<Harness />);
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    fireEvent.change(editor, { target: { value: "호흡 불편 호소함" } });
    expect(screen.queryByRole("button", { name: "추천 채택" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("지원하지 않는 표현");
    fireEvent.change(editor, { target: { value: "" } });
    expect(screen.queryByRole("region", { name: "기록 전 확인" })).not.toBeInTheDocument();
    expect(editor).toHaveValue("");
  });

  it("shows only this patient and encounter's notes and evidence, ordered by full ISO time", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const note = { patientId: "p1", encounterId: "admission1", category: "일반" as const,
      sourceEvidenceIds: [], signatureState: "unsigned-demo" as const, revision: 1 };
    render(<Harness onOpenEvidence={open}
      evidence={[medication, { ...medication, id: "foreign", patientId: "p2", label: "다른 환자" }]}
      notes={[
        { ...note, id: "old", recordedAt: "2026-09-23T23:50:00+09:00", narrative: "자정 전 기록" },
        { ...note, id: "new", recordedAt: "2026-09-24T00:05:00+09:00", narrative: "자정 후 기록" },
        { ...note, id: "foreign-note", encounterId: "other", recordedAt: "2026-09-24T00:10:00+09:00", narrative: "다른 입원 기록" },
      ]} />);
    const timeline = screen.getByRole("region", { name: "간호기록 타임라인" });
    const items = within(timeline).getAllByRole("article");
    expect(items[0]).toHaveTextContent("자정 후 기록");
    expect(items[1]).toHaveTextContent("자정 전 기록");
    expect(items[0]).toHaveTextContent("미서명");
    expect(screen.queryByText("다른 입원 기록")).not.toBeInTheDocument();
    expect(screen.queryByText("다른 환자")).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "기록 전 확인" })).getByRole("button", { name: /근거/ }));
    expect(open).toHaveBeenCalledWith("dose1");
  });

  it("round-trips the local time editor in Korea time independent of browser timezone", () => {
    let latest: CareDraft | undefined;
    render(<ChartingPanel patient={patient} draft={{ ...initialDraft, recordedAt: "2026-09-23T15:05:00Z" }}
      evidence={[]} notes={[]} onDraftChange={(draft) => { latest = draft; }} onAddNote={() => {}} onOpenEvidence={() => {}} />);
    const time = screen.getByLabelText("기록 시각 (한국시간)");
    expect(time).toHaveValue("2026-09-24T00:05");
    fireEvent.change(time, { target: { value: "2026-09-24T00:15" } });
    expect(latest?.recordedAt).toBe("2026-09-24T00:15:00+09:00");
  });

  it("does not add incomplete SOAP or a timestamp without a timezone", async () => {
    const user = userEvent.setup();
    const added: CareNoteInput[] = [];
    render(<Harness draft={{ ...initialDraft, recordedAt: "2026-09-23T22:00", text: "S: 사실만" }}
      onAddNote={(note) => added.push(note)} />);
    await user.click(screen.getByRole("button", { name: "기록 추가" }));
    expect(added).toHaveLength(0);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("keeps the external review prompt out of the accepted and explicitly added note", async () => {
    const user = userEvent.setup();
    const added: CareNoteInput[] = [];
    render(<Harness onAddNote={(note) => added.push(note)} />);
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    expect(editor).toHaveValue("잠 못잠");
    expect(screen.getByRole("region", { name: "기록 전 확인" })).toHaveTextContent("투약 후");
    expect(added).toHaveLength(0);
    await user.click(editor);
    await user.keyboard("{Tab}");
    expect((editor as HTMLTextAreaElement).value).toContain("S: 잠을 이루기 어려움.");
    expect((editor as HTMLTextAreaElement).value).not.toContain("찾지 못했습니다");
    expect(added).toHaveLength(0);
    fireEvent.change(editor, { target: { value: nurseCompletedText } });
    await user.click(screen.getByRole("button", { name: "기록 추가" }));
    expect(added).toHaveLength(1);
    expect(added[0].narrative).toBe((editor as HTMLTextAreaElement).value);
    expect(added[0].narrative).not.toContain("기록 전 확인");
  });
});
