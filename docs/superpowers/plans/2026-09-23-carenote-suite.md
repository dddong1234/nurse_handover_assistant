# CareNote Integrated Product Implementation Plan

> **For agentic workers:** Execute task by task with explicit file ownership and supervisor gates. User approved both-agent implementation, landing page, and deployment on 2026-09-23; only irreversible decisions need further approval.

**Goal:** Ship a separately deployed nursing workspace connecting shift preparation, evidence, and SOAP charting with a complete product landing page.
**Architecture:** Next host at origin/main 2610a017; existing legacy handover preserved at /handover. New /workspace shares patient, encounter, record version and in-page draft state. Existing Python comparison API remains the source of deterministic readiness. Charting domain is ported behind explicit props.
**Tech Stack:** Next.js, React, TypeScript, CSS modules, existing Python FastAPI; no new persistent database.
**Spec:** Root repository docs/superpowers/specs/2026-09-23-unified-emr-workspace-design.md plus user authorization to execute through deployment.

## Global Constraints

- Synthetic records only; no invented customer results, prices, testimonials, signatures or clinical decisions.
- Existing sources and deployments preserved. New CareNote deployment is separate.
- Supervisor owns routing, shared contracts, state, configuration, deployment; charting peer owns src/features/carenote-charting/**.
- New charting notes are explicitly added unsigned session records. Text is never parsed back into orders or vitals.
- Source timestamps are ISO with timezone. Unknown dates are not guessed.
- Same-page module transitions preserve draft state; a reload resets charting session records. Review restoration is version-bound.
- Notion page 3e472261-15e7-813b-8691-fbb951a606a0 records every inter-agent request, reply, correction and result. Supervisor is the sole page writer.

## Review Focus

- Patient A's delayed response or evidence must never show for patient B.
- Adding a note after the original snapshot must create a later snapshot while preserving original operational metadata.
- Draft and accepted suggestion must not become records until explicit add.
- Responsive layout at 390/960/1440 must not clip central text or controls.
- Marketing CTAs must reach working demos and make no unmeasured outcome or purchase claim.

### Task 1: Shared scenario and session contract

Files: src/lib/carenote/types.ts, scenario.ts, session.ts, session.test.ts.
Consumes existing getDemoTimeline/getShiftReadinessTimeline adapters. Produces CareEvidence/CareNote/CareDraft and explicit encounter/scenario mappings.

- [x] Write tests for patient isolation, invalid ISO, evidence ownership, immutable original snapshots, deterministic ordering and new note projection.
- [x] Run node node_modules/vitest/vitest.mjs run src/lib/carenote/session.test.ts; observe missing implementation RED.
- [x] Implement pure appendSessionNote and projectSessionRecords; append only the narrative to notes of a cloned snapshot, derive operational metadata from last known record, reject chronological backdating before the current record for this first demo.
- [x] Run focused test GREEN and baseline suite; supervisor inspect fixture/source mapping.

Example assertion: `expect(projectSessionRecords(base, [note]).at(-1)?.notes).toContain(note.narrative)`; base snapshots must remain deeply equal to their input clone.

### Task 2: Controlled SOAP module (charting peer)

Files: src/features/carenote-charting/** only. Contract: ChartingPanelProps from src/lib/carenote/types.ts.

- [x] Port framework-free existing local recommendation and evidence rules with provenance.
- [x] RED tests for explicit accept/dismiss, editing preservation, patient isolation, full ISO and only explicit add invoking onAddNote.
- [x] Implement ChartingPanel with one editor, a separate suggestion, evidence actions and unsigned chronological notes.
- [x] Run focused Vitest, owned ESLint, tsc; supervisor review and screen test.

### Task 3: Common shell and readiness dashboard

Files: src/components/carenote/CareWorkspace.tsx, CareWorkspace.module.css, supporting components/tests; src/app/workspace/page.tsx; src/app/handover/page.tsx.

- [x] Write integration tests around patient switching, module switching, source details and explicit note propagation.
- [x] Implement fixed patient context with modules 근무 준비 / 환자 기록 / 간호기록. Use useShiftReadiness and request contract, keep old /handover flow unchanged.
- [x] Show actionable fact statuses above recent change; render domain filter, single source action per row and selected detail panel, not duplicated full lists.
- [x] Preserve notes/drafts per encounter in a common memory store and distinguish stale readiness during requery/failure.
- [x] Run browser flow and component tests; check 390/960/1440 and keyboard controls.

### Task 4: Landing page and product identity

Files: src/components/carenote/LandingPage.tsx, LandingPage.module.css; src/app/page.tsx/layout.tsx; public brand assets only if needed.

- [x] Build responsive CareNote marketing page with a meaningful product demonstration, two product modules, source provenance story, workflow and FAQ.
- [x] Main CTA /workspace, charting CTA /workspace?module=charting; retain legacy demo access at /handover.
- [x] Actual product interface is the visual hero; no stock medical image, fabricated efficacy statistics or checkout.
- [x] Make demo availability and synthetic scope visible in product context and footer. No email/contact capture without a configured recipient.
- [x] Browser-check navigation, accordion, mobile layout and accessibility.

### Task 5: Whole-product verification and separate deployment

Files: e2e/carenote.spec.ts, documentation, version/changelog, scoped deployment config.

- [ ] Run Vitest, ESLint, Next build, Python suite, harness and focused browser E2E. Review failures rather than weaken gates.
- [ ] Get independent read-only review of patient isolation, date/source contracts, runtime UI, and marketing truthfulness.
- [ ] Commit scoped files on codex/1.0-carenote-suite. Do not merge old local main or include unrelated files.
- [ ] Create/link a separate Vercel project; deploy Preview, inspect / and /workspace plus Python API; deploy the verified build to Production.
- [ ] Record exact deployed URLs, source commit, limitations and rollback reference in Notion and local worklog.

## Execution ledger

- User authorization supersedes skill-level repeated design/plan approvals; proceed autonomously.
- Baseline: latest origin/main 2610a017, clean linked worktree, new branch codex/1.0-carenote-suite.
- Figma node39:3 inspected via MCP on 2026-09-23; existing frame preserved. New design follows its navy/teal shell grammar while emphasizing task content.
- Supervisor gate passed: frontend423, Python155, legacy E2E68, actual API CareNote E2E6; lint/typecheck/build/harness and independent contract/UI re-reviews. Preview deployment is next; no main merge or original production replacement.
