"use client";

import { useRef } from "react";

export type WorkspaceMode = "comparison" | "record";

export type WorkspaceModeTabsProps = {
  mode: WorkspaceMode;
  recordAvailable: boolean;
  comparisonPanelId: string;
  recordPanelId: string;
  onModeChange: (mode: WorkspaceMode) => void;
};

const MODES: WorkspaceMode[] = ["comparison", "record"];

export function WorkspaceModeTabs({
  mode,
  recordAvailable,
  comparisonPanelId,
  recordPanelId,
  onModeChange,
}: WorkspaceModeTabsProps) {
  const tabRefs = useRef<Record<WorkspaceMode, HTMLButtonElement | null>>({
    comparison: null,
    record: null,
  });
  const panelIds: Record<WorkspaceMode, string> = {
    comparison: comparisonPanelId,
    record: recordPanelId,
  };

  function selectMode(nextMode: WorkspaceMode) {
    if (nextMode === "record" && !recordAvailable) return;
    onModeChange(nextMode);
    tabRefs.current[nextMode]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const currentMode = event.currentTarget.dataset.mode as WorkspaceMode;
    const currentIndex = MODES.indexOf(currentMode);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % MODES.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + MODES.length) % MODES.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = MODES.length - 1;
    if (nextIndex === null) return;

    const nextMode = MODES[nextIndex];
    if (nextMode === "record" && !recordAvailable) return;
    event.preventDefault();
    selectMode(nextMode);
  }

  return (
    <div className="workspace-mode-tabs" role="tablist" aria-label="환자 기록 모듈">
      <button
        ref={(element) => { tabRefs.current.comparison = element; }}
        type="button"
        role="tab"
        id="comparison-tab"
        data-mode="comparison"
        aria-selected={mode === "comparison"}
        aria-controls={panelIds.comparison}
        tabIndex={mode === "comparison" ? 0 : -1}
        onClick={() => selectMode("comparison")}
        onKeyDown={handleKeyDown}
      >
        인수인계 비교
      </button>
      <button
        ref={(element) => { tabRefs.current.record = element; }}
        type="button"
        role="tab"
        id="record-tab"
        data-mode="record"
        aria-selected={mode === "record"}
        aria-controls={panelIds.record}
        tabIndex={mode === "record" ? 0 : -1}
        disabled={!recordAvailable}
        onClick={() => selectMode("record")}
        onKeyDown={handleKeyDown}
      >
        원본 기록
      </button>
    </div>
  );
}
