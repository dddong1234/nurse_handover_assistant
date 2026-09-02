"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";

export type WorkspaceMode = "comparison" | "readiness" | "record";
export type WorkspaceScope = "shift" | "return";

export type WorkspaceModeTabsProps = {
  scope: WorkspaceScope;
  mode: WorkspaceMode;
  recordAvailable: boolean;
  readinessPanelId: string;
  comparisonPanelId: string;
  recordPanelId: string;
  onModeChange: (mode: WorkspaceMode) => void;
};

export const MODES_BY_SCOPE: Readonly<Record<WorkspaceScope, readonly WorkspaceMode[]>> = {
  shift: ["comparison", "record"],
  return: ["readiness", "comparison", "record"],
};

const MODE_LABELS: Readonly<Record<WorkspaceScope, Readonly<Record<WorkspaceMode, string>>>> = {
  shift: {
    comparison: "인수인계 비교",
    readiness: "근무 준비",
    record: "원본 기록",
  },
  return: {
    readiness: "근무 준비",
    comparison: "변화 근거",
    record: "원본 기록",
  },
};

const MODE_TAB_IDS: Readonly<Record<WorkspaceMode, string>> = {
  readiness: "readiness-tab",
  comparison: "comparison-tab",
  record: "record-tab",
};

export function WorkspaceModeTabs({
  scope,
  mode,
  recordAvailable,
  readinessPanelId,
  comparisonPanelId,
  recordPanelId,
  onModeChange,
}: WorkspaceModeTabsProps) {
  const tabRefs = useRef<Partial<Record<WorkspaceMode, HTMLButtonElement | null>>>({});
  const modes = MODES_BY_SCOPE[scope];
  const enabledModes = modes.filter((candidate) => candidate !== "record" || recordAvailable);
  const selectedMode = enabledModes.includes(mode) ? mode : enabledModes[0] ?? "comparison";
  const panelIds: Record<WorkspaceMode, string> = {
    readiness: readinessPanelId,
    comparison: comparisonPanelId,
    record: recordPanelId,
  };

  function selectMode(nextMode: WorkspaceMode) {
    if (!enabledModes.includes(nextMode)) return;
    onModeChange(nextMode);
    tabRefs.current[nextMode]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentMode = event.currentTarget.dataset.mode as WorkspaceMode;
    const currentIndex = enabledModes.indexOf(currentMode);
    if (currentIndex < 0) return;
    if (enabledModes.length < 2) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % enabledModes.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + enabledModes.length) % enabledModes.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = enabledModes.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    selectMode(enabledModes[nextIndex]!);
  }

  return (
    <div className="workspace-mode-tabs" role="tablist" aria-label="환자 기록 모듈">
      {modes.map((candidate) => {
        const disabled = candidate === "record" && !recordAvailable;
        return (
          <button
            ref={(element) => { tabRefs.current[candidate] = element; }}
            key={candidate}
            type="button"
            role="tab"
            id={MODE_TAB_IDS[candidate]}
            data-mode={candidate}
            aria-selected={selectedMode === candidate}
            aria-controls={panelIds[candidate]}
            tabIndex={selectedMode === candidate ? 0 : -1}
            disabled={disabled}
            onClick={() => selectMode(candidate)}
            onKeyDown={handleKeyDown}
          >
            {MODE_LABELS[scope][candidate]}
          </button>
        );
      })}
    </div>
  );
}
