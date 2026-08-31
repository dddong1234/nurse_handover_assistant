import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HandoverPeriodApiResponse, PeriodEvent } from "@/lib/handover-period-contracts";

import { ReturnSummaryPanel } from "./ReturnSummaryPanel";

const BASELINE = "2026-06-29T15:00:00+09:00";
const CURRENT = "2026-07-02T09:00:00+09:00";

function makeEvent(id: string, category: "diagnosis" | "medications", classification: "current" | "period_only", label: string): PeriodEvent {
  return {
    id,
    detectedAt: CURRENT,
    interval: { previousRecordedAt: BASELINE, currentRecordedAt: CURRENT },
    classification,
    change: {
      id: `change-${id}`,
      category,
      changeType: "added",
      reviewPriority: "high",
      label,
      previousValue: null,
      currentValue: label,
      delta: null,
      evidence: { fieldPath: `${category}[\"${label}\"]`, previousRecordedAt: BASELINE, currentRecordedAt: CURRENT },
    },
  };
}

function createResponse(): HandoverPeriodApiResponse {
  const events = [
    makeEvent("event-current-1", "diagnosis", "current", "hypertension"),
    makeEvent("event-current-2", "medications", "current", "이부프로펜 400mg"),
    makeEvent("event-period-1", "medications", "period_only", "생리식염주 500mL"),
    makeEvent("event-period-2", "medications", "period_only", "생리식염주 500mL"),
  ];
  return {
    patient: { id: "P001", name: "홍길동", room: "301", age: 67, sex: "M", diagnoses: ["acute pharyngitis"] },
    period: { requestedStartAt: BASELINE, baselineRecordedAt: BASELINE, currentRecordedAt: CURRENT, snapshotCount: 8, eventCount: events.length, status: "ready" },
    dataWarnings: ["2026-06-30 18:00–2026-07-01 00:00 기록 공백"],
    events,
    reviewGroups: {
      current: [
        { id: "current-1", category: "diagnosis", label: "hypertension", classification: "current", eventIds: ["event-current-1"] },
        { id: "current-2", category: "medications", label: "이부프로펜 400mg", classification: "current", eventIds: ["event-current-2"] },
      ],
      periodOnly: [{ id: "period-1", category: "medications", label: "생리식염주 500mL", classification: "period_only", eventIds: ["event-period-1", "event-period-2"] }],
      trends: [],
      recordEvents: [],
    },
    summary: {
      mode: "deterministic",
      sections: {
        situation: [{ text: "P001 기간 변화 4건", evidenceIds: ["event-current-1", "event-current-2"] }],
        background: [{ text: "투약 변화가 기간 중 기록되었습니다.", evidenceIds: ["event-current-2", "event-period-1", "event-period-2"] }],
        assessment: [{ text: "간호사가 원본 기록을 확인합니다.", evidenceIds: ["event-current-1"] }],
        recommendation: [{ text: "간호사가 확인할 후속 항목을 입력하세요.", evidenceIds: [] }],
      },
      evidenceIds: events.map((event) => event.id),
      warnings: ["AI_KEY_UNAVAILABLE"],
    },
  };
}

function props(response: HandoverPeriodApiResponse) {
  return {
    response,
    selectedEvidenceIds: response.summary.evidenceIds,
    recommendation: "",
    sourceConfirmed: false,
    reviewed: false,
    onToggleEvidence: vi.fn(),
    onEvidenceActivate: vi.fn(),
    onRecommendationChange: vi.fn(),
    onSourceConfirmedChange: vi.fn(),
    onReviewComplete: vi.fn(),
  };
}

