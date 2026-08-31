import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReturnHandoverControls } from "./ReturnHandoverControls";

describe("ReturnHandoverControls", () => {
  afterEach(() => cleanup());

  it("keeps shift scope selected by default and lists only supplied snapshot timestamps", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    const onStartAtChange = vi.fn();
    const startTimes = [
      "2026-06-29T15:00:00+09:00",
      "2026-06-29T23:00:00+09:00",
      "2026-06-30T07:00:00+09:00",
    ];

    render(
      <ReturnHandoverControls
        scope="shift"
        reviewStartAt={startTimes[0]!}
        availableStartTimes={startTimes}
        onScopeChange={onScopeChange}
        onStartAtChange={onStartAtChange}
      />,
    );

    expect(screen.getByRole("tab", { name: "직전 교대" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "휴무 복귀" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("combobox", { name: "마지막 근무 시각" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "휴무 복귀" }));
    expect(onScopeChange).toHaveBeenCalledWith("return");
  });

  it("exposes the return selector with exact supplied options and emits a changed snapshot", async () => {
    const user = userEvent.setup();
    const onStartAtChange = vi.fn();
    const startTimes = [
      "2026-06-29T15:00:00+09:00",
      "2026-06-29T23:00:00+09:00",
    ];

    render(
      <ReturnHandoverControls
        scope="return"
        reviewStartAt={startTimes[0]!}
        availableStartTimes={startTimes}
        onScopeChange={vi.fn()}
        onStartAtChange={onStartAtChange}
      />,
    );

    const selector = screen.getByRole("combobox", { name: "마지막 근무 시각" });
    expect(selector).toHaveValue(startTimes[0]);
    expect([...selector.querySelectorAll("option")].map((option) => option.value)).toEqual(startTimes);

    await user.selectOptions(selector, startTimes[1]!);
    expect(onStartAtChange).toHaveBeenCalledWith(startTimes[1]);
  });

  it("keeps controls keyboard and form accessible while disabled", () => {
    render(
      <ReturnHandoverControls
        scope="return"
        reviewStartAt="2026-06-29T15:00:00+09:00"
        availableStartTimes={["2026-06-29T15:00:00+09:00"]}
        onScopeChange={vi.fn()}
        onStartAtChange={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByRole("tab", { name: "직전 교대" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "휴무 복귀" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "마지막 근무 시각" })).toBeDisabled();
  });

  it("uses a WAI-ARIA tab contract with roving focus and arrow/home/end navigation", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    const onStartAtChange = vi.fn();
    const props = {
      reviewStartAt: "2026-06-29T15:00:00+09:00",
      availableStartTimes: ["2026-06-29T15:00:00+09:00"],
      onScopeChange,
      onStartAtChange,
    };
    const { rerender } = render(<ReturnHandoverControls {...props} scope="shift" />);
    const tablist = screen.getByRole("tablist", { name: "인수인계 범위" });
    const shiftTab = screen.getByRole("tab", { name: "직전 교대" });
    const returnTab = screen.getByRole("tab", { name: "휴무 복귀" });

    expect(tablist).toHaveAttribute("aria-orientation", "horizontal");
    expect(shiftTab).toHaveAttribute("aria-controls", "comparison-panel");
    expect(returnTab).toHaveAttribute("aria-controls", "comparison-panel");
    expect(shiftTab).toHaveAttribute("tabindex", "0");
    expect(returnTab).toHaveAttribute("tabindex", "-1");

    shiftTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(onScopeChange).toHaveBeenLastCalledWith("return");
    expect(returnTab).toHaveFocus();

    rerender(<ReturnHandoverControls {...props} scope="return" />);
    returnTab.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onScopeChange).toHaveBeenLastCalledWith("shift");
    expect(shiftTab).toHaveFocus();

    await user.keyboard("{End}");
    expect(onScopeChange).toHaveBeenLastCalledWith("return");
    expect(returnTab).toHaveFocus();

    await user.keyboard("{Home}");
    expect(onScopeChange).toHaveBeenLastCalledWith("shift");
    expect(shiftTab).toHaveFocus();
  });
});
