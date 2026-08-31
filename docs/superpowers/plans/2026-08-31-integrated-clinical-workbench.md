# Integrated Clinical Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the patient queue, record comparison, structured source-record editor, and SBAR review into one Figma-informed clinical workbench without changing clinical logic or API contracts.

**Architecture:** `HandoverWorkspace` remains the single state coordinator and adds a two-value `WorkspaceMode`. The existing modal record drawer becomes an inline `PatientRecordWorkspace` in the center column, while a dedicated clinical header and accessible module tabs make the queue, active patient, center work, and review rail one persistent context. All request-generation, session draft, deterministic fallback, and success-only apply boundaries remain unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Vitest, Testing Library, Playwright, FastAPI contract tests, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-31-integrated-clinical-workbench-design.md`

## Global Constraints

- Harness version is `1.2.0`; every worker must acknowledge the root `AGENTS.md` contract before edits.
- Frontend implementation workers use `gpt-5.6-luna` with reasoning `max`.
- No Python service, API schema, comparison priority, fixture clinical meaning, OpenAI prompt, or storage key changes.
- Keep `nurse-handover:record-drafts:v1`, success-only record application, stale-request rejection, strict draft validation, and deterministic fallback behavior.
- Expose only `인수인계 비교` and `원본 기록`; do not add decorative V/S, MAR, I&O, or nursing-plan modules.
- Do not invent allergy, fall-risk, physician, DNR, ward number, nurse name, or live-connection facts.
- Use the Figma node `KpybGW6Y8u9TyPSv61OcM9:39:3` as structural reference, not copy-pasted code.
- Target tokens: navy `#0B2339`, primary `#176B87`, selected `#EAF5F8`, canvas `#F7F9FB`, line `#DCE3EA`, ink `#17202A`.
- No new runtime dependency and no external font-download dependency.
- Minimum responsive checks: 390×844, 1024×768, 1440×900 with root/body horizontal overflow no greater than 1px.
- Subagents do not branch, commit, tag, push, merge, deploy, or edit supervisor-owned docs/config/version files.
- The supervisor commits only after implementation review, test review, automated gates, and visual verification.

---

### Task 1: Inline workspace modes and source-record workflow

**Files:**
- Create: `src/components/handover/ClinicalHeader.tsx`
- Create: `src/components/handover/WorkspaceModeTabs.tsx`
- Create: `src/components/handover/WorkspaceModeTabs.test.tsx`
- Create: `src/components/handover/PatientRecordWorkspace.tsx`
- Create: `src/components/handover/PatientRecordWorkspace.test.tsx`
- Modify: `src/components/handover/HandoverWorkspace.tsx`
- Modify: `src/components/handover/HandoverWorkspace.test.tsx`
- Delete: `src/components/handover/PatientRecordDrawer.tsx`
- Delete: `src/components/handover/PatientRecordDrawer.test.tsx`

**Interfaces:**
- Produces:

```ts
export type WorkspaceMode = "comparison" | "record";

export type WorkspaceModeTabsProps = {
  mode: WorkspaceMode;
  recordAvailable: boolean;
  comparisonPanelId: string;
  recordPanelId: string;
  onModeChange: (mode: WorkspaceMode) => void;
};

export type PatientRecordWorkspaceProps = {
  pair: DemoRecordPair;
  patientName: string;
  busy: boolean;
  errorMessage: string | null;
  resetRequestId: number;
  onCompare: (current: DemoPatientRecord) => void | Promise<void>;
  onReset: () => void | Promise<void>;
};

export type ClinicalHeaderProps = {
  currentRecordedAt: string | null;
};
```

- `HandoverWorkspace` owns `workspaceMode` and consumes all three components.
- `PatientRecordWorkspace` preserves the existing stable-row IDs, ISO-offset conversion, local draft reset, sanitation, busy state, and compare/reset callback contract.
- `SummaryPanel.onEvidenceActivate` continues to accept an evidence ID; the coordinator switches to `comparison` before incrementing the focus request.

- [ ] **Step 1: Write failing accessible-tabs tests**

Add tests that prove the two tabs expose correct ARIA state and support ArrowLeft, ArrowRight, Home, and End without introducing hidden inactive controls.