describe("ReturnSummaryPanel", () => {
  afterEach(() => cleanup());

  it("collapses large evidence sets, expands exact events, and exposes each toggle once", async () => {
    const user = userEvent.setup();
    const response = createResponse();
    const callbacks = props(response);
    render(<ReturnSummaryPanel {...callbacks} />);

    expect(screen.getByRole("button", { name: "근거 2건" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "근거 3건" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /event-current-1/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "근거 2건" }));
    expect(screen.getByRole("button", { name: "Situation 1 · 근거 1 포함됨" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "근거 1" }));
    expect(callbacks.onEvidenceActivate).toHaveBeenCalledWith("event-current-1");

    await user.click(screen.getByRole("button", { name: "근거 3건" }));
    expect(screen.getByRole("button", { name: "Situation 1 · 근거 2 포함됨" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /근거 .* 포함됨/ })).toHaveLength(4);
  });

  it("keeps a 24-event evidence list compact until the clinician opens it", () => {
    const response = createResponse();
    const evidenceIds = Array.from({ length: 24 }, (_, index) => `event-long-${index + 1}`);
    response.summary = {
      ...response.summary,
      sections: {
        ...response.summary.sections,
        situation: [{ text: "장기간에 걸친 변화가 연결되었습니다.", evidenceIds }],
      },
    };

    render(<ReturnSummaryPanel {...props(response)} />);

    expect(screen.getByRole("button", { name: "근거 24건" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /event-long-1/ })).not.toBeInTheDocument();
  });

  it("shows total/current/period-only counts, evidence coverage, and all SBAR sections", () => {
    const response = createResponse();
    render(<ReturnSummaryPanel {...props(response)} />);

    expect(screen.getByRole("complementary", { name: "복귀 인계 검토" })).toBeInTheDocument();
    expect(screen.getByText("기간 사건 총수")).toBeInTheDocument();
    expect(screen.getByText("현재 확인")).toBeInTheDocument();
    expect(screen.getByText("기간 중 변경")).toBeInTheDocument();
    expect(screen.getByText("4건")).toBeInTheDocument();
    expect(screen.getAllByText("2건", { selector: ".return-summary-metric-value" })).toHaveLength(2);
    expect(screen.getByText("4/4")).toBeInTheDocument();
    for (const heading of ["Situation", "Background", "Assessment", "Recommendation"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(document.querySelector(".return-summary-integrity")).toHaveTextContent("기간 사건 4건");
    expect(document.querySelector(".return-summary-warnings")).toHaveTextContent("추가 데이터 주의가 있습니다. 원본 기록을 확인하세요.");
    expect(document.querySelector(".return-summary-warnings")).toHaveTextContent("AI 연결 정보가 없어 규칙 요약을 표시합니다.");
  });

  it("maps unknown warning codes to one neutral message without exposing the raw code", () => {
    const response = createResponse();
    const unknownCode = "unexpected.warning.code";
    response.dataWarnings = [];
    response.summary = { ...response.summary, warnings: [unknownCode] };

    render(<ReturnSummaryPanel {...props(response)} />);

    expect(screen.getByText("추가 데이터 주의가 있습니다. 원본 기록을 확인하세요.", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(unknownCode, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("preserves recommendation during a failed reload and gates completion on source confirmation", async () => {
    const user = userEvent.setup();
    const response = createResponse();
    const callbacks = props(response);
    const { rerender } = render(<ReturnSummaryPanel {...callbacks} />);
    const recommendation = screen.getByRole("textbox", { name: "간호사가 확인할 후속 항목" });
    await user.type(recommendation, "다음 교대에 원본 확인");
    expect(screen.getByRole("button", { name: "검토 완료" })).toBeDisabled();

    rerender(
      <ReturnSummaryPanel
        {...callbacks}
        recommendation="다음 교대에 원본 확인"
        status="error"
        errorMessage="기간 비교를 불러오지 못했습니다."
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "간호사가 확인할 후속 항목" })).toHaveValue("다음 교대에 원본 확인");
    expect(document.querySelector(".return-summary-error")).toHaveTextContent("기간 비교를 불러오지 못했습니다.");
    expect(screen.getByRole("button", { name: "검토 완료" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "원본 기록을 확인했습니다" }));
    expect(callbacks.onSourceConfirmedChange).toHaveBeenCalledWith(true);
  });

  it("renders explicit no-baseline, no-events, and partial states without fabricating counts", () => {
    for (const status of ["no_baseline", "no_events", "partial"] as const) {
      const response = createResponse();
      response.events = [];
      response.period = { ...response.period, eventCount: 0, status };
      response.reviewGroups = { current: [], periodOnly: [], trends: [], recordEvents: [] };
      response.summary = { mode: "deterministic", sections: { situation: [], background: [], assessment: [], recommendation: [] }, evidenceIds: [], warnings: [] };
      const view = render(<ReturnSummaryPanel {...props(response)} />);
      expect(screen.getByText(status === "no_baseline" ? "기준 기록 없음" : status === "no_events" ? "해당 기간에 검출된 변화가 없습니다." : "부분 결과")).toBeInTheDocument();
      view.unmount();
    }
  });
});
