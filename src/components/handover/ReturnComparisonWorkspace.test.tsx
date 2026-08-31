import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HandoverPeriodApiResponse, PeriodEvent } from "@/lib/handover-period-contracts";

import { ReturnComparisonWorkspace } from "./ReturnComparisonWorkspace";

const BASELINE = "2026-06-29T15:00:00+09:00";
const CURRENT = "2026-07-02T09:00:00+09:00";

function createEvent(
  id: string,
  detectedAt: string,
  category: "vitals" | "medications" | "diagnosis" | "notes",
  classification: "current" | "period_only" | "trend" | "record_event",
  label: string,
  changeType: "added" | "removed" | "modified",
  previousValue: string | number | null,
  currentValue: string | number | null,
): PeriodEvent {
  return {
    id,
    detectedAt,
    interval: { previousRecordedAt: BASELINE, currentRecordedAt: detectedAt },
    classification,
    change: {
      id: `change-${id}`,
      category,
      changeType,
      reviewPriority: category === "vitals" ? "medium" : "high",
      label,
      previousValue,
      currentValue,
      delta: typeof previousValue === "number" && typeof currentValue === "number" ? currentValue - previousValue : null,
      evidence: {
        fieldPath: category === "vitals" ? "vitals.body_temperature" : `${category}[\"${label}\"]`,
        previousRecordedAt: BASELINE,
        currentRecordedAt: detectedAt,
      },
    },
  };
}

function createResponse(overrides: Partial<HandoverPeriodApiResponse> = {}): HandoverPeriodApiResponse {
  const events: PeriodEvent[] = [
    createEvent(
      "event-saline-added",
      "2026-06-29T23:00:00+09:00",
      "medications",
      "period_only",
      "생리식염주 500mL",
      "added",
      null,
      "IV · QD",
    ),
    createEvent(
      "event-saline-removed",
      "2026-06-30T15:00:00+09:00",
      "medications",
      "period_only",
      "생리식염주 500mL",
      "removed",
      "IV · QD",
      null,
    ),
    createEvent(
      "event-ibuprofen-tid",
      "2026-06-30T07:00:00+09:00",
      "medications",
      "period_only",
      "이부프로펜 400mg",
      "modified",
      "PO · BID",
      "PO · TID",
    ),
    createEvent(
      "event-ibuprofen-bid",
      "2026-07-01T07:00:00+09:00",
      "medications",
      "period_only",
      "이부프로펜 400mg",
      "modified",
      "PO · TID",
      "PO · BID",
    ),
    createEvent(
      "event-temperature",
      "2026-07-02T07:00:00+09:00",
      "vitals",
      "trend",
      "체온",
      "modified",
      37.4,
      37.9,
    ),
    createEvent(
      "event-diagnosis",
      CURRENT,
      "diagnosis",
      "current",
      "hypertension",
      "added",
      null,
      "hypertension",
    ),
    createEvent(
      "event-note",
      CURRENT,
      "notes",
      "record_event",
      "미열 지속",
      "added",
      null,
      "미열 지속",
    ),
  ];

  return {
    patient: { id: "P001", name: "홍길동", room: "301", age: 67, sex: "M", diagnoses: ["acute pharyngitis"] },
    period: {
      requestedStartAt: BASELINE,
      baselineRecordedAt: BASELINE,
      currentRecordedAt: CURRENT,
      snapshotCount: 8,
      eventCount: events.length,
      status: "ready",
    },
    dataWarnings: [],
    events,
    reviewGroups: {
      current: [{ id: "review-current", category: "diagnosis", label: "hypertension", classification: "current", eventIds: ["event-diagnosis"] }],
      periodOnly: [{ id: "review-saline", category: "medications", label: "생리식염주 500mL", classification: "period_only", eventIds: ["event-saline-added", "event-saline-removed"] }, { id: "review-ibuprofen", category: "medications", label: "이부프로펜 400mg", classification: "period_only", eventIds: ["event-ibuprofen-tid", "event-ibuprofen-bid"] }],
      trends: [{ id: "review-temperature", category: "vitals", label: "체온", classification: "trend", eventIds: ["event-temperature"] }],
      recordEvents: [{ id: "review-note", category: "notes", label: "미열 지속", classification: "record_event", eventIds: ["event-note"] }],
    },
    summary: {
      mode: "deterministic",
      sections: { situation: [], background: [], assessment: [], recommendation: [] },
      evidenceIds: events.map((event) => event.id),
      warnings: [],
    },
    ...overrides,
  };
}