```tsx
it("moves between the two workspace modules with keyboard tab semantics", async () => {
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
  comparison.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(onModeChange).toHaveBeenLastCalledWith("record");
  expect(comparison).toHaveAttribute("aria-controls", "comparison-panel");
});
```

- [ ] **Step 2: Run the new tab test and verify RED**

Run:

```powershell
$env:VITE_CONFIG_NATIVE_IGNORE_WARNING='true'
node node_modules\vitest\vitest.mjs run src/components/handover/WorkspaceModeTabs.test.tsx
```

Expected: FAIL because `WorkspaceModeTabs` does not exist.

- [ ] **Step 3: Implement the minimal tab component**

Use native buttons and a real tablist. Keyboard handlers calculate the requested mode and focus the corresponding button after selection.

```tsx
const MODES: WorkspaceMode[] = ["comparison", "record"];

<div className="workspace-mode-tabs" role="tablist" aria-label="환자 기록 모듈">
  <button
    type="button"
    role="tab"
    aria-selected={mode === "comparison"}
    aria-controls={comparisonPanelId}
    onClick={() => onModeChange("comparison")}
  >
    인수인계 비교
  </button>
  <button
    type="button"
    role="tab"
    aria-selected={mode === "record"}
    aria-controls={recordPanelId}
    disabled={!recordAvailable}
    onClick={() => onModeChange("record")}
  >
    원본 기록
  </button>
</div>
```

- [ ] **Step 4: Run the tab test and verify GREEN**

Run the Step 2 command. Expected: all `WorkspaceModeTabs` tests PASS.

- [ ] **Step 5: Write failing source-record workspace tests**

Port the existing drawer behavior tests to the inline component and explicitly remove modal assumptions.

```tsx
it("renders the current record as an inline tabpanel without modal chrome", async () => {
  render(
    <section role="tabpanel" id="record-panel">
      <PatientRecordWorkspace {...baseProps} />
    </section>,
  );

  expect(screen.getByRole("tabpanel")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /현재 기록/ })).toBeVisible();
  expect(screen.getByRole("button", { name: "변경사항 비교" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "원본 기록 닫기" })).not.toBeInTheDocument();
});
```

Retain focused tests for previous/current records, stable controlled rows, `+09:00` round-trip, reset request ID, busy inputs, and sanitized compare payload.

- [ ] **Step 6: Run record-workspace tests and verify RED**

Run:

```powershell
$env:VITE_CONFIG_NATIVE_IGNORE_WARNING='true'
node node_modules\vitest\vitest.mjs run src/components/handover/PatientRecordWorkspace.test.tsx
```

Expected: FAIL because the inline component does not exist.

- [ ] **Step 7: Replace the modal drawer with the inline workspace**

Move the record body and controlled-row logic into `PatientRecordWorkspace`. Remove `open`, `onClose`, backdrop, Escape, body-scroll locking, origin-focus restoration, `role="dialog"`, and modal IDs. Keep the data-editing contract unchanged.

```tsx
export function PatientRecordWorkspace({
  pair,
  patientName,
  busy,
  errorMessage,
  resetRequestId,
  onCompare,
  onReset,
}: PatientRecordWorkspaceProps) {
  // Existing draft, stable row, timestamp, sanitation, and reset effects move here.
  return (
    <div className="record-workspace" aria-label={`${patientName} 원본 기록`}>
      <header className="record-workspace-header">...</header>
      <div className="record-workspace-tabs" role="tablist" aria-label="원본 기록 시점">...</div>
      <div className="record-workspace-scroll">...</div>
      {errorMessage ? <div className="record-workspace-error" role="alert">{errorMessage}</div> : null}
      <footer className="record-workspace-actions">...</footer>
    </div>
  );
}
```

- [ ] **Step 8: Run record-workspace tests and verify GREEN**

Run the Step 6 command. Expected: all record workspace tests PASS.

- [ ] **Step 9: Write failing coordinator tests**

Add tests to `HandoverWorkspace.test.tsx` for these exact transitions:

