import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CareDraft, CareNote } from "@/lib/carenote/types";
import { getCareScenario } from "@/lib/carenote/scenario";
import { createValidShiftReadinessResponse } from "@/test/shift-readiness-fixtures";

const mocks = vi.hoisted(() => ({
  useCareReadiness: vi.fn(),
}));

vi.mock("@/lib/carenote/useCareReadiness", () => mocks);
vi.mock("@/features/carenote-charting/ChartingPanel", () => ({
  ChartingPanel: ({ draft, onDraftChange, onAddNote }: {
    draft: CareDraft;
    onDraftChange: (draft: CareDraft) => void;
    onAddNote: (input: { narrative: string; recordedAt: string; category: "V/S" | "PRN" | "일반"; sourceEvidenceIds: string[] }) => void;
  }) => (
    <section aria-label="간호기록 테스트 패널">
      <label>
        간호기록 입력
        <textarea aria-label="간호기록 입력" value={draft.text} onChange={(event) => onDraftChange({ ...draft, text: event.target.value })} />
      </label>
      <button type="button" onClick={() => onAddNote({ narrative: "세션 메모", recordedAt: draft.recordedAt, category: draft.category, sourceEvidenceIds: [] })}>기록 추가</button>
    </section>
  ),
}));

import { CareWorkspace } from "./CareWorkspace";

function mockReadinessForScenario(scenario: ReturnType<typeof getCareScenario>, notes: CareNote[], reviewStartAt: string) {
  const base = createValidShiftReadinessResponse();
  const response = {
    ...base,
    patient: {
      id: scenario.patient.id,
      name: scenario.patient.name,
      room: scenario.patient.room,
      age: scenario.patient.age,
      sex: scenario.patient.sex,
      diagnoses: scenario.patient.diagnoses,
    },
    reviewPeriod: {
      ...base.reviewPeriod,
      currentRecordedAt: scenario.records.at(-1)?.updated_at ?? base.reviewPeriod.currentRecordedAt,
    },
    shift: scenario.shift,
    items: base.items.map((item) => ({
      ...item,
      id: item.id.replace("P001", scenario.patient.id),
      patientId: scenario.patient.id,
      sourceRefs: item.sourceRefs.map((source) => ({ ...source, recordedAt: scenario.records.at(-1)?.updated_at ?? source.recordedAt })),
    })),
    groups: Object.fromEntries(Object.entries(base.groups).map(([key, ids]) => [key, ids.map((id) => id.replace("P001", scenario.patient.id))])),
  };
  return {
    response,
    status: "success" as const,
    stale: false,
    retry: vi.fn(),
    reviewKey: `${scenario.patient.id}:${reviewStartAt}:${notes.length}`,
    records: scenario.records,
  };
}

beforeEach(() => {
  mocks.useCareReadiness.mockImplementation((scenario: ReturnType<typeof getCareScenario>, notes: CareNote[], reviewStartAt: string) => mockReadinessForScenario(scenario, notes, reviewStartAt));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CareWorkspace integrated patient context", () => {
  it("switches patient context without leaving the previous patient's evidence selected", async () => {
    const user = userEvent.setup();
    render(<CareWorkspace />);

    const evidenceButton = screen.getByRole("button", { name: /CBC 결과 확인 근거/ });
    await user.click(evidenceButton);
    expect(screen.getByRole("heading", { name: "근거 상세" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /김영희/ }));
    expect(screen.getByRole("heading", { name: "김영희" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "근거 상세" })).not.toBeInTheDocument();
    expect(screen.queryByText("CBC 원본")).not.toBeInTheDocument();
  });

  it("preserves a patient's draft while moving between modules", async () => {
    const user = userEvent.setup();
    render(<CareWorkspace />);

    await user.click(screen.getByRole("button", { name: /간호기록/ }));
    const editor = screen.getByRole("textbox", { name: "간호기록 입력" });
    fireEvent.change(editor, { target: { value: "초안으로 남겨둔 관찰" } });
    await user.click(screen.getByRole("button", { name: /근무 준비/ }));
    await user.click(screen.getByRole("button", { name: /간호기록/ }));

    expect(screen.getByRole("textbox", { name: "간호기록 입력" })).toHaveValue("초안으로 남겨둔 관찰");
  });

  it("keeps read marks in the review-key memory across module changes and exposes source-based review windows", async () => {
    const user = userEvent.setup();
    render(<CareWorkspace />);

    const reviewWindow = screen.getByRole("combobox", { name: "비교 기준 시각" });
    expect(reviewWindow.querySelectorAll("option").length).toBeGreaterThan(1);
    const firstCheck = screen.getAllByRole("checkbox", { name: "확인" })[0];
    await user.click(firstCheck);
    await user.click(screen.getByRole("button", { name: /간호기록/ }));
    await user.click(screen.getByRole("button", { name: /근무 준비/ }));

    expect(screen.getAllByRole("checkbox", { name: "확인" })[0]).toBeChecked();
  });

  it("opens one source detail with previous/current values and restores focus on close", async () => {
    const user = userEvent.setup();
    render(<CareWorkspace />);

    const trigger = screen.getByRole("button", { name: /CBC 결과 확인 근거/ });
    await user.click(trigger);
    expect(screen.getByRole("heading", { name: "근거 상세" })).toBeInTheDocument();
    expect(screen.getByText("CBC 원본")).toBeInTheDocument();
    expect(screen.getByText("이전")).toBeInTheDocument();
    expect(screen.getByText("현재")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "근거 상세 닫기" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps a review memo across module and patient changes, but isolates it by review window", async () => {
    const user = userEvent.setup();
    render(<CareWorkspace />);

    await user.click(screen.getByRole("button", { name: /CBC 결과 확인 근거/ }));
    const memo = screen.getByRole("textbox", { name: "검토 메모" });
    await user.type(memo, "다음 근무에 다시 확인");
    await user.click(screen.getByRole("button", { name: /간호기록/ }));
    await user.click(screen.getByRole("button", { name: /근무 준비/ }));
    await user.click(screen.getByRole("button", { name: /CBC 결과 확인 근거/ }));
    expect(screen.getByRole("textbox", { name: "검토 메모" })).toHaveValue("다음 근무에 다시 확인");

    await user.click(screen.getByRole("button", { name: /김영희/ }));
    await user.click(screen.getByRole("button", { name: /홍길동/ }));
    await user.click(screen.getByRole("button", { name: /CBC 결과 확인 근거/ }));
    expect(screen.getByRole("textbox", { name: "검토 메모" })).toHaveValue("다음 근무에 다시 확인");

    const reviewWindow = screen.getByRole("combobox", { name: "비교 기준 시각" });
    const alternateReviewWindow = reviewWindow.querySelectorAll("option")[1] as HTMLOptionElement;
    await user.selectOptions(reviewWindow, alternateReviewWindow.value);
    expect(screen.getByRole("textbox", { name: "검토 메모" })).toHaveValue("");
  });

  it("projects an explicitly added session note into the readonly record view", async () => {
    const user = userEvent.setup();
    render(<CareWorkspace />);

    await user.click(screen.getByRole("button", { name: /간호기록/ }));
    await user.click(screen.getByRole("button", { name: "기록 추가" }));
    expect(screen.getByRole("textbox", { name: "간호기록 입력" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: /환자 기록/ }));

    expect(screen.getByText("세션 메모")).toBeInTheDocument();
    expect(screen.getAllByText("이번 세션 추가").length).toBeGreaterThan(0);
  });
});
