import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ShiftReadinessResponse,
} from "@/lib/shift-readiness-contracts";
import { createValidShiftReadinessResponse } from "@/test/shift-readiness-fixtures";

import type { ShiftReadinessSummaryPanelProps } from "./ShiftReadinessSummaryPanel";
import { ShiftReadinessSummaryPanel } from "./ShiftReadinessSummaryPanel";

function summaryProps(
  response: ShiftReadinessResponse | null,
  acknowledgedItemIds: readonly string[],
): ShiftReadinessSummaryPanelProps {
  return {
    response,
    acknowledgedItemIds,
    manualHandoverNote: "",
    status: "success",
    errorMessage: null,
    onManualHandoverNoteChange: vi.fn(),
    onNavigateToItem: vi.fn(),
    onRetry: vi.fn(),
  };
}

describe("ShiftReadinessSummaryPanel", () => {
  afterEach(() => cleanup());

  it("shows review progress without claiming task completion", () => {
    const response = createValidShiftReadinessResponse();
    render(<ShiftReadinessSummaryPanel {...summaryProps(response, [response.items[0]!.id, response.items[1]!.id])} />);

    expect(screen.getByText("2/7")).toBeVisible();
    expect(screen.getByText(/미확인 5/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "검토 완료" })).not.toBeInTheDocument();
    expect(screen.queryByText("원본 기록을 확인했습니다")).not.toBeInTheDocument();
  });

  it("shows deterministic metric counts from the response", () => {
    render(<ShiftReadinessSummaryPanel {...summaryProps(createValidShiftReadinessResponse(), [])} />);

    const metrics = screen.getByRole("region", { name: "근무 항목 지표" });
    expect(within(metrics).getByText("새 결과", { exact: true })).toBeVisible();
    expect(within(metrics).getAllByText("1건", { selector: "strong" })).toHaveLength(2);
    expect(within(metrics).getByText("이번 근무 예정", { exact: true })).toBeVisible();
    expect(within(metrics).getByText("결과 대기", { exact: true })).toBeVisible();
    expect(within(metrics).getByText("3건", { selector: "strong" })).toBeVisible();
  });

  it("renders a fixed source-backed brief without interpreting result values", () => {
    render(<ShiftReadinessSummaryPanel {...summaryProps(createValidShiftReadinessResponse(), [])} />);

    expect(screen.getByRole("heading", { name: "복귀 기간 요약" })).toBeVisible();
    const brief = screen.getByRole("region", { name: "기록 기반 요약" });
    expect(within(brief).getByText("현재 기록 변화", { exact: true })).toBeVisible();
    expect(within(brief).getByText("CBC 결과 확인", { exact: true })).toBeVisible();
    expect(within(brief).getByText(/원본 항목과 사실 상태를 기준으로 표시합니다/)).toBeVisible();
    expect(within(brief).queryByText(/Recommendation/)).not.toBeInTheDocument();
    expect(within(brief).queryByText(/WBC 12\.1/)).not.toBeInTheDocument();
  });

  it("provides unacknowledged quick links and navigates by item id", async () => {
    const user = userEvent.setup();
    const response = createValidShiftReadinessResponse();
    const props = summaryProps(response, [response.items[0]!.id]);
    render(<ShiftReadinessSummaryPanel {...props} />);

    const quickLinks = screen.getByRole("list", { name: "미확인 항목" });
    expect(within(quickLinks).getAllByRole("button")).toHaveLength(6);
    await user.click(within(quickLinks).getByRole("button", { name: /CBC 결과 확인/ }));
    expect(props.onNavigateToItem).toHaveBeenCalledWith("P001-investigation-CBC-new-result");
  });

  it("keeps the manual handover note session-only and emits changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ShiftReadinessSummaryPanel
        {...summaryProps(createValidShiftReadinessResponse(), [])}
        onManualHandoverNoteChange={onChange}
      />,
    );

    const note = screen.getByRole("textbox", { name: "인계 메모" });
    expect(screen.getByText("이 메모는 현재 세션에서만 유지됩니다.")).toBeVisible();
    fireEvent.change(note, { target: { value: "다음 근무 확인" } });
    expect(onChange).toHaveBeenCalledWith("다음 근무 확인");
  });

  it("preserves the manual note and distinguishes loading from an initial error", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(
      <ShiftReadinessSummaryPanel
        {...summaryProps(null, [])}
        status="loading"
        manualHandoverNote="세션 메모"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    expect(screen.getByRole("textbox", { name: "인계 메모" })).toHaveValue("세션 메모");
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
    expect(screen.queryByText("미확인 0건")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();

    rerender(
      <ShiftReadinessSummaryPanel
        {...summaryProps(null, [])}
        status="error"
        errorMessage="근무 준비 요약을 불러오지 못했습니다."
        manualHandoverNote="세션 메모"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했습니다");
    expect(screen.getByRole("textbox", { name: "인계 메모" })).toHaveValue("세션 메모");
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
    expect(screen.queryByText("미확인 0건")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("retains the previous summary while reporting a new error", () => {
    render(
      <ShiftReadinessSummaryPanel
        {...summaryProps(createValidShiftReadinessResponse(), [])}
        status="error"
        errorMessage="새 결과를 불러오지 못했습니다."
        manualHandoverNote="세션 메모"
      />,
    );

    expect(screen.getByRole("heading", { name: "복귀 기간 요약" })).toBeVisible();
    expect(screen.getByText("0/7")).toBeVisible();
    expect(screen.getByText("미확인 7건")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "기록 기반 요약" })).getByText("CBC 결과 확인", { exact: true })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("새 결과를 불러오지 못했습니다.");
    expect(screen.getByRole("textbox", { name: "인계 메모" })).toHaveValue("세션 메모");
  });

  it("keeps one live status region while refreshing a prior partial response", () => {
    const response = createValidShiftReadinessResponse();
    response.status = "partial";
    response.dataWarnings = ["일부 항목은 확인할 수 없습니다."];
    render(
      <ShiftReadinessSummaryPanel
        {...summaryProps(response, [])}
        status="loading"
      />,
    );

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    expect(screen.getByRole("status")).toHaveTextContent("부분 결과");
  });

  it("renders a no-items state without progress or completion semantics", () => {
    const response = createValidShiftReadinessResponse();
    response.status = "no_items";
    response.items = [];
    response.groups = {
      patientStatus: [],
      investigations: [],
      lineDevices: [],
      medications: [],
      communications: [],
    };
    response.metrics = {
      itemCount: 0,
      newResultCount: 0,
      scheduledThisShiftCount: 0,
      pendingResultCount: 0,
      domainCounts: {
        patient_status: 0,
        investigation: 0,
        line_device: 0,
        medication: 0,
        communication: 0,
      },
    };
    render(<ShiftReadinessSummaryPanel {...summaryProps(response, [])} />);

    const panel = screen.getByTestId("shift-readiness-summary-panel");
    expect(within(panel).getByRole("heading", { name: "표시 항목 없음" })).toBeVisible();
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
    expect(screen.queryByText("확인함", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("미확인 0건", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "검토 진행" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "근무 항목 지표" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "기록 기반 요약" })).not.toBeInTheDocument();
    expect(panel.querySelector(".shift-readiness-summary-progress-track")).not.toBeInTheDocument();
    expect(screen.queryByText(/완료|검토 완료|안전|악화|보고 필요/)).not.toBeInTheDocument();
  });
});
