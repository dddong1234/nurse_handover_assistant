import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ShiftReadinessResponse,
} from "@/lib/shift-readiness-contracts";
import { createValidShiftReadinessResponse } from "@/test/shift-readiness-fixtures";

import type { ShiftReadinessWorkspaceProps } from "./ShiftReadinessWorkspace";
import { ShiftReadinessWorkspace } from "./ShiftReadinessWorkspace";

function props(
  response: ShiftReadinessResponse | null,
  onToggle = vi.fn(),
  onOpen = vi.fn(),
): ShiftReadinessWorkspaceProps {
  return {
    response,
    status: "success",
    acknowledgedItemIds: [],
    errorMessage: null,
    onToggleAcknowledged: onToggle,
    onOpenEvidence: onOpen,
    onRetry: vi.fn(),
  };
}

function responseWithStatus(
  status: ShiftReadinessResponse["status"],
  overrides: Partial<ShiftReadinessResponse> = {},
): ShiftReadinessResponse {
  const response = createValidShiftReadinessResponse();
  return { ...response, status, ...overrides };
}

function emptyResponse(): ShiftReadinessResponse {
  const response = createValidShiftReadinessResponse();
  return {
    ...response,
    status: "no_items",
    items: [],
    groups: {
      patientStatus: [],
      investigations: [],
      lineDevices: [],
      medications: [],
      communications: [],
    },
    metrics: {
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
    },
  };
}

