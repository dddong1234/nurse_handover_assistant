import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceModeTabs } from "./WorkspaceModeTabs";

describe("WorkspaceModeTabs", () => {
  afterEach(() => cleanup());

  it("exposes selected state and panel relationships for both workspace modules", () => {
    render(
      <WorkspaceModeTabs
        mode="comparison"
        recordAvailable
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
        mode="comparison"
        recordAvailable
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
        mode="comparison"
        recordAvailable
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
        mode="comparison"
        recordAvailable={false}
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
});