```tsx
it("keeps the patient and review rail while switching center modules", async () => {
  render(<HandoverWorkspace data={buildDemoWorkspaceData()} recordPairs={demoRecordPairs} />);
  await userEvent.click(screen.getByRole("tab", { name: "원본 기록" }));
  expect(screen.getByRole("tabpanel", { name: "원본 기록" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "인계 검토" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "홍길동" })).toBeVisible();
});

it("returns to comparison for patient changes and evidence activation", async () => {
  // Enter record mode, select a different patient, expect comparison mode.
  // Enter record mode again, activate a summary evidence link, expect the matching change focused.
});

it("returns to comparison only after a successful edited compare", async () => {
  // Success closes no modal; it switches the center module and renders the updated 39.1 change.
  // Failure keeps record mode, draft input, error message, and prior verified summary.
});
```

- [ ] **Step 10: Run coordinator tests and verify RED**

Run:

```powershell
$env:VITE_CONFIG_NATIVE_IGNORE_WARNING='true'
node node_modules\vitest\vitest.mjs run src/components/handover/HandoverWorkspace.test.tsx
```

Expected: FAIL because the coordinator still opens a modal drawer and has no workspace mode.

- [ ] **Step 11: Implement coordinator mode transitions and clinical header**

Add the state and transitions without changing compare functions.

```tsx
const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("comparison");

function handleEvidenceActivate(evidenceId: string) {
  setWorkspaceMode("comparison");
  updateSession({
    ...session,
    focusedEvidenceId: evidenceId,
    focusRequestId: session.focusRequestId + 1,
  });
}

function handleSelectPatient(nextPatientId: string) {
  if (nextPatientId === patientId) return;
  setWorkspaceMode("comparison");
  // Preserve the existing request invalidation and selected-patient update.
}
```

After manual compare success, call `setWorkspaceMode("comparison")`. Do not switch on failure. Render `ClinicalHeader`, `PatientContextHeader`, `WorkspaceModeTabs`, one active `tabpanel`, and the persistent `SummaryPanel`.

- [ ] **Step 12: Run focused and full frontend gates**

Run:

```powershell
$env:VITE_CONFIG_NATIVE_IGNORE_WARNING='true'
node node_modules\vitest\vitest.mjs run src/components/handover/WorkspaceModeTabs.test.tsx src/components/handover/PatientRecordWorkspace.test.tsx src/components/handover/HandoverWorkspace.test.tsx
node node_modules\vitest\vitest.mjs run
node node_modules\eslint\bin\eslint.js src/components/handover
node node_modules\typescript\bin\tsc --noEmit
git diff --check -- src/components/handover
```

Expected: all focused/full tests pass, ESLint and typecheck exit 0, no diff-check errors.

- [ ] **Step 13: Produce the task report for supervisor review**

Report RED evidence, files changed/deleted, exact test counts, known limitations, and out-of-scope confirmation. Do not commit.

---

### Task 2: Figma-informed clinical shell and responsive density

**Files:**
- Modify: `src/components/handover/ClinicalHeader.tsx`
- Modify: `src/components/handover/PatientQueue.tsx`
- Modify: `src/components/handover/PatientContextHeader.tsx`
- Modify: `src/components/handover/ComparisonWorkspace.tsx`
- Modify: `src/components/handover/ChangeCard.tsx`
- Modify: `src/components/handover/SummaryPanel.tsx`
- Modify: `src/components/handover/HandoverWorkspace.test.tsx`
- Modify: `src/app/globals.css`
- Modify: `e2e/handover-workspace.spec.ts`

**Interfaces:**
- Consumes `WorkspaceModeTabs`, `PatientRecordWorkspace`, and `workspaceMode` from Task 1 without changing their public props.
- Produces the final class structure and responsive shell verified by E2E.
- Existing copy contracts remain: `담당 환자`, `인수인계 비교`, `원본 기록`, `인계 검토`, `규칙 요약|AI 요약`, `변경사항 비교`, `검토 완료`.

- [ ] **Step 1: Write failing semantic-shell tests**

Add assertions for the approved product language and rejected scope.