describe("ShiftReadinessWorkspace", () => {
  afterEach(() => cleanup());

  it("renders the five domains in the nurse-recalled handover order", () => {
    render(<ShiftReadinessWorkspace {...props(createValidShiftReadinessResponse())} />);

    expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual([
      expect.stringContaining("환자 상태"),
      expect.stringContaining("검사·결과"),
      expect.stringContaining("Line·Device"),
      expect.stringContaining("투약 변경"),
      expect.stringContaining("보고·확인"),
    ]);
  });

  it("presents each row as time, content, fact status, acknowledgement, and evidence", () => {
    render(<ShiftReadinessWorkspace {...props(createValidShiftReadinessResponse())} />);

    const row = screen.getByRole("article", { name: /CBC 결과 확인/ });
    const title = within(row).getByTestId("shift-readiness-item-title");
    const detail = within(row).getByText("CBC 결과가 기록되었습니다.");
    const time = within(row).getByRole("time");
    const status = within(row).getByText("새 결과 있음");
    const checkbox = within(row).getByRole("checkbox", { name: /CBC 결과 확인.*확인함/ });
    const evidence = within(row).getByRole("button", { name: /CBC 결과 확인.*근거 보기/ });

    const elements = [time, title, detail, status, checkbox, evidence];
    for (let index = 1; index < elements.length; index += 1) {
      expect(elements[index - 1].compareDocumentPosition(elements[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(row).getByText("근거 1건")).toBeVisible();
  });

  it("exposes headings and regions with stable item identifiers", () => {
    render(<ShiftReadinessWorkspace {...props(createValidShiftReadinessResponse())} />);

    const board = screen.getByRole("region", { name: "근무 준비" });
    expect(board).toHaveAttribute("aria-labelledby", "shift-readiness-title");
    expect(within(board).getByRole("heading", { name: "근무 준비" })).toHaveAttribute("id", "shift-readiness-title");

    const item = screen.getByRole("article", { name: /CBC 결과 확인/ });
    expect(item).toHaveAttribute("id", "shift-readiness-item-P001-investigation-CBC-new-result");
    expect(item).toHaveAttribute("aria-labelledby", "shift-readiness-item-title-P001-investigation-CBC-new-result");
    expect(within(item).getByTestId("shift-readiness-item-title")).toHaveAttribute(
      "id",
      "shift-readiness-item-title-P001-investigation-CBC-new-result",
    );
  });

  it("uses text statuses and renders empty domains without inventing items", () => {
    render(<ShiftReadinessWorkspace {...props(emptyResponse())} />);

    expect(screen.getAllByText("이번 근무에 표시할 항목 없음")).toHaveLength(6);
    expect(screen.queryByText("확인함")).not.toBeInTheDocument();
    expect(screen.queryByText(/새 결과 있음|이번 근무 예정|결과 대기|최근 변경/, { exact: false })).not.toBeInTheDocument();
  });

  it.each([
    ["available", "확인 가능한 근무 준비 항목"],
    ["no_baseline", "기준 기록 없음"],
    ["partial", "부분 결과"],
  ] as const)("announces the %s response state with visible text", (status, label) => {
    render(<ShiftReadinessWorkspace {...props(responseWithStatus(status))} />);
    if (status === "available") {
      expect(screen.getByTestId("shift-readiness-workspace")).toHaveAttribute("data-shift-readiness-status", status);
    } else {
      expect(screen.getByText(new RegExp(label))).toBeVisible();
    }
  });

  it("distinguishes loading from an initial error and provides retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(
      <ShiftReadinessWorkspace {...props(null)} status="loading" onRetry={onRetry} />,
    );
    const loadingRegion = screen.getByRole("region", { name: "근무 준비" });
    expect(loadingRegion).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();

    rerender(
      <ShiftReadinessWorkspace
        {...props(null)}
        status="error"
        errorMessage="근무 준비 정보를 불러오지 못했습니다."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했습니다");
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("retains the prior board while announcing an error", () => {
    render(
      <ShiftReadinessWorkspace
        {...props(createValidShiftReadinessResponse())}
        status="error"
        errorMessage="새 결과를 불러오지 못했습니다."
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("article", { name: /CBC 결과 확인/ })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("새 결과를 불러오지 못했습니다.");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeVisible();
  });

  it("keeps evidence opening and acknowledgement independent", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(<ShiftReadinessWorkspace {...props(createValidShiftReadinessResponse(), onToggle, onOpen)} />);

    const row = screen.getByRole("article", { name: /CBC 결과 확인/ });
    await user.click(within(row).getByRole("button", { name: /CBC 결과 확인.*근거 보기/ }));
    expect(onOpen).toHaveBeenCalledWith(
      "P001-investigation-CBC-new-result",
      0,
      expect.any(HTMLElement),
    );
    expect(onToggle).not.toHaveBeenCalled();

    await user.click(within(row).getByRole("checkbox", { name: /CBC 결과 확인.*확인함/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("P001-investigation-CBC-new-result");
  });

  it("marks acknowledged rows without changing their fact status", () => {
    render(
      <ShiftReadinessWorkspace
        {...props(createValidShiftReadinessResponse())}
        acknowledgedItemIds={["P001-investigation-CBC-new-result"]}
      />,
    );

    const row = screen.getByRole("article", { name: /CBC 결과 확인/ });
    expect(within(row).getByRole("checkbox", { name: /CBC 결과 확인.*확인함/ })).toBeChecked();
    expect(within(row).getByText("새 결과 있음")).toBeVisible();
  });

  it("keeps controls keyboard-native and reports contract errors for unknown group ids", async () => {
    const user = userEvent.setup();
    const response = createValidShiftReadinessResponse();
    response.groups = {
      ...response.groups,
      investigations: [...response.groups.investigations, "unknown-item-id"],
    };
    const onOpen = vi.fn();
    render(<ShiftReadinessWorkspace {...props(response, vi.fn(), onOpen)} />);

    expect(screen.getByRole("alert", { name: "응답 계약 오류" })).toHaveTextContent("unknown-item-id");
    const evidence = screen.getByRole("button", { name: /CBC 결과 확인.*근거 보기/ });
    evidence.focus();
    expect(evidence).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("does not claim completion, safety, deterioration, or automatic reporting", () => {
    render(<ShiftReadinessWorkspace {...props(createValidShiftReadinessResponse())} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("완료");
    expect(text).not.toContain("안전");
    expect(text).not.toContain("악화");
    expect(text).not.toContain("보고 필요");
    expect(text).not.toContain("Recommendation");
    expect(text).not.toContain("{\"items\"");
  });
});
