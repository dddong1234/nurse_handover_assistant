import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoWorkspaceData } from "@/lib/demo-adapter";
import type { HandoverApiResponse, HandoverStatus } from "@/lib/contracts";

import { HandoverWorkspace } from "./HandoverWorkspace";
import { SummaryPanel } from "./SummaryPanel";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  it("exposes one shift summary with the exact interval, total changes, and high-priority count", () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");

    render(<HandoverWorkspace data={[response]} />);

    const shiftSummary = screen.getByRole("region", { name: "이번 근무 변화" });
    expect(within(shiftSummary).getByRole("heading", { name: "이번 근무 변화" })).toBeInTheDocument();
    expect(shiftSummary).toHaveTextContent("07/02 07:00");
    expect(shiftSummary).toHaveTextContent("07/02 09:00");
    expect(shiftSummary).toHaveTextContent("총 9건");
    expect(shiftSummary).toHaveTextContent("중요 2건");
    expect(screen.getByRole("complementary", { name: "인계 검토" })).toBeInTheDocument();
  });

  it("hydrates the summary panel without a mismatch when evidence links repeat", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");

    const evidenceId = response.comparison.changes[0]?.id;
    if (!evidenceId) throw new Error("데모 근거가 없습니다.");
    let renderPhase: "server" | "client" = "server";
    const repeatedEvidenceIds = [evidenceId, evidenceId];
    Object.defineProperty(repeatedEvidenceIds, "map", {
      value: function map<T>(
        this: string[],
        callback: (value: string, index: number, array: string[]) => T,
      ) {
        const indexes = renderPhase === "server" ? [1, 0] : [0, 1];
        const mapped = new Map(indexes.map((index) => [
          index,
          callback(this[index]!, index, this),
        ]));
        return [mapped.get(0)!, mapped.get(1)!];
      },
    });
    const summary = {
      ...response.summary,
      sections: {
        ...response.summary.sections,
        situation: [{ text: "반복 근거 링크", evidenceIds: repeatedEvidenceIds }],
        background: [],
        assessment: [],
        recommendation: [],
      },
      evidenceIds: [evidenceId],
    };

    const panelProps = {
      comparison: response.comparison,
      summary,
      selectedEvidenceIds: [evidenceId],
      onToggleEvidence: vi.fn(),
      onEvidenceActivate: vi.fn(),
      recommendation: "",
      onRecommendationChange: vi.fn(),
      sourceConfirmed: false,
      onSourceConfirmedChange: vi.fn(),
      reviewed: false,
      onReviewComplete: vi.fn(),
    };
    const container = document.createElement("div");
    container.innerHTML = renderToString(<SummaryPanel {...panelProps} />);
    renderPhase = "client";
    document.body.appendChild(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot> | undefined;

    try {
      root = hydrateRoot(container, <SummaryPanel {...panelProps} />);
      await act(async () => undefined);

      expect(consoleError.mock.calls).toEqual([]);
    } finally {
      root?.unmount();
      consoleError.mockRestore();
      container.remove();
    }
  });

  it("hydrates the complete handover workspace without a mismatch", async () => {
    const data = buildDemoWorkspaceData();
    const container = document.createElement("div");
    container.innerHTML = renderToString(<HandoverWorkspace data={data} />);
    document.body.appendChild(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot> | undefined;

    try {
      root = hydrateRoot(container, <HandoverWorkspace data={data} />);
      await act(async () => undefined);

      expect(consoleError.mock.calls).toEqual([]);
    } finally {
      root?.unmount();
      consoleError.mockRestore();
      container.remove();
    }
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

    const summary = screen.getByRole("complementary", { name: "인계 검토" });
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

  it("keeps the fixture visible and announces the exact fallback when the compare request fails", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    render(
      <HandoverWorkspace
        data={[response]}
        recordPairs={{
          P001: {
            previous: { patient_id: "P001", updated_at: "2026-07-01T21:00:00+09:00" },
            current: { patient_id: "P001", updated_at: "2026-07-02T07:00:00+09:00" },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "홍길동" })).toBeInTheDocument();
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
  });

  it("settles a rejected compare after StrictMode replays an unchanged pair", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const data = [response];
    const pair = {
      previous: { patient_id: "P001", updated_at: "2026-07-01T21:00:00+09:00" },
      current: { patient_id: "P001", updated_at: "2026-07-02T07:00:00+09:00" },
    };
    const requests: Array<ReturnType<typeof createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>>> = [];
    const fetchMock = vi.fn().mockImplementation(() => {
      const request = createDeferred<{
        ok: boolean;
        status: number;
        json: () => Promise<unknown>;
      }>();
      requests.push(request);
      return request.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <StrictMode>
        <HandoverWorkspace data={data} recordPairs={{ P001: pair }} />
      </StrictMode>,
    );
    await screen.findByText("서버 요약을 불러오는 중입니다.");
    rerender(
      <StrictMode>
        <HandoverWorkspace data={data} recordPairs={{ P001: pair }} />
      </StrictMode>,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    requests.forEach((request) => {
      request.resolve({
        ok: false,
        status: 503,
        json: async () => ({ detail: "provider unavailable" }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.")).toBeInTheDocument();
    });
    expect(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" })).toBeEnabled();
  });

  it("replaces only the selected patient's response after a validated API success", async () => {
    const responses = buildDemoWorkspaceData();
    const first = responses[0];
    const second = responses[1];
    if (!first || !second) throw new Error("데모 응답이 없습니다.");
    const apiResponse = structuredClone(first);
    apiResponse.summary.sections.situation[0]!.text = "서버에서 확인한 P001 변화 요약";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(apiResponse),
    }));

    const user = userEvent.setup();
    render(
      <HandoverWorkspace
        data={responses}
        recordPairs={{
          P001: { previous: { patient_id: "P001" }, current: { patient_id: "P001" } },
          P002: { previous: { patient_id: "P002" }, current: { patient_id: "P002" } },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("서버에서 확인한 P001 변화 요약")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /김영희/ }));
    expect(within(screen.getByRole("complementary", { name: "인계 검토" })).getByText(/김영희\(P002\)/)).toBeInTheDocument();
    expect(screen.queryByText("서버에서 확인한 P001 변화 요약")).not.toBeInTheDocument();
  });

  it("toggles evidence inclusion without hiding change cards or summary facts", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    render(<HandoverWorkspace data={[response]} />);

    const cardsBefore = screen.getAllByRole("article").length;
    const coverageBefore = screen.getByLabelText("근거 포함률").textContent;
    const toggle = screen.getAllByRole("button", { name: /근거 .*포함됨/ })[0];
    if (!toggle) throw new Error("근거 토글이 없습니다.");
    await userEvent.setup().click(toggle);

    expect(screen.getAllByRole("article")).toHaveLength(cardsBefore);
    expect(screen.getByLabelText("근거 포함률").textContent).not.toBe(coverageBefore);
    expect(screen.getByText(response.summary.sections.situation[0]!.text)).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("focuses and highlights a change card when an evidence link is activated", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const user = userEvent.setup();
    render(<HandoverWorkspace data={[response]} />);

    const evidenceId = response.comparison.changes[0]!.id;
    const evidenceLink = screen.getAllByRole("link", { name: new RegExp(evidenceId.slice(0, 14)) })[0];
    if (!evidenceLink) throw new Error("근거 링크가 없습니다.");
    await user.click(evidenceLink);

    const card = document.getElementById(`evidence-${evidenceId}`);
    expect(card).not.toBeNull();
    expect(document.activeElement).toBe(card);
    expect(card).toHaveClass("is-evidence-focused");
    expect(card).toHaveAttribute("tabindex", "-1");
  });

  it("opens the matching evidence details when a summary evidence link is activated", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const user = userEvent.setup();
    render(<HandoverWorkspace data={[response]} />);

    const evidenceId = response.comparison.changes[0]!.id;
    const evidenceLink = screen.getAllByRole("link", { name: new RegExp(evidenceId.slice(0, 14)) })[0];
    if (!evidenceLink) throw new Error("근거 링크가 없습니다.");
    const card = document.getElementById(`evidence-${evidenceId}`);
    if (!card) throw new Error("근거 변화 카드가 없습니다.");
    const details = card.querySelector("details");
    if (!(details instanceof HTMLDetailsElement)) throw new Error("근거 상세 disclosure가 없습니다.");

    expect(details.open).toBe(false);
    await user.click(evidenceLink);

    await waitFor(() => {
      expect(document.activeElement).toBe(card);
      expect(details.open).toBe(true);
    });
    expect(within(card).getByText("근거 상세")).toBeInTheDocument();
  });

  it("keeps manual recommendations isolated per patient", async () => {
    const user = userEvent.setup();
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);
    const recommendation = screen.getByRole("textbox", { name: "간호사가 확인할 후속 항목" });

    await user.type(recommendation, "다음 교대에 확인할 항목");
    await user.click(screen.getByRole("button", { name: /김영희/ }));
    expect(screen.getByRole("textbox", { name: "간호사가 확인할 후속 항목" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: /홍길동/ }));
    expect(screen.getByRole("textbox", { name: "간호사가 확인할 후속 항목" })).toHaveValue("다음 교대에 확인할 항목");
  });

  it("gates review completion on source confirmation and sorts reviewed patients last", async () => {
    const user = userEvent.setup();
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    const checkbox = screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" });
    const reviewButton = screen.getByRole("button", { name: "검토 완료" });
    expect(reviewButton).toBeDisabled();

    await user.click(checkbox);
    expect(reviewButton).toBeEnabled();
    await user.click(reviewButton);

    expect(screen.getByText("검토 완료", { selector: ".queue-status" })).toBeInTheDocument();
    const queueItems = within(screen.getByRole("list", { name: "환자 목록" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(queueItems.at(-1)).toContain("홍길동");
  });

  it("restores evidence selection, confirmation, and review state when switching patients", async () => {
    const user = userEvent.setup();
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    const toggle = screen.getAllByRole("button", { name: /근거 .*포함됨/ })[0];
    if (!toggle) throw new Error("근거 토글이 없습니다.");
    await user.click(toggle);
    await user.click(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" }));
    await user.click(screen.getByRole("button", { name: "검토 완료" }));
    await user.click(screen.getByRole("button", { name: /김영희/ }));

    expect(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: /홍길동/ }));
    expect(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" })).toBeChecked();
    expect(screen.getAllByRole("button", { name: /근거 .*제외됨/ }).length).toBeGreaterThan(0);
  });

  it("locks recommendation and evidence inclusion after review while keeping evidence links navigable", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const user = userEvent.setup();
    render(<HandoverWorkspace data={[response]} />);

    const recommendation = screen.getByRole("textbox", { name: "간호사가 확인할 후속 항목" });
    await user.type(recommendation, "다음 교대에 확인할 항목");
    const toggle = screen.getAllByRole("button", { name: /근거 .*포함됨/ })[0];
    if (!toggle) throw new Error("근거 토글이 없습니다.");
    await user.click(toggle);
    const selectedStateBeforeReview = toggle.getAttribute("aria-pressed");

    await user.click(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" }));
    await user.click(screen.getByRole("button", { name: "검토 완료" }));

    expect(recommendation).toBeDisabled();
    expect(toggle).toBeDisabled();
    expect(recommendation).toHaveValue("다음 교대에 확인할 항목");
    expect(toggle).toHaveAttribute("aria-pressed", selectedStateBeforeReview);

    fireEvent.change(recommendation, { target: { value: "변경 시도" } });
    await user.click(toggle);
    expect(recommendation).toHaveValue("다음 교대에 확인할 항목");
    expect(toggle).toHaveAttribute("aria-pressed", selectedStateBeforeReview);

    const evidenceId = response.comparison.changes[0]!.id;
    const evidenceLink = screen.getAllByRole("link", { name: new RegExp(evidenceId.slice(0, 14)) })[0];
    if (!evidenceLink) throw new Error("근거 링크가 없습니다.");
    await user.click(evidenceLink);
    expect(document.getElementById(`evidence-${evidenceId}`)).toHaveClass("is-evidence-focused");
  });

  it("keeps review completion disabled and announces loading until the API request settles", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const request = createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(request.promise));
    const user = userEvent.setup();

    render(
      <HandoverWorkspace
        data={[response]}
        recordPairs={{
          P001: {
            previous: { patient_id: "P001", updated_at: "2026-07-02T07:00:00+09:00" },
            current: { patient_id: "P001", updated_at: "2026-07-02T09:00:00+09:00" },
          },
        }}
      />,
    );

    expect(await screen.findByText("서버 요약을 불러오는 중입니다.")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" });
    const reviewButton = screen.getByRole("button", { name: "검토 완료" });
    expect(checkbox).toBeDisabled();
    expect(reviewButton).toBeDisabled();

    request.resolve({
      ok: true,
      status: 200,
      json: async () => response,
    });
    await waitFor(() => {
      expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument();
    });
    expect(checkbox).toBeEnabled();
    await user.click(checkbox);
    expect(reviewButton).toBeEnabled();
  });

  it("preserves a reviewed API snapshot and avoids refetching when revisiting the patient", async () => {
    const responses = buildDemoWorkspaceData();
    const first = responses[0];
    const second = responses[1];
    if (!first || !second) throw new Error("데모 응답이 없습니다.");
    const reviewedServerResponse = structuredClone(first);
    reviewedServerResponse.summary.sections.situation[0]!.text = "검토 당시 서버 요약";
    const lateReplacement = structuredClone(first);
    lateReplacement.summary.sections.situation[0]!.text = "검토 후 재요청 요약";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(reviewedServerResponse) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(lateReplacement) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <HandoverWorkspace
        data={responses}
        recordPairs={{
          P001: { previous: { patient_id: "P001" }, current: { patient_id: "P001" } },
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("검토 당시 서버 요약")).toBeInTheDocument());
    await user.click(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" }));
    await user.click(screen.getByRole("button", { name: "검토 완료" }));
    await user.click(screen.getByRole("button", { name: /김영희/ }));
    await user.click(screen.getByRole("button", { name: /홍길동/ }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("검토 당시 서버 요약")).toBeInTheDocument();
    expect(screen.queryByText("검토 후 재요청 요약")).not.toBeInTheDocument();
    expect(screen.getByText("검토 완료", { selector: ".queue-status" })).toBeInTheDocument();
  });

  it("keeps a settled fallback pair cached when revisiting the patient", async () => {
    const responses = buildDemoWorkspaceData();
    const first = responses[0];
    const second = responses[1];
    if (!first || !second) throw new Error("데모 응답이 없습니다.");
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <HandoverWorkspace
        data={responses}
        recordPairs={{
          P001: { previous: { patient_id: "P001" }, current: { patient_id: "P001" } },
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /김영희/ }));
    await user.click(screen.getByRole("button", { name: /홍길동/ }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.")).toBeInTheDocument();
  });

  it("clears a prior API override before showing the immutable fixture after a changed-pair failure", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const fixtureText = response.summary.sections.situation[0]!.text;
    const serverResponse = structuredClone(response);
    serverResponse.summary.sections.situation[0]!.text = "이전 성공 서버 요약";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(serverResponse) })
      .mockRejectedValueOnce(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    const firstPair = { previous: { patient_id: "P001" }, current: { patient_id: "P001", updated_at: "first" } };
    const changedPair = { previous: { patient_id: "P001" }, current: { patient_id: "P001", updated_at: "second" } };
    const { rerender } = render(<HandoverWorkspace data={[response]} recordPairs={{ P001: firstPair }} />);

    await waitFor(() => expect(screen.getByText("이전 성공 서버 요약")).toBeInTheDocument());
    rerender(<HandoverWorkspace data={[response]} recordPairs={{ P001: changedPair }} />);

    await waitFor(() => {
      expect(screen.getByText("서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.")).toBeInTheDocument();
    });
    expect(screen.getByText(fixtureText)).toBeInTheDocument();
    expect(screen.queryByText("이전 성공 서버 요약")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("locks editing immediately when the selected patient receives a replacement pair", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const secondRequest = createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(response) })
      .mockReturnValueOnce(secondRequest.promise);
    vi.stubGlobal("fetch", fetchMock);
    const firstPair = { previous: { patient_id: "P001" }, current: { patient_id: "P001", updated_at: "first" } };
    const changedPair = { previous: { patient_id: "P001" }, current: { patient_id: "P001", updated_at: "second" } };
    const { rerender } = render(<HandoverWorkspace data={[response]} recordPairs={{ P001: firstPair }} />);
    await waitFor(() => expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument());

    rerender(<HandoverWorkspace data={[response]} recordPairs={{ P001: changedPair }} />);
    const recommendation = screen.getByRole("textbox", { name: "간호사가 확인할 후속 항목" });
    const toggle = screen.getAllByRole("button", { name: /근거 .*포함됨/ })[0];
    if (!toggle) throw new Error("근거 토글이 없습니다.");
    expect(screen.getByText("서버 요약을 불러오는 중입니다.")).toBeInTheDocument();
    expect(recommendation).toBeDisabled();
    expect(toggle).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "검토 완료" })).toBeDisabled();

    secondRequest.resolve({
      ok: true,
      status: 200,
      json: async () => response,
    });
    await waitFor(() => expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument());
    expect(recommendation).toBeEnabled();
    expect(toggle).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" })).toBeEnabled();
  });

  it("ignores a late response from the aborted patient request after switching patients", async () => {
    const responses = buildDemoWorkspaceData();
    const first = responses[0];
    const second = responses[1];
    if (!first || !second) throw new Error("데모 응답이 없습니다.");
    const oldResponse = structuredClone(first);
    oldResponse.summary.sections.situation[0]!.text = "늦게 도착한 이전 환자 요약";
    const currentResponse = structuredClone(second);
    currentResponse.summary.sections.situation[0]!.text = "현재 환자 서버 요약";
    const oldRequest = createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(currentResponse) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <HandoverWorkspace
        data={responses}
        recordPairs={{
          P001: { previous: { patient_id: "P001" }, current: { patient_id: "P001" } },
          P002: { previous: { patient_id: "P002" }, current: { patient_id: "P002" } },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /김영희/ }));
    await waitFor(() => expect(screen.getByText("현재 환자 서버 요약")).toBeInTheDocument());

    oldRequest.resolve({
      ok: true,
      status: 200,
      json: async () => oldResponse,
    });
    await waitFor(() => {
      expect(screen.getByText("현재 환자 서버 요약")).toBeInTheDocument();
      expect(screen.queryByText("늦게 도착한 이전 환자 요약")).not.toBeInTheDocument();
    });
  });
});
