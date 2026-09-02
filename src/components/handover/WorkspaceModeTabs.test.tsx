import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceModeTabs } from "./WorkspaceModeTabs";

describe("WorkspaceModeTabs", () => {
  afterEach(() => cleanup());

  it("exposes selected state and panel relationships for both workspace modules", () => {
    render(
      <WorkspaceModeTabs
        scope="shift"
        mode="comparison"
        recordAvailable
        readinessPanelId="readiness-panel"
        comparisonPanelId="comparison-panel"
        recordPanelId="record-panel"
        onModeChange={vi.fn()}
      />,
    );

    const comparison = screen.getByRole("tab", { name: "인수인계 비교" });
    const record = screen.getByRole("tab", { name: "원본 기록" });

    expect(screen.getByRole("tablist", { name: "환자 기록 모듈" })).toBeInTheDocument();
    expect(comparison).toHaveAttribute("aria-selected", "true");
    expect(comparison).toHaveAttribute("aria-controls", "comparison-panel");
    expect(record).toHaveAttribute("aria-selected", "false");
    expect(record).toHaveAttribute("aria-controls", "record-panel");
    expect(record).toBeEnabled();
  });

  it("moves between workspace modules with ArrowLeft and ArrowRight", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();

    render(
      <WorkspaceModeTabs
        scope="shift"
        mode="comparison"
        recordAvailable
        readinessPanelId="readiness-panel"
        comparisonPanelId="comparison-panel"
        recordPanelId="record-panel"
        onModeChange={onModeChange}
      />,
    );

    const comparison = screen.getByRole("tab", { name: "인수인계 비교" });
    const record = screen.getByRole("tab", { name: "원본 기록" });

    comparison.focus();
    await user.keyboard("{ArrowRight}");
    expect(onModeChange).toHaveBeenLastCalledWith("record");
    expect(record).toHaveFocus();

    record.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onModeChange).toHaveBeenLastCalledWith("comparison");
    expect(comparison).toHaveFocus();
  });

  it("moves to the first or last available module with Home and End", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();

    render(
      <WorkspaceModeTabs
        scope="shift"
        mode="comparison"
        recordAvailable
        readinessPanelId="readiness-panel"
        comparisonPanelId="comparison-panel"
        recordPanelId="record-panel"
        onModeChange={onModeChange}
      />,
    );

    const comparison = screen.getByRole("tab", { name: "인수인계 비교" });
    const record = screen.getByRole("tab", { name: "원본 기록" });

    comparison.focus();
    await user.keyboard("{End}");
    expect(onModeChange).toHaveBeenLastCalledWith("record");
    expect(record).toHaveFocus();

    record.focus();
    await user.keyboard("{Home}");
    expect(onModeChange).toHaveBeenLastCalledWith("comparison");
    expect(comparison).toHaveFocus();
  });

  it("does not activate the unavailable record module", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();

    render(
      <WorkspaceModeTabs
        scope="shift"
        mode="comparison"
        recordAvailable={false}
        readinessPanelId="readiness-panel"
        comparisonPanelId="comparison-panel"
        recordPanelId="record-panel"
        onModeChange={onModeChange}
      />,
    );

    const comparison = screen.getByRole("tab", { name: "인수인계 비교" });
    const record = screen.getByRole("tab", { name: "원본 기록" });
    expect(record).toBeDisabled();

    await user.click(record);
    comparison.focus();
    await user.keyboard("{ArrowRight}");

    expect(onModeChange).not.toHaveBeenCalled();
    expect(comparison).toHaveFocus();
  });

  it("uses the return-scope labels and three supplied panel relationships", () => {
    render(
      <WorkspaceModeTabs
        scope="return"
        mode="readiness"
        recordAvailable
        readinessPanelId="readiness-panel"
        comparisonPanelId="comparison-panel"
        recordPanelId="record-panel"
        onModeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "근무 준비" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "근무 준비" })).toHaveAttribute("aria-controls", "readiness-panel");
    expect(screen.getByRole("tab", { name: "변화 근거" })).toHaveAttribute("aria-controls", "comparison-panel");
    expect(screen.getByRole("tab", { name: "원본 기록" })).toHaveAttribute("aria-controls", "record-panel");
  });

  it("cycles through enabled return tabs and skips a disabled record tab", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();

    render(
      <WorkspaceModeTabs
        scope="return"
        mode="readiness"
        recordAvailable={false}
        readinessPanelId="readiness-panel"
        comparisonPanelId="comparison-panel"
        recordPanelId="record-panel"
        onModeChange={onModeChange}
      />,
    );

    const readiness = screen.getByRole("tab", { name: "근무 준비" });
    const comparison = screen.getByRole("tab", { name: "변화 근거" });
    const record = screen.getByRole("tab", { name: "원본 기록" });
    expect(record).toBeDisabled();

    readiness.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onModeChange).toHaveBeenLastCalledWith("comparison");
    expect(comparison).toHaveFocus();

    comparison.focus();
    await user.keyboard("{ArrowRight}");
    expect(onModeChange).toHaveBeenLastCalledWith("readiness");
    expect(readiness).toHaveFocus();

    comparison.focus();
    await user.keyboard("{End}");
    expect(onModeChange).toHaveBeenLastCalledWith("comparison");
    expect(comparison).toHaveFocus();
  });

  it("never exposes readiness in shift scope", () => {
    render(
      <WorkspaceModeTabs
        scope="shift"
        mode="comparison"
        recordAvailable
        readinessPanelId="readiness-panel"
        comparisonPanelId="comparison-panel"
        recordPanelId="record-panel"
        onModeChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("tab", { name: "근무 준비" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });
});
