import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoWorkspaceData } from "@/lib/demo-adapter";
import type { HandoverApiResponse, HandoverStatus } from "@/lib/contracts";
import { demoRecordPairs } from "@/lib/demo-records";
import { persistRecordDraft, RECORD_DRAFTS_STORAGE_KEY } from "@/lib/record-drafts";

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
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("selects the first valid patient initially", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    const firstPatient = screen.getByRole("button", { name: /홍길동/ });
    expect(firstPatient).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("heading", { name: "홍길동" })).toBeInTheDocument();
  });

  it("renders the approved clinical shell labels without unsupported modules", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    expect(screen.getByText("NURSE HANDOVER", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("SHIFT REVIEW", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("일반병동 · DAY 07:00–15:00", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("RN · 근무중", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "담당 환자" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "인수인계 비교" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "원본 기록" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "인계 검토" })).toBeInTheDocument();

    expect(screen.queryByText("투약(MAR)", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("I&O", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("실시간 연결", { exact: true })).not.toBeInTheDocument();
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

  it("uses compact clinical Situation text in the checked-in fixture", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    expect(screen.getByText("홍길동(P001) · 301호 · 07/02 07:00 → 09:00 · 변화 9건", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/2026-07-02T07:00:00\+09:00/)).not.toBeInTheDocument();
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

  it("hydrates a persisted full-record draft before rendering or requesting a comparison", async () => {
    const responses = buildDemoWorkspaceData();
    const response = responses[0];
    const pair = demoRecordPairs.P001;
    if (!response || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const draft = structuredClone(pair.current);
    draft.vitals.body_temperature = 39.1;
    persistRecordDraft(window.sessionStorage, draft);

    const draftResponse = structuredClone(response);
    draftResponse.summary.sections.situation[0]!.text = "저장된 초안 비교 결과";
    const requestBodies: Array<{ current: { vitals: Record<string, number> } }> = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { current: { vitals: Record<string, number> } };
      requestBodies.push(body);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => draftResponse,
      });
    }));

    render(<HandoverWorkspace data={responses} recordPairs={{ P001: pair }} />);

    expect(screen.getByRole("heading", { name: "환자 기록을 불러오는 중입니다." })).toBeInTheDocument();
    expect(screen.queryByText(response.summary.sections.situation[0]!.text, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("저장된 초안 비교 결과")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("저장된 초안 비교 결과")).toBeInTheDocument());
    expect(requestBodies.some(({ current }) => current.vitals.body_temperature === 38.2)).toBe(false);
    expect(requestBodies.some(({ current }) => current.vitals.body_temperature === 39.1)).toBe(true);
  });

  it("ignores a persisted draft whose patient identity does not match the bundled record", async () => {
    const responses = buildDemoWorkspaceData();
    const response = responses[0];
    const pair = demoRecordPairs.P001;
    if (!response || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const mismatchedDraft = structuredClone(pair.current);
    mismatchedDraft.name = "김영희";
    mismatchedDraft.vitals.body_temperature = 39.1;
    persistRecordDraft(window.sessionStorage, mismatchedDraft);

    const requestBodies: Array<{ current: { vitals: Record<string, number> } }> = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_input, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        current: { vitals: Record<string, number> };
      };
      requestBodies.push(body);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => response,
      });
    }));

    render(<HandoverWorkspace data={responses} recordPairs={{ P001: pair }} />);

    await waitFor(() => expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument());
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]?.current.vitals.body_temperature).toBe(38.2);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    expect(within(recordPanel).getByRole("textbox", { name: "이름" })).toHaveValue("홍길동");
    expect(within(recordPanel).getByRole("spinbutton", { name: "체온" })).toHaveValue(38.2);
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

  it("removes portfolio disclaimer chrome while reviewing the workspace", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    const retiredSafetyNotice = ["가상 데이터", "의사결정 보조가 아님"].join(" · ");
    const retiredUtilityContext = ["일반 성인병동", "교대 검토"].join(" · ");
    expect(screen.queryByText(retiredSafetyNotice, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(retiredUtilityContext, { exact: true })).not.toBeInTheDocument();
  });

  it("does not add portfolio disclaimer chrome to the empty state", () => {
    render(<HandoverWorkspace data={[]} />);

    const retiredSafetyNotice = ["가상 데이터", "의사결정 보조가 아님"].join(" · ");
    expect(screen.queryByText(retiredSafetyNotice, { exact: true })).not.toBeInTheDocument();
  });

  it("shows clinician-facing source labels and maps AI fallback warning codes", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const aiResponse = structuredClone(response);
    aiResponse.summary.mode = "ai";
    aiResponse.summary.warnings = ["AI_FALLBACK_USED"];

    const deterministicResponse = structuredClone(response);
    deterministicResponse.comparison.patient.id = "P001-RULE";
    deterministicResponse.summary.warnings = ["AI_KEY_UNAVAILABLE"];

    render(<HandoverWorkspace data={[aiResponse, deterministicResponse]} />);

    expect(screen.getByText("AI 요약", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("AI 요약을 사용할 수 없어 규칙 요약을 표시합니다.", { exact: true })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /P001-RULE/ }));
    expect(screen.getByText("규칙 요약", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("AI 연결 정보가 없어 규칙 요약을 표시합니다.", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("AI_FALLBACK_USED", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("AI_KEY_UNAVAILABLE", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps unknown summary warnings readable without exposing machine identifiers", () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const warningResponse = structuredClone(response);
    warningResponse.summary.warnings = ["current.medications"];

    render(<HandoverWorkspace data={[warningResponse]} />);

    expect(screen.getByText("일부 원본 항목을 확인해야 합니다.", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("current.medications", { exact: true })).not.toBeInTheDocument();
  });

  it("renders medication summaries in clinician-facing wording instead of raw JSON", () => {
    render(<HandoverWorkspace data={buildDemoWorkspaceData()} />);

    expect(screen.getByText("투약 추가: 타세놀정 500mg · PO · TID", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/\{"frequency"/)).not.toBeInTheDocument();
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
    const summary = screen.getByRole("complementary", { name: "인계 검토" });
    const disclosure = within(summary).getByRole("button", { name: "근거 9건" });
    await userEvent.setup().click(disclosure);
    const toggle = within(summary).getAllByRole("button", { name: /근거 .*포함됨/ })[0];
    if (!toggle) throw new Error("근거 토글이 없습니다.");
    await userEvent.setup().click(toggle);

    expect(screen.getAllByRole("article")).toHaveLength(cardsBefore);
    expect(screen.getByLabelText("근거 포함률").textContent).not.toBe(coverageBefore);
    expect(screen.getByText(response.summary.sections.situation[0]!.text)).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps summary evidence collapsed behind a labelled native disclosure", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const user = userEvent.setup();
    const evidenceId = response.comparison.changes[0]!.id;

    render(<HandoverWorkspace data={[response]} />);

    const summary = screen.getByRole("complementary", { name: "인계 검토" });
    const situationElement = within(summary).getByText(response.summary.sections.situation[0]!.text).closest(".summary-item");
    if (!(situationElement instanceof HTMLElement)) throw new Error("Situation 요약 항목이 없습니다.");
    const situation = situationElement;
    const disclosure = within(situation).getByRole("button", { name: "근거 9건" });
    const details = disclosure.closest("details");
    if (!(details instanceof HTMLDetailsElement)) throw new Error("근거 disclosure가 없습니다.");

    expect(details.open).toBe(false);
    expect(within(summary).queryByText(evidenceId)).not.toBeInTheDocument();
    expect(within(details).getByRole("link", { name: /근거 1/ })).toBeInTheDocument();

    await user.click(disclosure);

    expect(details.open).toBe(true);
    expect(within(situation).getByRole("link", { name: /근거 1/ })).toBeVisible();
    expect(within(situation).getByRole("button", { name: new RegExp(evidenceId) })).toBeVisible();
  });

  it("focuses and highlights a change card when an evidence link is activated", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const user = userEvent.setup();
    render(<HandoverWorkspace data={[response]} />);

    const evidenceId = response.comparison.changes[0]!.id;
    const summary = screen.getByRole("complementary", { name: "인계 검토" });
    const situation = within(summary).getByRole("region", { name: "Situation" });
    const disclosure = within(situation).getByRole("button", { name: "근거 9건" });
    await user.click(disclosure);
    const details = disclosure.closest("details");
    if (!(details instanceof HTMLDetailsElement)) throw new Error("근거 disclosure가 없습니다.");
    const evidenceLink = within(details).getByRole("link", { name: /^근거 1/ });
    if (!evidenceLink) throw new Error("근거 링크가 없습니다.");
    await user.click(evidenceLink);

    const card = document.getElementById(`evidence-${evidenceId}`);
    expect(card).not.toBeNull();
    expect(document.activeElement).toBe(card);
    expect(card).toHaveClass("is-evidence-focused");
    expect(card).toHaveAttribute("tabindex", "-1");
  });

  it("refocuses the same change card when its evidence link is activated again after focus moves away", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const user = userEvent.setup();
    render(<HandoverWorkspace data={[response]} />);

    const evidenceId = response.comparison.changes[0]!.id;
    const summary = screen.getByRole("complementary", { name: "인계 검토" });
    const situation = within(summary).getByRole("region", { name: "Situation" });
    await user.click(within(situation).getByRole("button", { name: "근거 9건" }));
    const summaryEvidenceDetails = within(situation).getByRole("button", { name: "근거 9건" }).closest("details");
    if (!(summaryEvidenceDetails instanceof HTMLDetailsElement)) throw new Error("근거 disclosure가 없습니다.");
    const card = document.getElementById(`evidence-${evidenceId}`);
    if (!card) throw new Error("근거 변화 카드가 없습니다.");

    await user.click(within(summaryEvidenceDetails).getByRole("link", { name: /^근거 1/ }));
    await waitFor(() => expect(document.activeElement).toBe(card));

    await user.click(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" }));
    expect(document.activeElement).not.toBe(card);
    expect(card).toHaveClass("is-evidence-focused");

    await user.click(within(summaryEvidenceDetails).getByRole("link", { name: /^근거 1/ }));
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(card).toHaveClass("is-evidence-focused");
  });

  it("opens the matching evidence details when a summary evidence link is activated", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const user = userEvent.setup();
    render(<HandoverWorkspace data={[response]} />);

    const evidenceId = response.comparison.changes[0]!.id;
    const summary = screen.getByRole("complementary", { name: "인계 검토" });
    const situation = within(summary).getByRole("region", { name: "Situation" });
    await user.click(within(situation).getByRole("button", { name: "근거 9건" }));
    const summaryEvidenceDetails = within(situation).getByRole("button", { name: "근거 9건" }).closest("details");
    if (!(summaryEvidenceDetails instanceof HTMLDetailsElement)) throw new Error("근거 disclosure가 없습니다.");
    const evidenceLink = within(summaryEvidenceDetails).getByRole("link", { name: /^근거 1/ });
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

    const summary = screen.getByRole("complementary", { name: "인계 검토" });
    const situation = within(summary).getByRole("region", { name: "Situation" });
    await user.click(within(situation).getByRole("button", { name: "근거 9건" }));
    const toggle = within(situation).getAllByRole("button", { name: /근거 .*포함됨/ })[0];
    if (!toggle) throw new Error("근거 토글이 없습니다.");
    await user.click(toggle);
    await user.click(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" }));
    await user.click(screen.getByRole("button", { name: "검토 완료" }));
    await user.click(screen.getByRole("button", { name: /김영희/ }));

    expect(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: /홍길동/ }));
    expect(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" })).toBeChecked();
    const restoredSummary = screen.getByRole("complementary", { name: "인계 검토" });
    const restoredSituation = within(restoredSummary).getByRole("region", { name: "Situation" });
    await user.click(within(restoredSituation).getByRole("button", { name: "근거 9건" }));
    expect(within(restoredSituation).getAllByRole("button", { name: /근거 .*제외됨/ }).length).toBeGreaterThan(0);
  });

  it("locks recommendation and evidence inclusion after review while keeping evidence links navigable", async () => {
    const [response] = buildDemoWorkspaceData();
    if (!response) throw new Error("데모 응답이 없습니다.");
    const user = userEvent.setup();
    render(<HandoverWorkspace data={[response]} />);

    const recommendation = screen.getByRole("textbox", { name: "간호사가 확인할 후속 항목" });
    await user.type(recommendation, "다음 교대에 확인할 항목");
    const summary = screen.getByRole("complementary", { name: "인계 검토" });
    const situation = within(summary).getByRole("region", { name: "Situation" });
    await user.click(within(situation).getByRole("button", { name: "근거 9건" }));
    const toggle = within(situation).getAllByRole("button", { name: /근거 .*포함됨/ })[0];
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
    const details = within(situation).getByRole("button", { name: "근거 9건" }).closest("details");
    if (!(details instanceof HTMLDetailsElement)) throw new Error("근거 disclosure가 없습니다.");
    const evidenceLink = within(details).getByRole("link", { name: /^근거 1/ });
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

  it.each(["compare", "reset"] as const)(
    "locks review mutations while an inline record %s is pending",
    async (recordAction) => {
      const [response] = buildDemoWorkspaceData();
      const pair = demoRecordPairs.P001;
      if (!response || !pair) throw new Error("P001 데모 응답이 없습니다.");
      const recordRequest = createDeferred<{
        ok: boolean;
        status: number;
        json: () => Promise<unknown>;
      }>();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(response),
        })
        .mockReturnValueOnce(recordRequest.promise);
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      render(<HandoverWorkspace data={[response]} recordPairs={{ P001: pair }} />);
      await waitFor(() => expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument());

      const recommendation = screen.getByRole("textbox", { name: "간호사가 확인할 후속 항목" }) as HTMLTextAreaElement;
      await user.type(recommendation, "기존 후속 항목");
      const summary = screen.getByRole("complementary", { name: "인계 검토" });
      const situation = within(summary).getByRole("region", { name: "Situation" });
      await user.click(within(situation).getByRole("button", { name: "근거 9건" }));
      const evidenceToggle = within(situation).getAllByRole("button", { name: /근거 .*포함됨/ })[0] as HTMLButtonElement | undefined;
      if (!evidenceToggle) throw new Error("근거 토글이 없습니다.");
      const sourceConfirmed = screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" }) as HTMLInputElement;
      await user.click(sourceConfirmed);

      await user.click(screen.getByRole("tab", { name: "원본 기록" }));
      const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
      await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
      if (recordAction === "compare") {
        const temperature = within(recordPanel).getByRole("spinbutton", { name: "체온" });
        await user.clear(temperature);
        await user.type(temperature, "39.1");
        await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));
      } else {
        await user.click(within(recordPanel).getByRole("button", { name: "초기화" }));
      }
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      const reviewButton = screen.getByRole("button", { name: "검토 완료" }) as HTMLButtonElement;
      fireEvent.change(recommendation, { target: { value: "변경 시도" } });
      await user.click(sourceConfirmed);
      await user.click(sourceConfirmed);
      await user.click(evidenceToggle);
      await user.click(reviewButton);

      const pendingState = {
        recommendation: recommendation.value,
        sourceConfirmed: sourceConfirmed.checked,
        evidenceIncluded: evidenceToggle.getAttribute("aria-pressed"),
        recommendationDisabled: recommendation.disabled,
        sourceConfirmedDisabled: sourceConfirmed.disabled,
        evidenceToggleDisabled: evidenceToggle.disabled,
        reviewButtonDisabled: reviewButton.disabled,
        reviewed: Boolean(screen.queryByText("검토 완료", { selector: ".queue-status" })),
      };

      recordRequest.resolve({
        ok: true,
        status: 200,
        json: async () => response,
      });

      expect(pendingState).toEqual({
        recommendation: "기존 후속 항목",
        sourceConfirmed: true,
        evidenceIncluded: "true",
        recommendationDisabled: true,
        sourceConfirmedDisabled: true,
        evidenceToggleDisabled: true,
        reviewButtonDisabled: true,
        reviewed: false,
      });
    },
  );

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
    const summary = screen.getByRole("complementary", { name: "인계 검토" });
    const situation = within(summary).getByRole("region", { name: "Situation" });
    await userEvent.setup().click(within(situation).getByRole("button", { name: "근거 9건" }));
    const toggle = within(situation).getAllByRole("button", { name: /근거 .*포함됨/ })[0];
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

  it("ignores a stale automatic comparison after a newer manual comparison starts", async () => {
    const responses = buildDemoWorkspaceData();
    const initialResponse = responses[0];
    const pair = demoRecordPairs.P001;
    if (!initialResponse || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const staleResponse = structuredClone(initialResponse);
    staleResponse.summary.sections.situation[0]!.text = "자동 비교의 늦은 응답";
    const manualResponse = structuredClone(initialResponse);
    manualResponse.summary.sections.situation[0]!.text = "수동 비교의 최신 응답";
    const automaticRequest = createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>();
    const manualRequest = createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(automaticRequest.promise)
      .mockReturnValueOnce(manualRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(<HandoverWorkspace data={responses} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(recordPanel).getByRole("button", { name: "초기화" })).toBeDisabled();
    expect(within(recordPanel).getByRole("button", { name: "비교 중" })).toBeDisabled();

    automaticRequest.resolve({
      ok: true,
      status: 200,
      json: async () => staleResponse,
    });
    await act(async () => {
      await automaticRequest.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText("자동 비교의 늦은 응답")).not.toBeInTheDocument();
    });

    manualRequest.resolve({
      ok: true,
      status: 200,
      json: async () => manualResponse,
    });
    await waitFor(() => expect(screen.getByText("수동 비교의 최신 응답")).toBeInTheDocument());
  });

  it("unlocks the retained snapshot when a manual comparison fails after invalidating an automatic request", async () => {
    const responses = buildDemoWorkspaceData();
    const initialResponse = responses[0];
    const pair = demoRecordPairs.P001;
    if (!initialResponse || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const staleResponse = structuredClone(initialResponse);
    staleResponse.summary.sections.situation[0]!.text = "무효화된 자동 비교 응답";
    const retryResponse = structuredClone(initialResponse);
    retryResponse.summary.sections.situation[0]!.text = "재시도 비교 성공";
    const automaticRequest = createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>();
    const retryRequest = createDeferred<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(automaticRequest.promise)
      .mockRejectedValueOnce(new Error("manual network failure"))
      .mockReturnValueOnce(retryRequest.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(<HandoverWorkspace data={responses} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));

    await waitFor(() => {
      expect(within(recordPanel).getByText("비교하지 못했습니다. 기록을 확인한 뒤 다시 시도하세요.")).toBeInTheDocument();
    });
    expect(within(recordPanel).getByRole("button", { name: "변경사항 비교" })).toBeEnabled();
    expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument();

    automaticRequest.resolve({
      ok: true,
      status: 200,
      json: async () => staleResponse,
    });
    await act(async () => {
      await automaticRequest.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("무효화된 자동 비교 응답")).not.toBeInTheDocument();

    await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    retryRequest.resolve({
      ok: true,
      status: 200,
      json: async () => retryResponse,
    });
    await waitFor(() => expect(screen.getByText("재시도 비교 성공")).toBeInTheDocument());
  });

  it("opens the selected fictional chart and applies a successful edited comparison", async () => {
    const responses = buildDemoWorkspaceData();
    const initialResponse = responses[0];
    const pair = demoRecordPairs.P001;
    if (!initialResponse || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const serverResponse = structuredClone(initialResponse);
    serverResponse.summary.sections.situation[0]!.text = "편집된 체온 39.1 서버 요약";
    const temperatureChange = serverResponse.comparison.changes.find(
      (change) => change.evidence.fieldPath === "vitals.body_temperature",
    );
    if (!temperatureChange) throw new Error("체온 변화 근거가 없습니다.");
    temperatureChange.currentValue = 39.1;
    temperatureChange.delta = 1.2;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(initialResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HandoverWorkspace data={responses} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument());
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(serverResponse),
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(recordPanel).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");
    await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));

    await waitFor(() => expect(screen.getByText("편집된 체온 39.1 서버 요약")).toBeInTheDocument());
    const temperatureCard = document.getElementById("evidence-vitals-body_temperature-modified");
    if (!temperatureCard) throw new Error("체온 변화 카드가 없습니다.");
    expect(within(temperatureCard).getByText("39.1", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("편집된 체온 39.1 서버 요약", { exact: true })).toHaveTextContent("39.1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      current: { patient_id: string; vitals: Record<string, number> };
    };
    expect(requestBody.current.patient_id).toBe("P001");
    expect(requestBody.current.vitals.body_temperature).toBe(39.1);
    expect(screen.queryByRole("dialog", { name: /홍길동/ })).not.toBeInTheDocument();

    const storedDrafts = JSON.parse(window.sessionStorage.getItem(RECORD_DRAFTS_STORAGE_KEY) ?? "{}");
    expect(storedDrafts.P001.vitals.body_temperature).toBe(39.1);
    expect(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" })).not.toBeChecked();
  });

  it("keeps the last verified comparison and open draft when edited comparison fails", async () => {
    const responses = buildDemoWorkspaceData();
    const initialResponse = responses[0];
    const pair = demoRecordPairs.P001;
    if (!initialResponse || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const verifiedResponse = structuredClone(initialResponse);
    verifiedResponse.summary.sections.situation[0]!.text = "마지막 검증 비교 결과";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(verifiedResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HandoverWorkspace data={responses} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(screen.getByText("마지막 검증 비교 결과")).toBeInTheDocument());
    fetchMock.mockClear();
    fetchMock.mockRejectedValueOnce(new Error("network"));

    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(recordPanel).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");
    await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));

    await waitFor(() => expect(within(recordPanel).getByRole("alert")).toHaveTextContent("비교하지 못했습니다. 기록을 확인한 뒤 다시 시도하세요."));
    expect(screen.getByText("마지막 검증 비교 결과")).toBeInTheDocument();
    expect(within(recordPanel).getByRole("spinbutton", { name: "체온" })).toHaveValue(39.1);
    expect(window.sessionStorage.getItem(RECORD_DRAFTS_STORAGE_KEY)).toBeNull();
  });

  it("restores the bundled patient record and clears its session draft", async () => {
    const responses = buildDemoWorkspaceData();
    const initialResponse = responses[0];
    const pair = demoRecordPairs.P001;
    if (!initialResponse || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const seededDraft = structuredClone(pair.current);
    seededDraft.vitals.body_temperature = 39.1;
    persistRecordDraft(window.sessionStorage, seededDraft);
    const resetResponse = structuredClone(initialResponse);
    resetResponse.summary.sections.situation[0]!.text = "초기화된 번들 비교 결과";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(initialResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(resetResponse),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<HandoverWorkspace data={responses} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    expect(within(recordPanel).getByRole("spinbutton", { name: "체온" })).toHaveValue(39.1);
    await user.click(within(recordPanel).getByRole("button", { name: "초기화" }));

    await waitFor(() => expect(within(recordPanel).getByRole("spinbutton", { name: "체온" })).toHaveValue(38.2));
    const storedDrafts = JSON.parse(window.sessionStorage.getItem(RECORD_DRAFTS_STORAGE_KEY) ?? "{}");
    expect(storedDrafts.P001).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const resetRequestBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string) as {
      current: { vitals: Record<string, number> };
    };
    expect(resetRequestBody.current.vitals.body_temperature).toBe(38.2);
    expect(screen.getByText("초기화된 번들 비교 결과")).toBeInTheDocument();
  });

  it("keeps the applied comparison, reviewed session, and unsaved form when reset comparison fails", async () => {
    const responses = buildDemoWorkspaceData();
    const initialResponse = responses[0];
    const pair = demoRecordPairs.P001;
    if (!initialResponse || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const verifiedResponse = structuredClone(initialResponse);
    verifiedResponse.summary.sections.situation[0]!.text = "초기 검증 결과";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(verifiedResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HandoverWorkspace data={responses} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(screen.getByText("초기 검증 결과")).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" }));
    await user.click(screen.getByRole("button", { name: "검토 완료" }));
    expect(screen.getByText("검토 완료", { selector: ".queue-status" })).toBeInTheDocument();

    fetchMock.mockClear();
    fetchMock.mockRejectedValueOnce(new Error("reset failure"));
    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(recordPanel).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");
    await user.click(within(recordPanel).getByRole("button", { name: "초기화" }));

    await waitFor(() => expect(within(recordPanel).getByRole("alert")).toHaveTextContent("비교하지 못했습니다. 기록을 확인한 뒤 다시 시도하세요."));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      current: { vitals: Record<string, number> };
    };
    expect(requestBody.current.vitals.body_temperature).toBe(38.2);
    expect(screen.getByText("초기 검증 결과")).toBeInTheDocument();
    expect(screen.getByText("검토 완료", { selector: ".queue-status" })).toBeInTheDocument();
    expect(within(recordPanel).getByRole("spinbutton", { name: "체온" })).toHaveValue(39.1);
  });

  it("invalidates a reviewed patient only after an edited comparison succeeds", async () => {
    const responses = buildDemoWorkspaceData();
    const initialResponse = responses[0];
    const pair = demoRecordPairs.P001;
    if (!initialResponse || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const successResponse = structuredClone(initialResponse);
    successResponse.summary.sections.situation[0]!.text = "검토 후 편집 비교 성공";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(initialResponse),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HandoverWorkspace data={responses} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument());
    await user.click(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" }));
    await user.click(screen.getByRole("button", { name: "검토 완료" }));
    expect(screen.getByText("검토 완료", { selector: ".queue-status" })).toBeInTheDocument();

    fetchMock.mockClear();
    fetchMock.mockRejectedValueOnce(new Error("network"));
    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(recordPanel).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");
    await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));
    await waitFor(() => expect(within(recordPanel).getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("검토 완료", { selector: ".queue-status" })).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(successResponse),
    });
    await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));
    await waitFor(() => expect(screen.queryByRole("tabpanel", { name: "원본 기록" })).not.toBeInTheDocument());
    expect(screen.queryByText("검토 완료", { selector: ".queue-status" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" })).not.toBeChecked();
  });

  it("keeps the patient context and review rail while switching center modules", async () => {
    const user = userEvent.setup();
    const pair = demoRecordPairs.P001;
    if (!pair) throw new Error("P001 데모 기록이 없습니다.");

    render(<HandoverWorkspace data={buildDemoWorkspaceData()} recordPairs={{ P001: pair }} />);

    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));

    expect(screen.getByRole("tabpanel", { name: "원본 기록" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "홍길동" })).toBeVisible();
    expect(screen.getByRole("complementary", { name: "인계 검토" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "인계 검토" })).toBeVisible();
  });

  it("preserves an unsaved record draft while switching center modules", async () => {
    const user = userEvent.setup();
    const pair = demoRecordPairs.P001;
    if (!pair) throw new Error("P001 데모 기록이 없습니다.");

    render(<HandoverWorkspace data={buildDemoWorkspaceData()} recordPairs={{ P001: pair }} />);

    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(recordPanel).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");

    await user.click(screen.getByRole("tab", { name: "인수인계 비교" }));
    expect(screen.getByRole("tabpanel", { name: "인수인계 비교" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "원본 기록" }));
    expect(within(screen.getByRole("tabpanel", { name: "원본 기록" })).getByRole("spinbutton", { name: "체온" })).toHaveValue(39.1);
  });

  it("returns to comparison when the patient changes from the record module", async () => {
    const user = userEvent.setup();
    const firstPair = demoRecordPairs.P001;
    const secondPair = demoRecordPairs.P002;
    if (!firstPair || !secondPair) throw new Error("데모 기록이 없습니다.");

    render(
      <HandoverWorkspace
        data={buildDemoWorkspaceData()}
        recordPairs={{ P001: firstPair, P002: secondPair }}
      />,
    );

    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    expect(screen.getByRole("tabpanel", { name: "원본 기록" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: /김영희/ }));

    expect(screen.getByRole("tab", { name: "인수인계 비교" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "인수인계 비교" })).toBeVisible();
    expect(screen.queryByRole("tabpanel", { name: "원본 기록" })).not.toBeInTheDocument();
  });

  it("returns to comparison and focuses the matching change when evidence is activated from the record module", async () => {
    const response = buildDemoWorkspaceData()[0];
    const pair = demoRecordPairs.P001;
    if (!response || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(response),
    }));

    render(<HandoverWorkspace data={[response]} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "원본 기록" }));

    const evidenceId = response.comparison.changes[0]!.id;
    const summary = screen.getByRole("complementary", { name: "인계 검토" });
    const situation = within(summary).getByRole("region", { name: "Situation" });
    await user.click(within(situation).getByRole("button", { name: "근거 9건" }));
    const details = within(situation).getByRole("button", { name: "근거 9건" }).closest("details");
    if (!(details instanceof HTMLDetailsElement)) throw new Error("근거 disclosure가 없습니다.");

    await user.click(within(details).getByRole("link", { name: /^근거 1/ }));

    const card = document.getElementById(`evidence-${evidenceId}`);
    if (!card) throw new Error("근거 변화 카드가 없습니다.");
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(screen.getByRole("tab", { name: "인수인계 비교" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tabpanel", { name: "원본 기록" })).not.toBeInTheDocument();
    expect(card).toHaveClass("is-evidence-focused");
  });

  it("returns to comparison only after an edited comparison succeeds", async () => {
    const response = buildDemoWorkspaceData()[0];
    const pair = demoRecordPairs.P001;
    if (!response || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const updatedResponse = structuredClone(response);
    updatedResponse.summary.sections.situation[0]!.text = "편집된 체온 39.1 서버 요약";
    const temperatureChange = updatedResponse.comparison.changes.find(
      (change) => change.evidence.fieldPath === "vitals.body_temperature",
    );
    if (!temperatureChange) throw new Error("체온 변화 근거가 없습니다.");
    temperatureChange.currentValue = 39.1;
    temperatureChange.delta = 1.2;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(response) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(updatedResponse) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HandoverWorkspace data={[response]} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(recordPanel).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");
    await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));

    await waitFor(() => expect(screen.getByText("편집된 체온 39.1 서버 요약")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "인수인계 비교" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tabpanel", { name: "원본 기록" })).not.toBeInTheDocument();
    expect(screen.getByText("39.1", { exact: true })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("restores record mode with the edited draft when a pending compare fails after switching modules", async () => {
    const response = buildDemoWorkspaceData()[0];
    const pair = demoRecordPairs.P001;
    if (!response || !pair) throw new Error("P001 데모 응답이 없습니다.");
    let rejectManualRequest!: (reason?: unknown) => void;
    const manualRequest = new Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>((_, reject) => {
      rejectManualRequest = reject;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(response) })
      .mockReturnValueOnce(manualRequest);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HandoverWorkspace data={[response]} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(screen.queryByText("서버 요약을 불러오는 중입니다.")).not.toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(recordPanel).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");
    await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("tab", { name: "인수인계 비교" }));
    expect(screen.getByRole("tab", { name: "인수인계 비교" })).toHaveAttribute("aria-selected", "true");

    rejectManualRequest(new Error("network"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "원본 기록" })).toHaveAttribute("aria-selected", "true"));
    const restoredRecordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    expect(within(restoredRecordPanel).getByRole("spinbutton", { name: "체온" })).toHaveValue(39.1);
    expect(within(restoredRecordPanel).getByRole("alert")).toHaveTextContent("비교하지 못했습니다. 기록을 확인한 뒤 다시 시도하세요.");
  });

  it("keeps record mode, the edited draft, error, and the prior verified summary after compare failure", async () => {
    const response = buildDemoWorkspaceData()[0];
    const pair = demoRecordPairs.P001;
    if (!response || !pair) throw new Error("P001 데모 응답이 없습니다.");
    const verifiedResponse = structuredClone(response);
    verifiedResponse.summary.sections.situation[0]!.text = "마지막 검증 비교 결과";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(verifiedResponse) })
      .mockRejectedValueOnce(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HandoverWorkspace data={[response]} recordPairs={{ P001: pair }} />);
    await waitFor(() => expect(screen.getByText("마지막 검증 비교 결과")).toBeInTheDocument());
    await user.click(await screen.findByRole("tab", { name: "원본 기록" }));
    const recordPanel = screen.getByRole("tabpanel", { name: "원본 기록" });
    await user.click(within(recordPanel).getByRole("tab", { name: /현재 기록/ }));
    const temperature = within(recordPanel).getByRole("spinbutton", { name: "체온" });
    await user.clear(temperature);
    await user.type(temperature, "39.1");
    await user.click(within(recordPanel).getByRole("button", { name: "변경사항 비교" }));

    await waitFor(() => expect(within(recordPanel).getByRole("alert")).toHaveTextContent("비교하지 못했습니다. 기록을 확인한 뒤 다시 시도하세요."));
    expect(screen.getByRole("tab", { name: "원본 기록" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "원본 기록" })).toBeVisible();
    expect(within(recordPanel).getByRole("spinbutton", { name: "체온" })).toHaveValue(39.1);
    expect(screen.getByText("마지막 검증 비교 결과")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "인수인계 비교" })).toHaveAttribute("aria-selected", "false");
  });
});
