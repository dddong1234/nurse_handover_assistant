# Record Viewer and Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a session-only fictional patient chart viewer/editor that submits a structured current snapshot to the existing comparison API and updates the handover workspace only after a successful comparison.

**Architecture:** Keep the FastAPI comparison contract unchanged. A small client library validates and persists applied fictional record drafts in `sessionStorage`; a controlled chart drawer edits one typed snapshot; `HandoverWorkspace` owns the transactional compare/apply flow so failed requests never replace the last verified result.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library, Playwright, existing FastAPI compare endpoint

**Spec:** `docs/product/record-viewer-editor-spec.md`

## Global Constraints

- Harness-Version: `1.2.0`.
- Use only bundled fictional patient records; never add real patient data.
- Deterministic server logic remains the sole source of clinical change facts.
- Keep the existing Figma-derived tokens and the three-column comparison-first composition.
- Do not expose raw JSON in the UI.
- Persist applied drafts only in browser `sessionStorage` under `nurse-handover:record-drafts:v1`.
- Apply a draft and reset review state only after the compare API succeeds.
- Do not add dependencies, a database, authentication, or new clinical rules.
- Subagents must not run branch, commit, tag, push, reset, or checkout commands.

---

### Task 1: Session record draft boundary

**Files:**
- Create: `src/lib/record-drafts.ts`
- Create: `src/lib/record-drafts.test.ts`

**Interfaces:**
- Consumes: `DemoPatientRecord` from `src/lib/demo-records.ts`.
- Produces: `RECORD_DRAFTS_STORAGE_KEY`, `isDemoPatientRecord`, `cloneDemoRecord`, `loadRecordDrafts`, `persistRecordDraft`, and `removeRecordDraft`.

- [ ] **Step 1: Write failing tests for valid load, invalid payload rejection, immutable persistence, and per-patient removal**

```ts
it("loads only complete fictional record drafts from session storage", () => {
  const storage = memoryStorage({
    "nurse-handover:record-drafts:v1": JSON.stringify({ P001: validRecord, P999: { patient_id: "P999" } }),
  });
  expect(loadRecordDrafts(storage)).toEqual({ P001: validRecord });
});

it("persists a deep copy without changing sibling patient drafts", () => {
  const storage = memoryStorage();
  persistRecordDraft(storage, validRecord);
  validRecord.notes.push("mutated later");
  expect(loadRecordDrafts(storage).P001?.notes).toEqual(["인후통 호소", "미열 지속"]);
});

it("removes only the requested patient draft", () => {
  const storage = memoryStorage({
    "nurse-handover:record-drafts:v1": JSON.stringify({ P001: validRecord, P002: secondRecord }),
  });
  removeRecordDraft(storage, "P001");
  expect(Object.keys(loadRecordDrafts(storage))).toEqual(["P002"]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/record-drafts.test.ts
```

Expected: FAIL because `src/lib/record-drafts.ts` does not exist.

- [ ] **Step 3: Implement the minimal validated storage boundary**

```ts
export const RECORD_DRAFTS_STORAGE_KEY = "nurse-handover:record-drafts:v1";

export type StorageBoundary = Pick<Storage, "getItem" | "setItem">;
export type RecordDrafts = Record<string, DemoPatientRecord>;

export function cloneDemoRecord(record: DemoPatientRecord): DemoPatientRecord {
  return structuredClone(record);
}

export function loadRecordDrafts(storage: Pick<Storage, "getItem">): RecordDrafts;
export function persistRecordDraft(storage: StorageBoundary, record: DemoPatientRecord): void;
export function removeRecordDraft(storage: StorageBoundary, patientId: string): void;
```

`isDemoPatientRecord` must verify all required scalar fields, numeric vital values, medication row strings, and string arrays. Invalid JSON or invalid entries return an empty/filtered result without throwing. `persistRecordDraft` stores a cloned record keyed by its own `patient_id`; `removeRecordDraft` preserves every other valid entry.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: all `record-drafts` tests PASS.

- [ ] **Step 5: Run the frontend unit regression suite**

Run:

```powershell
node node_modules/vitest/vitest.mjs run
```

Expected: all existing and new Vitest tests PASS.

---

### Task 2: EMR chart drawer and transactional compare workflow

**Files:**
- Create: `src/components/handover/PatientRecordDrawer.tsx`
- Create: `src/components/handover/PatientRecordDrawer.test.tsx`
- Modify: `src/components/handover/PatientContextHeader.tsx`
- Modify: `src/components/handover/HandoverWorkspace.tsx`
- Modify: `src/components/handover/HandoverWorkspace.test.tsx`
- Modify: `src/app/globals.css`
- Modify: `e2e/handover-workspace.spec.ts`

**Interfaces:**
- Consumes: Task 1 draft functions, `DemoRecordPair`, `DemoPatientRecord`, and `comparePatientRecords(previous, current, signal?)`.
- Produces:

