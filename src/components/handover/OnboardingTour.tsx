"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import styles from "./OnboardingTour.module.css";

export const ONBOARDING_STORAGE_KEY = "nurse-handover:onboarding:v1";

export type OnboardingScope = "shift" | "return";
export type OnboardingMode = "comparison" | "readiness" | "record";

export type OnboardingTourProps = {
  scope: OnboardingScope;
  mode: OnboardingMode;
  /** Increment to reopen the guide without changing any clinical workspace state. */
  openRequestId?: number;
};

type StoredPreference = "dismissed" | "completed";
type TourView = "closed" | "welcome" | "step";
type TourStepId = "patient" | "scope" | "center" | "summary";

type TourStep = {
  id: TourStepId;
  title: string;
  body: string;
  detail?: string;
};

type TargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type InertSnapshot = {
  element: HTMLElement;
  hadAttribute: boolean;
  attributeValue: string | null;
  propertyValue: boolean | null;
};

type ScrollSnapshotTarget = Window | HTMLElement;

type ScrollSnapshot = {
  target: ScrollSnapshotTarget;
  top: number;
  left: number;
};

const STEP_COUNT = 4;

const TARGET_SELECTORS: Record<TourStepId, readonly string[]> = {
  patient: [
    '[data-tour="patient-list"]',
    ".patient-queue .queue-row",
    ".patient-queue .queue-list",
    ".patient-queue .queue-heading",
    ".patient-queue",
  ],
  scope: [
    '[data-tour="scope-controls"]',
    ".return-handover-controls",
  ],
  center: [],
  summary: [
    ".shift-readiness-summary-panel .shift-readiness-summary-header",
    ".summary-panel .summary-header",
    '[data-tour="summary-rail"]',
    ".shift-readiness-summary-panel",
    ".summary-panel",
  ],
};

function readPreference(): StoredPreference | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    return value === "dismissed" || value === "completed" ? value : null;
  } catch {
    return null;
  }
}

function writePreference(value: StoredPreference) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, value);
  } catch {
    // Storage is a convenience for this UI preference. A blocked storage API
    // must never keep a clinician from using the workspace.
  }
}

function isMobileViewport() {
  return typeof window !== "undefined" && window.innerWidth <= 767;
}

function fallbackTargetRect(): TargetRect {
  const width = typeof window === "undefined" ? 320 : Math.min(320, Math.max(180, window.innerWidth - 32));
  return { top: 76, left: 16, width, height: 112 };
}