describe("ReturnComparisonWorkspace", () => {
  afterEach(() => cleanup());

  it("renders all four clinical sections and binds every row to an event evidence action", async () => {
    const user = userEvent.setup();
    const onOpenEvidence = vi.fn();
    render(<ReturnComparisonWorkspace response={createResponse()} onOpenEvidence={onOpenEvidence} />);

    expect(screen.getByRole("heading", { name: "현재도 유효한 변화" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "기간 중 발생 후 변경된 사항" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "활력징후 추세" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "전체 타임라인" })).toBeVisible();
    expect(screen.getAllByText("생리식염주 500mL")).not.toHaveLength(0);
    expect(screen.getAllByText("이부프로펜 400mg")).not.toHaveLength(0);
    expect(screen.getAllByText(/BID/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/TID/).length).toBeGreaterThan(0);
    expect(screen.queryByText("event-diagnosis", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('diagnosis["hypertension"]', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /event-diagnosis/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /event-diagnosis/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^근거 보기/ })).toHaveLength(7);

    await user.click(screen.getAllByRole("button", { name: /^근거 보기/ })[0]!);
    expect(onOpenEvidence).toHaveBeenCalledWith("event-diagnosis");
  });

  it.each([
    ["no_baseline", "기준 기록 없음"],
    ["no_events", "해당 기간에 검출된 변화가 없습니다."],
    ["partial", "부분 결과"],
  ] as const)("announces the explicit %s period state without inventing an event", (status, message) => {
    const response = createResponse({
      events: [],
      period: { ...createResponse().period, eventCount: 0, status },
      reviewGroups: { current: [], periodOnly: [], trends: [], recordEvents: [] },
      summary: { mode: "deterministic", sections: { situation: [], background: [], assessment: [], recommendation: [] }, evidenceIds: [], warnings: [] },
    });
    render(<ReturnComparisonWorkspace response={response} onOpenEvidence={vi.fn()} />);
    expect(screen.getAllByText(message)).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^근거 보기/ })).not.toBeInTheDocument();
  });

  it("keeps the successful event list visible behind loading and recoverable error status", () => {
    const response = createResponse();
    const onRetry = vi.fn();
    const { rerender } = render(
      <ReturnComparisonWorkspace response={response} loading onOpenEvidence={vi.fn()} />,
    );
    expect(screen.getAllByText("생리식염주 500mL").length).toBeGreaterThan(0);
    expect(screen.getByRole("status", { name: "기간 비교 상태" })).toHaveTextContent("불러오는 중");

    rerender(
      <ReturnComparisonWorkspace
        response={response}
        errorMessage="기간 비교를 불러오지 못했습니다."
        onRetry={onRetry}
        onOpenEvidence={vi.fn()}
      />,
    );
    expect(screen.getAllByText("생리식염주 500mL").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent("기간 비교를 불러오지 못했습니다.");
    screen.getByRole("button", { name: "다시 시도" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["loading", null, true, null, "status"],
    ["error", "ready", false, "기간 비교를 불러오지 못했습니다.", "alert"],
    ["partial", "partial", false, null, "status"],
    ["no_baseline", "no_baseline", false, null, "status"],
    ["no_events", "no_events", false, null, "status"],
  ] as const)("uses one central %s status announcement", (state, status, loading, errorMessage, role) => {
    const baseResponse = createResponse();
    const noEvents = status === "no_events" || status === "no_baseline";
    const stateResponse = createResponse({
      period: { ...baseResponse.period, status: status ?? baseResponse.period.status, eventCount: noEvents ? 0 : baseResponse.period.eventCount },
      events: noEvents ? [] : baseResponse.events,
      reviewGroups: noEvents
        ? { current: [], periodOnly: [], trends: [], recordEvents: [] }
        : baseResponse.reviewGroups,
    });

    render(
      <ReturnComparisonWorkspace
        response={stateResponse}
        loading={loading}
        errorMessage={errorMessage}
        onOpenEvidence={vi.fn()}
      />,
    );

    expect(screen.getAllByRole(role, { name: "기간 비교 상태" })).toHaveLength(1);
    expect(screen.queryAllByRole(role === "alert" ? "status" : "alert", { name: "기간 비교 상태" })).toHaveLength(0);
  });
});