```ts
type PatientRecordDrawerProps = {
  open: boolean;
  pair: DemoRecordPair;
  patientName: string;
  busy: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onCompare: (current: DemoPatientRecord) => Promise<void> | void;
  onReset: () => Promise<void> | void;
};
```

`PatientContextHeader` adds optional `onOpenRecord?: () => void`; when absent, no control is rendered. `HandoverWorkspace` converts only complete `DemoRecordPair` values to the drawer contract and leaves minimal test fixtures unchanged.

- [ ] **Step 1: Write failing component tests for the drawer contract**

Add tests proving:

```ts
it("shows the previous chart read-only and the current chart as labelled structured inputs", ...);
it("submits a sanitized current record without exposing a JSON editor", ...);
it("closes with Escape and restores focus to the origin control", ...);
```

The submit test edits `체온` from `38.2` to `39.1`, adds one nursing note, clicks `변경사항 비교`, and asserts `onCompare` receives numeric `39.1`, the new note, unchanged `patient_id`, and no empty rows.

- [ ] **Step 2: Run the drawer test and verify RED**

Run:

```powershell
node node_modules/vitest/vitest.mjs run src/components/handover/PatientRecordDrawer.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the chart drawer with existing visual tokens**

Use a fixed backdrop and a right-side `role="dialog" aria-modal="true"`. Render `이전 기록` and `현재 기록` tabs; both use the same chart-section topology. Previous values render as text. Current values use labelled inputs for vitals, diagnoses, medications, notes, and `updated_at`. Keep patient identity fields read-only. Disable every modifying control while `busy` is true and render the exact inline error:

```text
비교하지 못했습니다. 기록을 확인한 뒤 다시 시도하세요.
```

Use existing CSS variables only. Desktop width is `min(680px, 100vw)`; below 600px it is full-screen. Body scrolling is locked only while open, reduced-motion users receive no slide animation, and the opening control regains focus after close.

- [ ] **Step 4: Run the drawer test and verify GREEN**

Run the Step 2 command. Expected: all drawer tests PASS.

- [ ] **Step 5: Write failing workspace integration tests**

Add tests proving:

```ts
it("opens the selected fictional chart and applies a successful edited comparison", ...);
it("keeps the last verified comparison and open draft when edited comparison fails", ...);
it("restores the bundled patient record and clears its session draft", ...);
it("invalidates a reviewed patient only after an edited comparison succeeds", ...);
```

The success test must assert one POST contains the edited structured record, the successful response becomes visible, the dialog closes, `sessionStorage` contains the patient draft, and source confirmation is reset. The failure test must assert the existing comparison remains visible and no session draft is written.

- [ ] **Step 6: Run the workspace test and verify RED**

Run:

```powershell
node node_modules/vitest/vitest.mjs run src/components/handover/HandoverWorkspace.test.tsx
```

Expected: new integration tests FAIL because no record workflow is connected.

- [ ] **Step 7: Implement transactional compare/apply in `HandoverWorkspace`**

Maintain applied record-pair overrides per patient. Load valid drafts once from `sessionStorage`. On manual compare:

```ts
const nextPair = { previous: basePair.previous, current: sanitizedDraft };
const nextResponse = await comparePatientRecords(nextPair.previous, nextPair.current);
```

Only in the success branch: persist the draft, install `nextPair`, install `nextResponse`, clear fallback state, mark the API state `success`, replace the patient review session with `createReviewSession(nextResponse)`, and close the drawer. In the error branch: keep all applied state unchanged, retain the open draft, and show the exact error from Step 3. Close the drawer when the selected patient changes.

- [ ] **Step 8: Run the workspace test and full unit suite**

Run:

```powershell
node node_modules/vitest/vitest.mjs run src/components/handover/HandoverWorkspace.test.tsx
node node_modules/vitest/vitest.mjs run
```

Expected: all tests PASS.

- [ ] **Step 9: Add and run the Playwright acceptance workflow**

Extend `e2e/handover-workspace.spec.ts` with a route-controlled test that opens P001, edits `체온` to `39.1`, submits, asserts the request payload contains numeric `39.1`, fulfills a valid response whose visible change contains `39.1`, and verifies the drawer closes. Also extend the 390/1024/1440 responsive smoke to open the drawer and assert horizontal overflow remains at most 1px. These are cross-component acceptance checks for behavior already driven by the failing unit and integration tests in Steps 1 and 5; run them and require PASS before the quality gate.

- [ ] **Step 10: Run focused E2E, lint, build, and harness gates**

Run:

```powershell
node node_modules/@playwright/test/cli.js test e2e/handover-workspace.spec.ts
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build
.venv/Scripts/python.exe scripts/check_harness.py --root .
.venv/Scripts/python.exe -m unittest discover -s tests -v
```

Expected: E2E, lint, build, harness check, and all Python tests PASS.