function targetRectFor(element: HTMLElement): TargetRect {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return fallbackTargetRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function targetIsAvailable(element: HTMLElement) {
  if (element.closest("[hidden]")) return false;
  if (typeof window === "undefined") return true;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function targetIsRendered(element: HTMLElement) {
  if (!targetIsAvailable(element)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function targetSelectorsForStep(
  stepId: TourStepId,
  scope: OnboardingScope,
  mode: OnboardingMode,
) {
  if (stepId === "summary") {
    if (mode === "readiness") {
      return [
        '[data-tour="summary-rail"]',
        ".shift-readiness-summary-progress",
        ".shift-readiness-summary-header",
        ".shift-readiness-summary-panel",
      ];
    }
    if (scope === "return") {
      return [
        '[data-tour="summary-rail"]',
        ".return-summary-integrity",
        ".return-summary-section",
        ".summary-panel .summary-header",
        ".summary-panel",
      ];
    }
    return [
      '[data-tour="summary-rail"]',
      ".summary-panel .summary-integrity",
      ".summary-panel .summary-section",
      ".summary-panel .summary-header",
      ".summary-panel",
    ];
  }
  if (stepId !== "center") return TARGET_SELECTORS[stepId];
  if (mode === "readiness") {
    return [
      ".shift-readiness-workspace .shift-readiness-item",
      ".shift-readiness-workspace-header",
      '[data-tour="center-workspace"] .shift-readiness-workspace-header',
      '[data-tour="center-workspace"]',
    ];
  }
  if (mode === "record") {
    return [
      ".record-workspace-header",
      '[data-tour="center-workspace"] .record-workspace-header',
      '[data-tour="center-workspace"]',
    ];
  }
  if (scope === "return") {
    return [
      ".return-comparison-workspace .return-event-row",
      ".return-comparison-workspace .return-timeline-row",
      ".return-comparison-workspace .comparison-header",
      '[data-tour="center-workspace"] .return-comparison-workspace .comparison-header',
      '[data-tour="center-workspace"]',
    ];
  }
  return [
    ".comparison-panel .change-card",
    ".comparison-panel .comparison-header",
    '[data-tour="center-workspace"] .comparison-panel .comparison-header',
    '[data-tour="center-workspace"]',
  ];
}

function targetForStep(
  stepId: TourStepId,
  scope: OnboardingScope,
  mode: OnboardingMode,
): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const selector of targetSelectorsForStep(stepId, scope, mode)) {
    const candidate = document.querySelector<HTMLElement>(selector);
    if (candidate && candidate.isConnected && targetIsAvailable(candidate)) return candidate;
  }
  return null;
}

function getCenterStep(scope: OnboardingScope, mode: OnboardingMode): TourStep {
  if (scope === "return" && mode === "readiness") {
    return {
      id: "center",
      title: "근무 준비",
      body: "환자 상태, 검사·결과, Line·Device, 투약 변경, 보고·확인의 다섯 영역을 훑어봅니다.",
      detail: "각 항목의 근거 보기를 누르면 연결된 원본 기록으로 이동합니다.",
    };
  }

  if (scope === "return" && mode === "comparison") {
    return {
      id: "center",
      title: "변화 근거",
      body: "마지막 근무 시각부터 현재까지 기간에 기록된 사건을 시간순으로 확인합니다.",
      detail: "기간 사건은 정확한 원본 기록 구간으로 연결됩니다.",
    };
  }

  if (mode === "record") {
    return {
      id: "center",
      title: "원본 기록",
      body: "비교에 사용된 원본 기록을 확인하고, 필요한 경우 현재 기록을 편집할 수 있습니다.",
      detail: "가이드가 기록이나 초안, 검토 상태를 바꾸지는 않습니다.",
    };
  }

  return {
    id: "center",
    title: "변화 검토",
    body: "직전 기록과 현재 기록의 차이를 확인합니다. 각 변화는 원본 근거로 이어집니다.",
    detail: "교대 비교에서는 카드의 근거 상세를 눌러 원본 기록을 확인합니다.",
  };
}

function getSummaryStep(scope: OnboardingScope, mode: OnboardingMode): TourStep {
  if (scope === "return" && mode === "readiness") {
    return {
      id: "summary",
      title: "확인 진행과 인계 메모",
      body: "오른쪽에서 확인 진행률과 미확인 항목을 보고, 중앙 항목에서 확인함을 표시합니다.",
      detail: "다음 근무에 전달할 인계 메모는 현재 세션에서만 유지됩니다.",
    };
  }

  return {
    id: "summary",
    title: scope === "return" ? "기간 요약과 검토" : "인계 검토",
    body: "오른쪽에서 요약과 근거 포함률을 확인하고 원본 기록 확인으로 마무리합니다.",
    detail: scope === "return"
      ? "기간 사건의 근거를 확인한 뒤 간호사가 후속 항목을 직접 기록합니다."
      : "요약은 검출된 변화와 연결된 근거를 바탕으로 검토합니다.",
  };
}

function createSteps(scope: OnboardingScope, mode: OnboardingMode): readonly TourStep[] {
  return [
    {
      id: "patient",
      title: "담당 환자",
      body: "왼쪽 목록에서 먼저 확인할 환자를 선택합니다.",
      detail: "환자와 병실, 변화 상태를 한눈에 비교할 수 있습니다.",
    },
    {
      id: "scope",
      title: "인수인계 범위",
      body: scope === "return"
        ? "휴무 복귀를 선택하면 마지막 근무 시각부터 현재까지를 확인할 수 있습니다."
        : "직전 교대는 이전 기록과 현재 기록을 비교합니다.",
      detail: scope === "return"
        ? "직전 교대와 휴무 복귀를 바꿔도 선택한 환자와 검토 내용은 유지됩니다."
        : "휴무 복귀를 선택하면 마지막 근무 시각을 기준으로 기간을 확인합니다.",
    },
    getCenterStep(scope, mode),
    getSummaryStep(scope, mode),
  ];
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true");
}

function restoreInert(snapshot: InertSnapshot | null) {
  if (!snapshot) return;
  if (snapshot.hadAttribute) {
    snapshot.element.setAttribute("inert", snapshot.attributeValue ?? "");
  } else {
    snapshot.element.removeAttribute("inert");
  }
  if (snapshot.propertyValue !== null) {
    snapshot.element.inert = snapshot.propertyValue;
  }
}

function captureScrollPosition(element: HTMLElement, snapshots: ScrollSnapshot[]) {
  const targets: ScrollSnapshotTarget[] = [window];
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    if (
      ancestor.scrollTop !== 0 ||
      ancestor.scrollLeft !== 0 ||
      ancestor.scrollHeight > ancestor.clientHeight ||
      ancestor.scrollWidth > ancestor.clientWidth
    ) {
      targets.push(ancestor);
    }
    ancestor = ancestor.parentElement;
  }

  targets.forEach((target) => {
    if (snapshots.some((snapshot) => snapshot.target === target)) return;
    if (!("scrollTop" in target)) {
      snapshots.push({ target, top: window.scrollY, left: window.scrollX });
      return;
    }
    snapshots.push({ target, top: target.scrollTop, left: target.scrollLeft });
  });
}

function restoreScrollPositions(snapshots: ScrollSnapshot[]) {
  snapshots.forEach(({ target, top, left }) => {
    if (!("scrollTop" in target)) {
      try {
        window.scrollTo({ top, left, behavior: "auto" });
      } catch {
        // jsdom and embedded shells may not implement window.scrollTo.
      }
      return;
    }
    target.scrollTop = top;
    target.scrollLeft = left;
  });
}

function placePopover(target: TargetRect, width: number, height: number): { top: number; left: number } {
  if (typeof window === "undefined") return { top: 88, left: 32 };

  const gutter = 16;
  const minTop = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxTop = Math.max(minTop, viewportHeight - height - gutter);
  const safeWidth = Math.min(width, Math.max(240, viewportWidth - gutter * 2));
  const rightSpace = viewportWidth - (target.left + target.width) - gutter;
  const leftSpace = target.left - gutter;
  const hasRightPlacement = rightSpace >= safeWidth;
  const hasLeftPlacement = leftSpace >= safeWidth;
  const left = hasRightPlacement
    ? target.left + target.width + gutter
    : hasLeftPlacement
      ? target.left - safeWidth - gutter
      : Math.max(gutter, (viewportWidth - safeWidth) / 2);
  const hasSidePlacement = hasRightPlacement || hasLeftPlacement;
  const belowTop = target.top + target.height + gutter;
  const aboveTop = target.top - height - gutter;
  const top = hasSidePlacement
    ? Math.min(
      Math.max(minTop, target.top),
      maxTop,
    )
    : belowTop + height <= viewportHeight - gutter
      ? belowTop
      : aboveTop >= minTop
        ? aboveTop
        : Math.min(
          Math.max(minTop, target.top),
          maxTop,
        );
  return {
    top,
    left: Math.min(Math.max(gutter, left), Math.max(gutter, viewportWidth - safeWidth - gutter)),
  };
}

export function OnboardingTour({ scope, mode, openRequestId = 0 }: OnboardingTourProps) {
  const [view, setView] = useState<TourView>("closed");
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 88, left: 32 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const inertSnapshotRef = useRef<InertSnapshot | null>(null);
  const scrollSnapshotsRef = useRef<ScrollSnapshot[]>([]);
  const wasOpenRef = useRef(false);
  const targetRectRef = useRef<TargetRect | null>(null);
  const steps = createSteps(scope, mode);
  const activeStep = steps[stepIndex] ?? steps[0];
  const activeStepId = activeStep?.id;
  const isOpen = view !== "closed";

  const updateTargetRect = useCallback((next: TargetRect | null) => {
    const previous = targetRectRef.current;
    const unchanged = previous === next || (
      previous !== null &&
      next !== null &&
      previous.top === next.top &&
      previous.left === next.left &&
      previous.width === next.width &&
      previous.height === next.height
    );
    if (unchanged) return;
    targetRectRef.current = next;
    setTargetRect(next);
  }, []);

  const openWelcome = useCallback(() => {
    if (typeof document !== "undefined") {
      const activeElement = document.activeElement;
      previousFocusRef.current = activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
    }
    setStepIndex(0);
    setView("welcome");
  }, []);

  const closeTour = useCallback((preference: StoredPreference) => {
    writePreference(preference);
    setView("closed");
    setTargetRect(null);
  }, []);

  useEffect(() => {
    const preference = readPreference();
    if (openRequestId === 0 && preference !== null) return;
    const timer = window.setTimeout(openWelcome, 0);
    return () => window.clearTimeout(timer);
  }, [openRequestId, openWelcome]);

  useEffect(() => {
    if (!isOpen) return;
    wasOpenRef.current = true;

    const appShell = document.querySelector<HTMLElement>(".app-shell");
    if (appShell && !inertSnapshotRef.current) {
      inertSnapshotRef.current = {
        element: appShell,
        hadAttribute: appShell.hasAttribute("inert"),
        attributeValue: appShell.getAttribute("inert"),
        propertyValue: "inert" in appShell ? appShell.inert : null,
      };
      appShell.setAttribute("inert", "");
      if ("inert" in appShell) appShell.inert = true;
    }

    return () => {
      restoreInert(inertSnapshotRef.current);
      inertSnapshotRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (view !== "closed") return;
    const hadOpenState = wasOpenRef.current || Boolean(previousFocusRef.current || inertSnapshotRef.current);
    restoreInert(inertSnapshotRef.current);
    inertSnapshotRef.current = null;
    if (!hadOpenState) return;
    const fallback = document.querySelector<HTMLElement>("[data-tour-replay]");
    const focusTarget = previousFocusRef.current?.isConnected
      ? previousFocusRef.current
      : fallback;
    focusTarget?.focus();
    previousFocusRef.current = null;
    wasOpenRef.current = false;
  }, [view]);

  useEffect(() => {
    if (view === "closed") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTour("dismissed");
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeTour, view]);

  useEffect(() => {
    if (isOpen) {
      return () => {
        restoreScrollPositions(scrollSnapshotsRef.current);
        scrollSnapshotsRef.current = [];
      };
    }
    restoreScrollPositions(scrollSnapshotsRef.current);
    scrollSnapshotsRef.current = [];
  }, [isOpen]);

  useEffect(() => {
    if (view === "closed") return;
    dialogRef.current?.focus();
  }, [stepIndex, view]);

  useLayoutEffect(() => {
    if (view !== "step" || !activeStepId) {
      updateTargetRect(null);
      return;
    }

    const target = targetForStep(activeStepId, scope, mode);
    if (!target) {
      updateTargetRect(null);
      return;
    }

    captureScrollPosition(target, scrollSnapshotsRef.current);
    const update = () => updateTargetRect(targetRectFor(target));
    let mobileScrollTimer: number | null = null;
    const mobileActionTarget = () => {
      if (!isMobileViewport() || activeStepId !== "center" || mode === "record") return target;
      const panel = target.closest<HTMLElement>('[role="tabpanel"]') ?? target;
      const candidate = panel.querySelector<HTMLElement>(
        ".evidence-details > summary, .shift-readiness-item button, .return-event-row button",
      );
      return candidate && targetIsRendered(candidate) ? candidate : target;
    };
    const adjustTargetAboveCard = () => {
      const alignmentTarget = mobileActionTarget();
      const targetBox = target.getBoundingClientRect();
      const alignmentBox = alignmentTarget.getBoundingClientRect();
      const cardTop = dialogRef.current?.getBoundingClientRect().top ?? window.innerHeight - 300;
      const safeTop = 10;
      const safeBottom = cardTop - 10;
      let delta = 0;
      const bottom = Math.max(targetBox.bottom, alignmentBox.bottom);
      const top = Math.min(targetBox.top, alignmentBox.top);
      if (bottom > safeBottom) delta = bottom - safeBottom;
      if (top < safeTop) delta = top - safeTop;
      if (delta !== 0 && typeof window.scrollBy === "function") {
        window.scrollBy({ top: delta, behavior: "auto" });
      }
    };
    const scrollTargetIntoView = () => {
      const mobile = isMobileViewport();
      const scrollTarget = mobileActionTarget();
      if (typeof scrollTarget.scrollIntoView === "function") {
        scrollTarget.scrollIntoView({
          block: mobile ? "center" : "nearest",
          inline: "nearest",
          behavior: "auto",
        });
      }
      update();
      if (mobile) {
        if (mobileScrollTimer !== null) window.clearTimeout(mobileScrollTimer);
        mobileScrollTimer = window.setTimeout(adjustTargetAboveCard, 0);
      }
    };
    scrollTargetIntoView();
    window.addEventListener("resize", scrollTargetIntoView);
    window.addEventListener("scroll", update, true);

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(update);
    resizeObserver?.observe(target);
    return () => {
      window.removeEventListener("resize", scrollTargetIntoView);
      window.removeEventListener("scroll", update, true);
      if (mobileScrollTimer !== null) window.clearTimeout(mobileScrollTimer);
      resizeObserver?.disconnect();
    };
  }, [activeStepId, mode, scope, updateTargetRect, view]);

  useLayoutEffect(() => {
    if (view !== "step" || !targetRect || isMobileViewport()) return;
    const popover = popoverRef.current;
    if (!popover) return;

    const updatePosition = () => {
      const { width, height } = popover.getBoundingClientRect();
      const next = placePopover(targetRect, width || 360, height || 240);
      setPopoverPosition((current) => (
        current.top === next.top && current.left === next.left ? current : next
      ));
    };

    updatePosition();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    resizeObserver?.observe(popover);
    const frame = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(updatePosition)
      : null;
    return () => {
      resizeObserver?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [targetRect, stepIndex, view]);

  if (view === "closed") return null;

  const welcome = view === "welcome";
  const progress = `${stepIndex + 1} / ${STEP_COUNT}`;
  const spotlightStyle: CSSProperties | undefined = targetRect
    ? {
      top: `${Math.max(8, targetRect.top - 5)}px`,
      left: `${Math.max(8, targetRect.left - 5)}px`,
      width: `${Math.max(40, targetRect.width + 10)}px`,
      height: `${Math.max(40, targetRect.height + 10)}px`,
    }
    : undefined;
  const popoverStyle: CSSProperties | undefined = welcome || isMobileViewport()
    ? undefined
    : {
      top: `${popoverPosition.top}px`,
      left: `${popoverPosition.left}px`,
    };
  const backdropStyle: CSSProperties | undefined = targetRect && typeof window !== "undefined"
    ? {
      "--cutout-top": `${Math.max(0, targetRect.top - 5)}px`,
      "--cutout-left": `${Math.max(0, targetRect.left - 5)}px`,
      "--cutout-right": `${Math.min(window.innerWidth, targetRect.left + targetRect.width + 5)}px`,
      "--cutout-bottom": `${Math.min(window.innerHeight, targetRect.top + targetRect.height + 5)}px`,
    } as CSSProperties
    : undefined;

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeTour("dismissed");
    }
  }

  return (
    <>
      <div
        className={`${styles.backdrop} ${targetRect ? styles.backdropCutout : ""}`}
        aria-hidden="true"
        style={backdropStyle}
      />
      {!welcome && targetRect ? (
        <div
          className={styles.spotlight}
          data-testid="onboarding-spotlight"
          aria-hidden="true"
          style={spotlightStyle}
        />
      ) : null}
      <div
        ref={(element) => {
          dialogRef.current = element;
          popoverRef.current = element;
        }}
        className={`${styles.dialog} ${welcome ? styles.welcomeDialog : styles.stepDialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={welcome ? "onboarding-welcome-title" : "onboarding-step-title"}
        aria-describedby={welcome ? "onboarding-welcome-description" : "onboarding-step-description"}
        tabIndex={-1}
        style={popoverStyle}
        onKeyDown={handleDialogKeyDown}
      >
        <div className={styles.dialogEyebrow}>NURSE HANDOVER · 화면 안내</div>
        {welcome ? (
          <>
            <h2 id="onboarding-welcome-title">인수인계, 여기서 시작하세요</h2>
            <p id="onboarding-welcome-description" className={styles.dialogBody}>
              담당 환자를 고르고, 인수인계 범위를 정한 뒤, 변화와 근거를 확인하고 검토를 마무리하는 흐름을 짧게 안내합니다.
            </p>
            <ol className={styles.overviewList}>
              <li><span>01</span> 담당 환자</li>
              <li><span>02</span> 인수인계 범위</li>
              <li><span>03</span> 변화와 근거</li>
              <li><span>04</span> 요약과 검토</li>
            </ol>
            <div className={styles.welcomeActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => closeTour("dismissed")}>
                건너뛰기
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                data-tour-primary
                onClick={() => {
                  setStepIndex(0);
                  setView("step");
                }}
              >
                시작하기
              </button>
            </div>
          </>
        ) : activeStep ? (
          <>
            <div className={styles.progressRow}>
              <span>화면 안내</span>
              <span className={styles.progressValue}>{progress}</span>
            </div>
            <h2 id="onboarding-step-title">{activeStep.title}</h2>
            <p id="onboarding-step-description" className={styles.dialogBody}>{activeStep.body}</p>
            {activeStep.detail ? <p className={styles.dialogDetail}>{activeStep.detail}</p> : null}
            <div className={styles.progressTrack} aria-hidden="true">
              <span style={{ width: `${((stepIndex + 1) / STEP_COUNT) * 100}%` }} />
            </div>
            <div className={styles.stepActions}>
              <button type="button" className={styles.skipButton} onClick={() => closeTour("dismissed")}>
                건너뛰기
              </button>
              <div className={styles.navigationActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={stepIndex === 0}
                  onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                >
                  이전
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  data-tour-primary
                  onClick={() => {
                    if (stepIndex >= STEP_COUNT - 1) {
                      closeTour("completed");
                    } else {
                      setStepIndex((current) => Math.min(STEP_COUNT - 1, current + 1));
                    }
                  }}
                >
                  {stepIndex >= STEP_COUNT - 1 ? "안내 마치기" : "다음"}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