```tsx
it("renders one clinical workbench without unsupported EMR modules", () => {
  render(<HandoverWorkspace data={buildDemoWorkspaceData()} recordPairs={demoRecordPairs} />);
  expect(screen.getByText("NURSE HANDOVER", { exact: true })).toBeVisible();
  expect(screen.getByText("SHIFT REVIEW", { exact: true })).toBeVisible();
  expect(screen.getByRole("heading", { name: "담당 환자" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "인수인계 비교" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "원본 기록" })).toBeVisible();
  expect(screen.queryByText("투약(MAR)", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("I&O", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("실시간 연결", { exact: true })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run semantic tests and verify RED**

Run:

```powershell
$env:VITE_CONFIG_NATIVE_IGNORE_WARNING='true'
node node_modules\vitest\vitest.mjs run src/components/handover/HandoverWorkspace.test.tsx
```

Expected: FAIL on the new clinical-shell labels or structure.

- [ ] **Step 3: Restructure component markup without changing data contracts**

- `ClinicalHeader`: 56px global context with product, shift, formatted current record time, and `RN · 근무중`.
- `PatientQueue`: dense three-line rows and text status; preserve filtering/order exports.
- `PatientContextHeader`: compact identity banner and comparison metrics; remove the old record button.
- `ComparisonWorkspace`/`ChangeCard`: flat record rows while retaining every visible before/current value and evidence anchor ID.
- `SummaryPanel`: compact fixed review rail; keep every input, evidence link, warning, and disable condition.

Do not add unsupported fields or mutate callback signatures.

- [ ] **Step 4: Run semantic tests and verify GREEN**

Run the Step 2 command. Expected: all workspace tests PASS.

- [ ] **Step 5: Write failing desktop geometry and responsive E2E tests**

Extend the existing responsive loop with computed geometry and module interaction.

```ts
const geometry = await page.evaluate(() => {
  const header = document.querySelector<HTMLElement>(".clinical-header")!;
  const queue = document.querySelector<HTMLElement>(".patient-queue")!;
  const review = document.querySelector<HTMLElement>(".summary-panel")!;
  const shell = document.querySelector<HTMLElement>(".workspace-shell")!;
  return {
    headerHeight: Math.round(header.getBoundingClientRect().height),
    queueWidth: Math.round(queue.getBoundingClientRect().width),
    reviewWidth: Math.round(review.getBoundingClientRect().width),
    shellGap: getComputedStyle(shell).gap,
    rootOverflow: document.documentElement.scrollWidth - innerWidth,
    bodyOverflow: document.body.scrollWidth - innerWidth,
  };
});
```

At 1440 expect header 56, queue 268, review 320, gap `0px`; at 1024 expect queue 220, review 280; at 390 expect horizontal overflow ≤1 and both center modules reachable.

- [ ] **Step 6: Run E2E and verify RED**

Run against the local app server:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3001'
node node_modules\@playwright\test\cli.js test e2e/handover-workspace.spec.ts
```

Expected: geometry assertions FAIL against the old card-based shell.

- [ ] **Step 7: Replace the CSS token system and layout**

Set the approved tokens and base typography at `:root`.

```css
:root {
  --navy: #0b2339;
  --primary: #176b87;
  --primary-soft: #eaf5f8;
  --canvas: #f7f9fb;
  --surface: #ffffff;
  --ink: #17202a;
  --secondary: #5b6876;
  --muted: #7b8c9d;
  --line: #dce3ea;
  --critical: #c2413b;
  --watch: #b7791f;
  --stable: #218358;
  --ui-font: "Noto Sans KR", Pretendard, "Segoe UI", sans-serif;
  --mono-font: "JetBrains Mono", Consolas, monospace;
}
```

Implement these layout contracts:

```css
.clinical-header { height: 56px; background: var(--navy); }
.workspace-shell { display: grid; grid-template-columns: 268px minmax(0, 1fr) 320px; gap: 0; }
.patient-queue { border-right: 1px solid var(--line); }
.summary-panel { border-left: 1px solid var(--line); }

@media (max-width: 1279px) and (min-width: 960px) {
  .workspace-shell { grid-template-columns: 220px minmax(0, 1fr) 280px; }
}

@media (max-width: 959px) {
  .workspace-shell { display: flex; flex-direction: column; }
}
```

