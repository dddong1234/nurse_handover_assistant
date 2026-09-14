# First-visit handover guide

Approved: 2026-09-14, user `ㄱㄱ` after four-step proposal. Harness 1.2.0.

Status: COMPLETED locally at 0.10.0. User approved resuming the blocked mobile record alignment fix. Supervisor final gates: Vitest282, originalE2E64 + guideE2E4, Python155, build/typecheck/lint/harness/diff-check all passed; scoped independent re-review found no remaining issues. No remote push/merge/deployment in this task. See AGENT_WORKLOG for failed checks, fixes, and exact evidence.

## Goal and rationale

First-time users cannot identify where to start. Provide a short optional walkthrough linked to the actual workspace: patient → scope → changes/evidence → summary/review. Teach the existing workflow without changing clinical data or selected patient/scope/tab. A persistent `화면 안내` header action replays it. Use existing Figma-derived navy/teal tokens and readable 14–16px body copy. Prior Figma MCP checkpoint for node 39:3 is recorded in AGENT_WORKLOG; fresh screenshot request hit the Starter call limit on this date. No new visual system is needed.

## Task 1: Implement the guide

Role frontend; gpt-5.6-luna / max. Worktree: C:/dev/nurse_handover_assistant/.worktrees/0.9.0-shift-readiness-design, branch codex/0.10.0-onboarding.

Owned product files: src/components/handover/OnboardingTour.tsx, src/components/handover/OnboardingTour.test.tsx, src/components/handover/OnboardingTour.module.css, src/components/handover/ClinicalHeader.tsx, src/components/handover/HandoverWorkspace.tsx, src/components/handover/HandoverWorkspace.test.tsx, e2e/onboarding.spec.ts, e2e/handover-workspace.spec.ts.

Out of scope: all other files, services, contracts, clinical logic, fixtures, dependency/config/version/docs changes, Git mutations, external API calls, other subagents. Exception: own scratch report .superpowers/sdd/2026-09-14-onboarding/task-1-report.md.

Interface: guide accepts current scope and mode to produce accurate copy; optional onOpenGuide callback on ClinicalHeader. Integration supplies explicit data-tour anchors on existing DOM/wrappers only as necessary. Do not restructure the three-rail layout. No callbacks that mutate clinical state. Use module-scoped CSS to avoid enlarging global override cascade.

Behavior:
- On first browser visit show a compact welcome dialog: `인수인계, 여기서 시작하세요`, patient → scope → evidence/review overview, `시작하기`, `건너뛰기`.
- Steps 1–4 highlight the actual region with readable short copy and progress, previous/next (last `안내 마치기`) and always available skip. Header button `화면 안내` can restart after dismissal.
- Step 1: 담당 환자, left list. Step 2: 인수인계 범위, 직전 교대 vs 휴무 복귀 and last work time. Step 3: active center panel; shift compares previous/current, return readiness has five workflow domains and `근거 보기`, return comparison is period events, record mode is original record viewing/editing. Step 4: right rail; shift/period summary and review, readiness item confirmation progress and manual handover note. Never claim readiness has SBAR or that reading is performing care.
- Dismissal/completion persists only a versioned preference in localStorage, key `nurse-handover:onboarding:v1`, value `dismissed` or `completed`. Never persist clinical data here. Handle unavailable/throwing storage without blocking app. Do not write preference merely because replay opens; skip/Escape closes and remembers. No SSR hydration mismatch.
- Desktop guide uses highlighted target + adjacent fixed popover. Mobile <=767px uses bottom card and scrolls target into view above it; never obscures target or places controls outside viewport. Anchors adapt to scroll/resize and disconnected targets safely. Keep document width intact at 390/960/1440.
- Keyboard: accessible named dialog, contained focus, Escape dismisses, focus restored to replay trigger or useful header action; background inert while modal so keyboard cannot mutate hidden context. Visible target remains visible. Reduced motion honored. Restore any temporarily changed scroll/style/inert state on close/unmount.
- Tour must preserve patient, scope, active tab, selected evidence, notes/drafts, review progress. No automatic patient/scope switching and no API calls caused by tour.

Verification: meaningful behavior tests for first visit, completion/skip persistence, replay, storage failure, focus/Escape, scope-specific copy and state preservation. Existing Workspace tests may seed dismissed preference in beforeEach, clearing after; existing E2E may do the same via addInitScript so regression tests retain their original assertions. New E2E must independently exercise genuine first visit, replay and 390/960/1440 target/control bounds and Escape. Use TDD for stateful behavior and report observed RED then GREEN. Run focused and full Vitest, changed-file eslint and TypeScript. Root will run build, E2E, Python and harness, and independent review.

Commands: node node_modules/vitest/vitest.mjs run; node node_modules/typescript/bin/tsc --noEmit; node node_modules/eslint/bin/eslint.js <owned source/test files>; PLAYWRIGHT_BASE_URL provided by root before browser tests. Never call OpenAI to test onboarding.

Stop/report: ownership conflict, required schema/clinical behavior change, unknown anchor/state contract, or persistent meaningful test failure. Send HARNESS_ACK before work and final HARNESS_VERSION/SCOPE_COMPLETED/FILES_CHANGED/TESTS_RUN/TEST_RESULTS/KNOWN_LIMITATIONS/OUT_OF_SCOPE_CONFIRMED. Full report in scratch file.

## Supervisor gates

Review actual diff, run app and inspect welcome plus each step at desktop/mobile, exercise readiness replay, keyboard and persisted preference. Run Next build, full frontend and existing E2E regression, Python tests and harness; no remote LLM needed. Record findings and fixes. On pass update VERSION/package.json/CHANGELOG to 0.10.0 and AGENT_WORKLOG. Keep source and documentation in the reviewed feature branch.

## Preflight

One integrated UI task avoids shared-file races. Optional header callback preserves existing callers. Versioned preference is non-patient UI state and does not change session-only clinical persistence. Existing approved four-step design is the spec. Baseline: scope/tab component tests 11/11 passed. Base origin/main 449dfddd7fc2e19b7dbaf15f86f96d14d2a1d0d7, content equal to released 0.9.0 worktree.
