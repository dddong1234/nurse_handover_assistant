# Comparison-First Visual Refinement Plan

**Goal:** Refine the existing handover workspace so the deterministic shift comparison is unmistakably primary, while the patient list becomes a compact worklist and the SBAR area becomes a task-oriented review rail.

**Architecture:** Preserve the existing Next.js component and state boundaries. Change only UI composition, semantic labels, evidence-detail disclosure behavior, and CSS. Do not change Python services, TypeScript contracts, API calls, fixtures, or clinical meaning.

**Spec:** `docs/product/handover-workspace-spec.md`

## Global Constraints

- Harness-Version is exactly `1.2.0`.
- Figma Make structure must not be copied; only its blue/white tokens, Inter/JetBrains Mono roles, status semantics, and patient-context conventions may be reused.
- The approved composition is `patient worklist | shift delta | handover review`.
- The central comparison is the dominant surface and owns the single signature element: `이번 근무 변화` with exact interval, total change count, and high-priority count.
- Preserve every Task 4 and Task 5 data contract, API behavior, review state, Korean empty/error message, keyboard path, and safety notice.
- Amber is reserved for review-needed states. Do not infer clinical deterioration or add clinical fields.
- New behavior is developed test-first.
- The frontend subagent must not modify `docs/`, configuration, dependencies, Python, services, API, fixtures, or Git state.

### Task 1: Reference-led comparison-first workspace refinement

**Owner:** frontend subagent, `gpt-5.6-luna`, reasoning `max`

**Files:**
- Modify: `src/components/handover/HandoverWorkspace.tsx`
- Modify: `src/components/handover/PatientQueue.tsx`
- Modify: `src/components/handover/PatientContextHeader.tsx`
- Modify: `src/components/handover/ComparisonWorkspace.tsx`
- Modify: `src/components/handover/ChangeCard.tsx`
- Modify: `src/components/handover/SummaryPanel.tsx`
- Modify: `src/components/handover/HandoverWorkspace.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: the existing `HandoverApiResponse` and browser review-session state without schema changes.
- Produces: the same interactions in a clearer visual hierarchy; activating a summary evidence link also expands the matching evidence details.

- [ ] **Step 1: Add failing structure and interaction tests**

Verify that the selected patient view exposes one `이번 근무 변화` summary with the exact interval, total change count, and high-priority count; that the right complementary region is named `인계 검토`; and that activating a summary evidence link expands the matching `근거 상세` while moving focus to the change.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm test -- src/components/handover/HandoverWorkspace.test.tsx`

Expected: FAIL because the shift summary and `인계 검토` structure do not exist and focused evidence details do not open.

- [ ] **Step 3: Implement the approved hierarchy**

Make the desktop comparison column materially wider than either rail. Convert the patient queue from stacked cards to compact rows. Integrate patient identity and interval with one persistent shift-summary strip. Flatten change cards into restrained comparison rows with the Shift Seam preserved. Reduce repeated borders, pills, shadows, all-caps eyebrows, and equal-weight headings. Keep category/change type as readable text and use amber only for items awaiting review.

The right rail must guide this sequence: evidence coverage → SBAR review → manual Recommendation → source confirmation → review completion. It should read as a quieter work rail and remain fully usable while the central comparison owns attention.

- [ ] **Step 4: Preserve responsive and accessibility behavior**

Keep the existing 1280px and 960px breakpoints, keyboard focus, reduced-motion behavior, safety notice, loading/fallback messages, and all Task 4/5 interactions. Evidence disclosure must remain keyboard-operable. Do not add dependencies.

- [ ] **Step 5: Run the frontend gate**

Run:

```powershell
pnpm test
pnpm lint
pnpm build
```

Expected: all commands exit 0.
