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
  it("keeps shell copy concise while preserving the review boundary", async () => {
    const user = userEvent.setup();
    render(<CareWorkspace />);

    expect(screen.queryByText("WARD LIST")).not.toBeInTheDocument();
    expect(screen.queryByText(/SHIFT READINESS/)).not.toBeInTheDocument();
    expect(screen.queryByText("REVIEW WINDOW")).not.toBeInTheDocument();
    expect(screen.queryByText("근무 준비 결과가 준비되었습니다")).not.toBeInTheDocument();
    expect(screen.getByText("확인 = 읽음")).toBeInTheDocument();
    expect(screen.queryByText("이번 근무에서 먼저 확인할 변화")).not.toBeInTheDocument();

    const evidenceButton = screen.getByRole("button", { name: /CBC 결과 확인 근거/ });
    await user.click(evidenceButton);
    expect(screen.getByRole("heading", { name: "근거 상세" })).toBeInTheDocument();
    expect(screen.queryByText("SOURCE TRACE")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /환자 기록/ }));
    expect(screen.queryByText("PATIENT RECORDS / READ ONLY")).not.toBeInTheDocument();
    expect(screen.queryByText("SNAPSHOTS")).not.toBeInTheDocument();
  });

  it("keeps partial and no-baseline status feedback visible", () => {
    const scenario = getCareScenario("P001");
    const state = mockReadinessForScenario(scenario, [], scenario.reviewStartAt);
    mocks.useCareReadiness.mockImplementationOnce(() => ({
      ...state,
      response: { ...state.response, status: "partial", dataWarnings: ["일부 원본 구간"] },
    }));
    const { unmount } = render(<CareWorkspace />);
    expect(screen.getByText("일부 데이터만 확인했습니다")).toBeInTheDocument();
    expect(screen.getByText("일부 원본 구간")).toBeInTheDocument();
    unmount();

    mocks.useCareReadiness.mockImplementationOnce(() => ({
      ...state,
      response: { ...state.response, status: "no_baseline" },
    }));
    render(<CareWorkspace />);
    expect(screen.getAllByText("비교할 기준 기록이 없습니다").length).toBeGreaterThan(0);
  });

  it("keeps an available response warning visible without restoring the ready banner", () => {
    const scenario = getCareScenario("P001");
    const state = mockReadinessForScenario(scenario, [], scenario.reviewStartAt);
    mocks.useCareReadiness.mockImplementationOnce(() => ({
      ...state,
      response: { ...state.response, dataWarnings: ["원본 범위 안내"] },
    }));
    render(<CareWorkspace />);

    expect(screen.queryByText("근무 준비 결과가 준비되었습니다")).not.toBeInTheDocument();
    expect(screen.getAllByText("원본 범위 안내")).toHaveLength(1);
  });

  it("keeps loading, error, and stale status feedback actionable", () => {
    const scenario = getCareScenario("P001");
    const state = mockReadinessForScenario(scenario, [], scenario.reviewStartAt);
    mocks.useCareReadiness.mockImplementationOnce(() => ({
      ...state,
      response: null,
      status: "loading",
      stale: false,
    }));
    const { unmount } = render(<CareWorkspace />);
    expect(screen.getByText("최신 결과를 확인하고 있습니다")).toBeInTheDocument();
    unmount();

    mocks.useCareReadiness.mockImplementationOnce(() => ({
      ...state,
      response: null,
      status: "error",
      stale: false,
    }));
    render(<CareWorkspace />);
    expect(screen.getAllByText("최신 결과를 불러오지 못했습니다").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "다시 확인" }).length).toBeGreaterThan(0);
    unmount();

    mocks.useCareReadiness.mockImplementationOnce(() => ({ ...state, stale: true }));
    render(<CareWorkspace />);
    expect(screen.getByText("이전 결과를 표시하고 있습니다")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "다시 확인" }).length).toBeGreaterThan(0);
  });

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
