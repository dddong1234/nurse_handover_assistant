import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ONBOARDING_STORAGE_KEY,
  OnboardingTour,
} from "./OnboardingTour";

function renderTargets() {
  document.body.insertAdjacentHTML(
    "afterbegin",
    [
      '<aside data-tour="patient-list">담당 환자</aside>',
      '<section data-tour="scope-controls">인수인계 범위</section>',
      '<main data-tour="center-workspace">변화 근거</main>',
      '<aside data-tour="summary-rail">인계 검토</aside>',
      '<button type="button" data-tour-replay>화면 안내</button>',
    ].join(""),
  );
}

describe("OnboardingTour", () => {
  beforeEach(() => {
    window.localStorage.clear();
    renderTargets();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("shows a first-visit welcome and advances into the patient step", async () => {
    const user = userEvent.setup();

    render(<OnboardingTour scope="shift" mode="comparison" />);

    expect(await screen.findByRole("dialog", { name: "인수인계, 여기서 시작하세요" })).toBeVisible();
    expect(screen.getByRole("button", { name: "시작하기" })).toBeVisible();
    expect(screen.getByRole("button", { name: "건너뛰기" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(await screen.findByRole("heading", { name: "담당 환자" })).toBeVisible();
    expect(screen.getByText("1 / 4")).toBeVisible();
    expect(screen.getByTestId("onboarding-spotlight")).toBeVisible();
  });

  it("persists skip and completion separately, and replay can reopen after dismissal", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OnboardingTour scope="shift" mode="comparison" />);

    await user.click(await screen.findByRole("button", { name: "건너뛰기" }));
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("dismissed");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<OnboardingTour scope="shift" mode="comparison" openRequestId={1} />);
    expect(await screen.findByRole("dialog", { name: "인수인계, 여기서 시작하세요" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "시작하기" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "안내 마치기" }));

    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("completed");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains readiness in the current return mode without changing the mode", async () => {
    const user = userEvent.setup();

    render(<OnboardingTour scope="return" mode="readiness" />);
    await user.click(await screen.findByRole("button", { name: "시작하기" }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "다음" }));

    expect(await screen.findByRole("heading", { name: "근무 준비" })).toBeVisible();
    expect(screen.getByText(/다섯 영역/)).toBeVisible();
    expect(screen.getByText(/근거 보기/)).toBeVisible();
    expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
  });

  it("survives storage failures and still closes without blocking the app", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    render(<OnboardingTour scope="shift" mode="comparison" />);
    expect(await screen.findByRole("dialog", { name: "인수인계, 여기서 시작하세요" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "건너뛰기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("traps focus, dismisses on Escape, and restores focus to the replay trigger", async () => {
    const user = userEvent.setup();
    const replay = screen.getByRole("button", { name: "화면 안내" });
    replay.focus();

    render(<OnboardingTour scope="shift" mode="comparison" openRequestId={1} />);
    const dialog = await screen.findByRole("dialog", { name: "인수인계, 여기서 시작하세요" });
    expect(dialog).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(replay).toHaveFocus();
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("dismissed");
  });

  it("wraps Tab focus at both ends of the contained dialog", async () => {
    const user = userEvent.setup();
    const replay = screen.getByRole("button", { name: "화면 안내" });
    replay.focus();

    render(<OnboardingTour scope="shift" mode="comparison" openRequestId={1} />);
    const dialog = await screen.findByRole("dialog", { name: "인수인계, 여기서 시작하세요" });
    await waitFor(() => expect(dialog).toHaveFocus());
    const skip = within(dialog).getByRole("button", { name: "건너뛰기" });
    const start = within(dialog).getByRole("button", { name: "시작하기" });

    start.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(skip).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(start).toHaveFocus();

    await user.keyboard("{Escape}");
  });

  it("restores an existing app-shell inert state on unmount", async () => {
    document.body.insertAdjacentHTML("afterbegin", '<div class="app-shell"></div>');
    const { unmount } = render(<OnboardingTour scope="shift" mode="comparison" openRequestId={1} />);
    await screen.findByRole("dialog", { name: "인수인계, 여기서 시작하세요" });
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    expect(appShell).toHaveAttribute("inert");
    unmount();
    expect(appShell).not.toHaveAttribute("inert");
  });

  it("keeps a nested patient queue position through replay and close", async () => {
    const user = userEvent.setup();
    document.body.innerHTML = [
      '<div class="app-shell">',
      '  <aside class="patient-queue">',
      '    <div class="queue-list"><button class="queue-row" type="button">첫 행</button></div>',
      "  </aside>",
      '  <section class="return-handover-controls">인수인계 범위</section>',
      '  <main class="comparison-panel"><article class="change-card">변화</article></main>',
      '  <aside class="summary-panel"><div class="summary-integrity">근거 포함률</div></aside>',
      "</div>",
    ].join("");
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "dismissed");

    const queue = document.querySelector<HTMLElement>(".patient-queue");
    const firstRow = document.querySelector<HTMLElement>(".queue-row");
    if (!queue || !firstRow) throw new Error("테스트용 환자 큐를 찾을 수 없습니다.");
    Object.defineProperty(queue, "scrollHeight", { configurable: true, value: 600 });
    Object.defineProperty(queue, "clientHeight", { configurable: true, value: 280 });
    queue.scrollTop = 70;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn(() => {
      queue.scrollTop = 0;
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });

    try {
      render(<OnboardingTour scope="shift" mode="comparison" openRequestId={1} />);
      await user.click(await screen.findByRole("button", { name: "시작하기" }));
      expect(scrollIntoView).toHaveBeenCalled();
      expect(firstRow).toBeInTheDocument();
      expect(firstRow).toBeVisible();
      expect(queue.scrollTop).toBe(0);

      await user.click(screen.getByRole("button", { name: "건너뛰기" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(queue.scrollTop).toBe(70);
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          writable: true,
          value: originalScrollIntoView,
        });
      } else {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          writable: true,
          value: undefined,
        });
      }
    }
  });
});