Use borders and selected backgrounds rather than panel shadows. Keep visible focus, reduced motion, readable wrapping, and record medication single-column behavior at 390px.

- [ ] **Step 8: Run E2E and verify GREEN**

Run the Step 6 command. Expected: all E2E tests PASS at 390, 1024, and 1440.

- [ ] **Step 9: Run full frontend gates**

```powershell
$env:VITE_CONFIG_NATIVE_IGNORE_WARNING='true'
node node_modules\vitest\vitest.mjs run
node node_modules\eslint\bin\eslint.js .
node node_modules\typescript\bin\tsc --noEmit
node node_modules\next\dist\bin\next build
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3001'
node node_modules\@playwright\test\cli.js test
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 10: Perform implementation self-critique before handoff**

Capture and inspect 1440×900, 1024×768, and 390×844. Confirm:

- the comparison module is visually dominant;
- no generic dashboard card grid remains;
- record editing feels like the same center workbench;
- the primary teal is spent on selection, links, and the compare action only;
- all Figma-only unsupported facts/modules are absent;
- no text, action, or editor row is clipped.

- [ ] **Step 11: Produce the task report for supervisor review**

Report RED evidence, exact automated counts, viewport measurements, known limitations, and out-of-scope confirmation. Do not commit.

---

### Task 3: Supervisor integration, version, independent review, and deployment

**Files:**
- Modify: `VERSION`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/AGENT_WORKLOG.md`
- Modify: `docs/product/handover-workspace-spec.md`
- Modify: `docs/product/record-viewer-editor-spec.md`

**Interfaces:**
- Consumes the reviewed Task 1 and Task 2 working tree.
- Produces version `0.7.0`, final verification evidence, Git commits, GitHub integration, and Vercel deployment.

- [ ] **Step 1: Review Task 1 before Task 2 starts**

The supervisor inspects every functional diff, runs focused tests independently, and dispatches a separate read-only reviewer. Any Critical/Important finding returns to the Task 1 worker before visual work starts.

- [ ] **Step 2: Review Task 2 and visual states**

The supervisor inspects semantic markup and CSS, runs full automated gates, and uses the in-app browser for 1440/1024/390 screenshots and geometry. A separate read-only reviewer checks spec coverage and regression risk.

- [ ] **Step 3: Update documentation and version**

Set both version sources to `0.7.0` and document:

- integrated clinical header and three-rail workbench;
- inline comparison/source-record modules;
- preserved success-only/session/deterministic boundaries;
- exact local/Preview/Production verification counts;
- current OpenAI provider limitation, if still present.

- [ ] **Step 4: Run the final repository gate**

```powershell
.\.venv\Scripts\python.exe scripts\check_harness.py --root .
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
$env:VITE_CONFIG_NATIVE_IGNORE_WARNING='true'
node node_modules\vitest\vitest.mjs run
node node_modules\eslint\bin\eslint.js .
node node_modules\typescript\bin\tsc --noEmit
node node_modules\next\dist\bin\next build
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3001'
node node_modules\@playwright\test\cli.js test
git diff --check
```

Expected: harness passes, Python/Vitest/Playwright show zero failures, and all static/build checks exit 0.

- [ ] **Step 5: Commit and push the feature branch**

Supervisor stages only approved files and creates conventional commits. Push `codex/0.7-integrated-workbench` without force.

- [ ] **Step 6: Deploy and verify Vercel Preview**

Deploy Preview, then verify `/`, `/api/health`, a fictional P001 compare, and the full Playwright suite against the Preview URL. Do not change Production on failure.

- [ ] **Step 7: Merge remote and deploy Production**

After Preview and branch checks pass, update local `main` from `origin/main`, merge the reviewed feature branch without force, rerun the final test suite on the merged tree, push `main`, deploy Production, and verify root 200, health `ok`, fictional compare `ready`, full public E2E, and responsive browser geometry.

- [ ] **Step 8: Preserve recoverability**

Do not delete the feature branch or worktree until remote `main` and Production are verified. If merge or Production verification fails, stop with the branch/worktree intact and report the exact failure.
