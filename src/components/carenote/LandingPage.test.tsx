import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  afterEach(() => cleanup());

  it("keeps real workspace CTAs scoped to supported routes", () => {
    render(<LandingPage />);

    expect(screen.getAllByRole("link", { name: /작업공간 열기/ })[0]).toHaveAttribute("href", "/workspace");
    expect(screen.getByRole("link", { name: /인수인계 살펴보기/ })).toHaveAttribute("href", "/workspace");
    expect(screen.getByRole("link", { name: /인수인계 화면 열기/ })).toHaveAttribute("href", "/workspace");
    expect(screen.getByRole("link", { name: /차팅 살펴보기/ })).toHaveAttribute(
      "href",
      "/workspace?module=charting",
    );
    expect(screen.queryByText(/산소요법|호흡이 조금 가빠요|SpO₂ 96%|통증 NRS 3점이라고 말함/)).not.toBeInTheDocument();
  });

  it("keeps scope boundaries concise while retaining static preview labels", () => {
    render(<LandingPage />);

    expect(screen.queryByText(/SHIFT READINESS|SOURCE TRACE|NURSE REVIEW|PATIENT CONTEXT \/ SYNTHETIC/)).not.toBeInTheDocument();
    expect(screen.queryByText("정적 예시입니다. 실제 원본 대조는 작업공간에서 진행합니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("예시 화면은 기능 이해를 위한 합성 데이터입니다.")).not.toBeInTheDocument();
    expect(screen.queryByText(/최종 판단과 저장은 사용자가 합니다/)).not.toBeInTheDocument();
    expect(screen.getByText(/검토 후 기록 추가는 사용자가 직접 합니다/)).toBeInTheDocument();
    expect(screen.getByText("합성 환자 데이터로 제공되는 제품 데모입니다.")).toBeInTheDocument();
    expect(screen.getAllByText("예시 화면")).toHaveLength(3);
  });

  it("labels the charting example as supported rule-based draft output", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);

    await user.click(screen.getByRole("tab", { name: /차팅/ }));

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByText("통증 3점")).toHaveLength(2);
    expect(within(panel).getAllByText("[직접 확인·작성 필요]")).toHaveLength(3);
    expect(within(panel).getByText(/규칙 기반 결과 · S만 표시 · O\/A\/P 직접 작성 · 빈 항목 추가 불가/)).toBeInTheDocument();
    expect(within(panel).queryByText(/현재 통증 정도를 간호사가 확인함|통증 점수와 상태 변화를 이어서 관찰함/)).not.toBeInTheDocument();
  });

  it("explains browser-memory scope and no official persistence in the FAQ", () => {
    render(<LandingPage />);

    const storageQuestion = screen.getByText("저장되는 환자 데이터가 있나요?").closest("details");
    expect(storageQuestion).not.toBeNull();
    expect(within(storageQuestion as HTMLDetailsElement).getByText(/근무 준비 계산은 서버 API에서 처리하며 영구 저장하지 않습니다/)).toBeInTheDocument();
    expect(within(storageQuestion as HTMLDetailsElement).getByText(/새로고침하면 상태가 초기화/)).toBeInTheDocument();
    expect(within(storageQuestion as HTMLDetailsElement).getByText(/공식 저장이나 병원 기록 반영은 지원하지 않습니다/)).toBeInTheDocument();
  });
});
