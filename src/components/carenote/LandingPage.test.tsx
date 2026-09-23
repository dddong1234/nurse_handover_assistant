import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  afterEach(() => cleanup());

  it("presents a clear CareNote product thesis and supported CTAs", () => {
    render(<LandingPage />);

    const heroHeading = screen.getByRole("heading", { level: 1, name: /인수인계와 간호기록,\s*이제 한 곳에서/ });
    expect(heroHeading).toBeInTheDocument();
    const hero = heroHeading.closest("section");
    expect(hero).not.toBeNull();
    expect(within(hero as HTMLElement).getByRole("link", { name: /데모 체험하기/ })).toHaveAttribute("href", "/workspace");
    expect(screen.getByRole("link", { name: /제품 둘러보기/ })).toHaveAttribute("href", "#product");
    expect(screen.getByRole("link", { name: /기존 인수인계 비교 화면/ })).toHaveAttribute("href", "/handover");
    expect(screen.getByText("제품 미리보기")).toBeInTheDocument();
    expect(screen.queryByText(/실시간 AI 연결|알레르기 자동 확인|MAR 자동 확인|도입 병원/)).not.toBeInTheDocument();
  });

  it("switches the shared patient preview with click and keyboard tab controls", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);

    const tablist = screen.getByRole("tablist", { name: "제품 미리보기" });
    const tabs = within(tablist).getAllByRole("tab");
    const panel = screen.getByRole("tabpanel");

    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.textContent)).toEqual(["근무 준비", "원본 근거", "간호기록"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(within(panel).getByText("회진 전 발열 경과 전달")).toBeInTheDocument();

    await user.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(within(panel).getByText("WBC 12.1 ×10³/μL")).toBeInTheDocument();
    expect(within(panel).getByText("08:20 기록")).toBeInTheDocument();

    await user.click(tabs[1]);
    await user.keyboard("{ArrowRight}");
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(within(panel).getAllByText("통증 3점")).toHaveLength(1);
    expect(within(panel).getByText("S:")).toBeInTheDocument();
    expect(within(panel).getByText("통증 정도 3점.")).toBeInTheDocument();
    expect(within(panel).getByText(/검토 후 필요한 내용만 기록 추가/)).toBeInTheDocument();
    expect(within(panel).queryByText("[직접 확인·작성 필요]")).not.toBeInTheDocument();

    await user.keyboard("{Home}");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
  });

  it("keeps workflow truth and storage boundaries explicit in the FAQ", () => {
    render(<LandingPage />);

    expect(screen.getByText(/결정론적 규칙으로 동작합니다/)).toBeInTheDocument();
    expect(screen.getByText(/선택형 AI 연결은 활성화되어 있지 않/)).toBeInTheDocument();
    expect(screen.getByText(/필요한 내용을 직접 작성해 명시적으로 추가할 수 있습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/미입력 항목을 직접 작성하고/)).not.toBeInTheDocument();

    const storage = screen.getByText("저장되는 환자 데이터가 있나요?").closest("details");
    expect(storage).not.toBeNull();
    expect(within(storage as HTMLDetailsElement).getByText(/작성 상태는 브라우저 메모리에만 유지됩니다/)).toBeInTheDocument();
    expect(within(storage as HTMLDetailsElement).getByText(/근무 준비 계산은 서버 API에서 처리하며 영구 저장하지 않습니다/)).toBeInTheDocument();
    expect(within(storage as HTMLDetailsElement).getByText(/공식 저장이나 병원 기록 반영은 지원하지 않습니다/)).toBeInTheDocument();
  });
});
