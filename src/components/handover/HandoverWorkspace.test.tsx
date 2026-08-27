import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { buildDemoWorkspaceData } from "@/lib/demo-adapter";
import type { HandoverApiResponse, HandoverStatus } from "@/lib/contracts";

import { HandoverWorkspace } from "./HandoverWorkspace";

function makeStatusResponse(status: HandoverStatus): HandoverApiResponse {
  const [response] = buildDemoWorkspaceData();
  if (!response) {
    throw new Error("데모 응답이 없습니다.");
  }

  const comparison = {
    ...response.comparison,
    patient: { ...response.comparison.patient, id: `STATUS-${status}` },
    status,
    dataWarnings: status === "partial" ? ["medications"] : [],
    changes: [],
    interval: {
      previousRecordedAt: status === "no_previous" ? null : response.comparison.interval.previousRecordedAt,
      currentRecordedAt: response.comparison.interval.currentRecordedAt,
    },
  };

  return {
    comparison,
    summary: {
      ...response.summary,
      evidenceIds: [],
      sections: {
        situation: [],
        background: [],
        assessment: [],
        recommendation: [],
      },
    },
  };
}

describe("HandoverWorkspace patient queue and comparison flow", () => {
  afterEach(cleanup);

  it("selects the first valid patient initially", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    const firstPatient = screen.getByRole("button", { name: /홍길동/ });
    expect(firstPatient).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("heading", { name: "홍길동" })).toBeInTheDocument();
  });

  it("updates patient identity and both comparison timestamps when another patient is selected", async () => {
    const user = userEvent.setup();
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    await user.click(screen.getByRole("button", { name: /김영희/ }));

    const context = screen.getByRole("region", { name: "환자 컨텍스트" });
    expect(within(context).getByRole("heading", { name: "김영희" })).toBeInTheDocument();
    expect(within(context).getByText("07/02 06:00")).toBeInTheDocument();
    expect(within(context).getByText("07/02 09:10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /김영희/ })).toHaveAttribute("aria-current", "true");
  });

  it("filters the queue live by patient name, patient ID, and room, with a useful no-results state", async () => {
    const user = userEvent.setup();
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);
    const search = screen.getByRole("searchbox", { name: "환자 검색" });

    await user.type(search, "김영희");
    expect(screen.getByRole("button", { name: /김영희/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /홍길동/ })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "p003");
    expect(screen.getByRole("button", { name: /박민수/ })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "205");
    expect(screen.getByRole("button", { name: /최수진/ })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "없는 환자");
    expect(screen.getByText("검색 결과가 없습니다.")).toBeInTheDocument();
    expect(screen.getByText(/이름, ID 또는 병실 번호를 확인하세요/)).toBeInTheDocument();
  });

  it("renders high-priority changes before medium and low changes", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    const priorities = screen.getAllByRole("article").map((card) =>
      within(card).getByText(/검토 우선순위/).textContent,
    );

    expect(priorities).toEqual([
      "검토 우선순위 높음",
      "검토 우선순위 높음",
      "검토 우선순위 보통",
      "검토 우선순위 보통",
      "검토 우선순위 보통",
      "검토 우선순위 보통",
      "검토 우선순위 보통",
      "검토 우선순위 보통",
      "검토 우선순위 낮음",
    ]);
  });

  it("selects another patient with the keyboard", async () => {
    const user = userEvent.setup();
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    const patient = screen.getByRole("button", { name: /김영희/ });
    patient.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("heading", { name: "김영희" })).toBeInTheDocument();
    expect(patient).toHaveAttribute("aria-current", "true");
  });

  it("keeps patient context, changes, and deterministic summary aligned after selection", async () => {
    const user = userEvent.setup();
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    await user.click(screen.getByRole("button", { name: /김영희/ }));

    const context = screen.getByRole("region", { name: "환자 컨텍스트" });
    expect(within(context).getByText("302호")).toBeInTheDocument();
    expect(within(context).getByText("P002")).toBeInTheDocument();
    expect(within(context).getByText("07/02 06:00")).toBeInTheDocument();
    expect(within(context).getByText("07/02 09:10")).toBeInTheDocument();

    const comparison = screen.getByRole("region", { name: "변화 검토" });
    expect(within(comparison).getByRole("heading", { name: "아세틸시스테인" })).toBeInTheDocument();
    expect(document.getElementById("evidence-medications-아세틸시스테인-1363b9db6619-added")).not.toBeNull();

    const summary = screen.getByRole("complementary", { name: "인수인계 초안" });
    expect(within(summary).getByText(/김영희\(P002\)/)).toBeInTheDocument();
  });

  it("exposes category and operation labels on each change card", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    const medicationCard = document.getElementById("evidence-medications-타세놀정-500mg-3abed59ec690-added");
    expect(medicationCard).not.toBeNull();
    expect(medicationCard).toHaveTextContent("투약");
    expect(medicationCard).toHaveTextContent("추가");
  });

  it("uses the visible search label as the accessible name", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    expect(screen.getByRole("searchbox", { name: "환자 검색" })).toBeInTheDocument();
  });

  it("does not present a ready comparison as a reviewed state", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    expect(screen.getAllByText("변화 검출").length).toBeGreaterThan(0);
    expect(screen.queryByText("미검토", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("미검토 변화", { exact: true })).not.toBeInTheDocument();
  });

  it("shows both values, field path, timestamps, and evidence ID for every change", () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) {
      throw new Error("데모 응답이 없습니다.");
    }

    render(<HandoverWorkspace data={[response]} />);

    for (const change of response.comparison.changes) {
      const card = document.getElementById(`evidence-${change.id}`);
      expect(card).not.toBeNull();
      expect(card).toHaveTextContent(change.evidence.fieldPath);
      expect(card).toHaveTextContent("07/02 07:00");
      expect(card).toHaveTextContent("07/02 09:00");
      expect(card).toHaveTextContent(change.id);
      expect(card).toHaveTextContent(change.previousValue === null ? "기록 없음" : String(change.previousValue));
      expect(card).toHaveTextContent(
        change.currentValue === null
          ? "기록 없음"
          : typeof change.currentValue === "object"
            ? `${change.currentValue.route} · ${change.currentValue.frequency}`
            : String(change.currentValue),
      );
    }
  });

  it.each([
    ["no_previous", "비교 데이터 없음"],
    ["no_changes", "두 기록 사이에서 검출된 변화가 없습니다."],
    ["partial", "데이터 부족으로 완전한 비교를 수행하지 못했습니다."],
  ] as const)("uses a distinct Korean message for %s", (status, message) => {
    render(<HandoverWorkspace data={[makeStatusResponse(status)]} />);

    expect(screen.getByRole("heading", { name: message })).toBeInTheDocument();

    if (status === "no_changes") {
      expect(screen.getByText("비교 기준 시각과 원본 기록을 확인하세요.")).toBeInTheDocument();
      expect(screen.queryByText("비교 기준 시각과 원본 기록을 확인했습니다.")).not.toBeInTheDocument();
    }
  });

  it("keeps the safety notice visible while reviewing the workspace", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    expect(screen.getAllByText("가상 데이터 · 의사결정 보조가 아님").length).toBeGreaterThan(0);
  });

  it("keeps the safety notice visible when comparison data is empty", () => {
    render(<HandoverWorkspace data={[]} />);

    expect(screen.getByText("가상 데이터 · 의사결정 보조가 아님")).toBeInTheDocument();
  });
});
