# Handover Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vercel-ready nurse handover workspace that compares two fictional patient records, exposes evidence for every detected change, and produces a reviewable SBAR draft with deterministic fallback.

**Architecture:** Preserve the existing Streamlit app as a baseline. Extend the Python service layer with a structured, UI-independent comparison contract and expose it through one stateless FastAPI function. Build a separate Next.js App Router client that consumes the same JSON shape, keeps demo review state in the browser, and uses the Figma Make file only for tokens and patient-context conventions.

**Tech Stack:** Python 3.12, unittest, FastAPI, Pydantic, Next.js App Router, React, TypeScript, CSS, Vitest, Testing Library, Playwright, Vercel

**Spec:** `docs/product/handover-workspace-spec.md`

## Global Constraints

- Harness-Version is exactly `1.2.0`.
- Figma Make structure must not be copied; only its color, typography, status semantics, and patient-context conventions may be reused.
- The primary user flow is patient queue → previous/current comparison → evidence-backed SBAR review.
- All data is fictional; prototype scope and safety limits stay in README/product documentation rather than persistent clinical-workflow chrome.
- Deterministic Python logic owns fact detection. OpenAI may only rewrite already-detected facts.
- Every summary statement must reference one or more deterministic change IDs.
- `OPENAI_API_KEY` is server-only and must never use a `NEXT_PUBLIC_` prefix.
- AI key absence, timeout, provider error, and invalid structured output must return deterministic fallback.
- Vercel runtime code must not write to `data/` or depend on cross-request global state.
- Existing Streamlit behavior and the public functions `detect_changes()` and `generate_handover_text()` remain backward compatible.
- New behavior is developed test-first.
- Subagents must not modify `AGENTS.md`, `VERSION`, `CHANGELOG.md`, `docs/`, shared configuration, or user-owned `benchmark.py`, `human_eval.py`, and `data/human_eval_results.csv` unless a task explicitly grants that file.
- Subagents must not run git branch, commit, tag, push, reset, or checkout commands.

---

### Task 0: Supervisor-owned branch, dependencies, and toolchain scaffold

**Owner:** supervisor

**Files:**
- Modify: `requirements.txt`
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `eslint.config.mjs`
- Create: `playwright.config.ts`

**Interfaces:**
- Produces: Python imports for FastAPI, OpenAI, and API tests.
- Produces: pnpm scripts named `dev`, `build`, `start`, `lint`, `test`, `test:watch`, and `test:e2e`.

- [ ] **Step 1: Create an isolated `codex/0.5-handover-workspace` worktree after user consent**

Preserve all existing user-owned untracked files. Do not stage or move `benchmark.py`, `human_eval.py`, or `data/human_eval_results.csv`.

- [ ] **Step 2: Record the clean baseline**

Run:

```powershell
python scripts/check_harness.py --root .
python -m unittest discover -s tests -v
```

Expected: both commands exit 0 before feature code changes.

- [ ] **Step 3: Add and pin the required toolchains**

Resolve supported current releases from the official package registries and commit the resulting lock file. Python runtime dependencies are FastAPI, OpenAI, and Uvicorn; test dependency is HTTPX. Frontend runtime dependencies are Next.js, React, and React DOM; development dependencies are TypeScript, ESLint with Next configuration, Vitest, jsdom, Testing Library, and Playwright. Use the bundled pnpm `11.19.0` locally and record it in `packageManager`.

- [ ] **Step 4: Verify empty framework entrypoints compile only after Task 3 creates them**

At this step run dependency resolution and version-report commands only. `pnpm build` is intentionally deferred to Task 3 because no Next.js entrypoint exists yet.

---

### Task 1: Structured comparison engine

**Owner:** core-logic subagent, `gpt-5.6-luna`, reasoning `max`

**Files:**
- Modify: `services/handover_service.py`
- Create: `tests/test_handover_service.py`

**Interfaces:**
- Consumes: two patient dictionaries using the current fixture schema.
- Produces: `build_handover_comparison(previous: dict[str, Any] | None, current: dict[str, Any]) -> dict[str, Any]`.
- Preserves: `detect_changes(previous, current) -> list[str]` and `generate_handover_text(changes) -> str`.

- [ ] **Step 1: Write failing tests for every comparison type**

Create literal fixtures in `tests/test_handover_service.py`. Use a vital-only change fixture for the following exact first-item assertion, then use separate fixtures for the other change categories:

```python
comparison = build_handover_comparison(previous, current)

assert comparison["status"] == "ready"
assert comparison["patient"] == {
    "id": "P001",
    "name": "홍길동",
    "room": "301",
    "age": 67,
    "sex": "M",
    "diagnoses": ["acute pharyngitis", "hypertension"],
}
assert comparison["interval"] == {
    "previousRecordedAt": "2026-07-02T07:00:00+09:00",
    "currentRecordedAt": "2026-07-02T09:00:00+09:00",
}
assert comparison["changes"][0] == {
    "id": "vitals-body_temperature-modified",
    "category": "vitals",
    "changeType": "modified",
    "reviewPriority": "medium",
    "label": "체온",
    "previousValue": 37.9,
    "currentValue": 38.2,
    "delta": 0.3,
    "evidence": {
        "fieldPath": "vitals.body_temperature",
        "previousRecordedAt": "2026-07-02T07:00:00+09:00",
        "currentRecordedAt": "2026-07-02T09:00:00+09:00",
    },
}
```

Cover vital modification, medication added/removed/modified, diagnosis added/removed, note added/removed, unchanged records, missing previous record, and incomplete category/timestamp data. Assert stable ordering: high → medium → low, then category and ID.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `python -m unittest tests.test_handover_service -v`

Expected: FAIL because `build_handover_comparison` does not exist.

- [ ] **Step 3: Implement focused helpers and the structured result**

Use these exact enum values:

```python
CATEGORY_LABELS = {
    "vitals": {
        "systolic": "수축기 혈압",
        "diastolic": "이완기 혈압",
        "heartrate": "심박수",
        "respiratory": "호흡수",
        "saturation": "산소포화도",
        "body_temperature": "체온",
    }
}
PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
```

Medication and diagnosis changes use `high`; vital changes use `medium`; note changes use `low`. List deletions are first-class changes. A missing previous record returns `status="no_previous"`; zero changes returns `status="no_changes"`. If either record lacks `updated_at` or any of `diagnosis`, `vitals`, `medications`, or `notes`, return `status="partial"` and list the missing paths in sorted `dataWarnings`; still return every safely detectable change. Other statuses return an empty `dataWarnings` list. Do not infer improvement, deterioration, or clinical urgency.

- [ ] **Step 4: Preserve the Streamlit compatibility layer**

Implement `detect_changes()` as a formatted projection of the structured changes, retaining the existing Korean prefixes and medication formatting so existing query and Streamlit flows do not break.

- [ ] **Step 5: Run focused and full offline tests**

Run:

```powershell
python -m unittest tests.test_handover_service -v
python -m unittest discover -s tests -v
python scripts/check_harness.py --root .
```

Expected: all commands exit 0.

---

### Task 2: Deterministic SBAR contract and stateless FastAPI endpoint

**Owner:** core-logic subagent, `gpt-5.6-luna`, reasoning `max`

**Files:**
- Modify: `services/handover_service.py`
- Create: `api/index.py`
- Create: `api/__init__.py`
- Create: `tests/test_handover_api.py`

**Interfaces:**
- Consumes: Task 1 `build_handover_comparison()` result.
- Produces: `build_deterministic_summary(comparison: dict[str, Any]) -> dict[str, Any]`.
- Produces: `POST /api/handover/compare` accepting `{ "previous": object | null, "current": object }`.
- Returns: `{ "comparison": HandoverComparison, "summary": HandoverSummary }`.

- [ ] **Step 1: Write failing summary and API contract tests**

Assert the exact summary container:

```python
assert summary.keys() == {"mode", "sections", "evidenceIds", "warnings"}
assert summary["mode"] == "deterministic"
assert summary["sections"].keys() == {
    "situation", "background", "assessment", "recommendation"
}
assert summary["sections"]["recommendation"] == [
    {"text": "간호사가 확인할 후속 항목을 입력하세요.", "evidenceIds": []}
]
assert set(summary["evidenceIds"]) == {change["id"] for change in comparison["changes"]}
```

Use FastAPI `TestClient` to assert 200 for valid input, 422 for a missing current record, and that the endpoint never mutates fixture files.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `python -m unittest tests.test_handover_api -v`

Expected: FAIL because the API and summary builder do not exist.

- [ ] **Step 3: Implement evidence-backed deterministic SBAR**

Every generated item has this exact shape:

```python
{"text": "...", "evidenceIds": ["change-id"]}
```

Situation states patient, room, interval, and total change count. Background contains diagnosis and medication changes. Assessment contains vital and note changes. Recommendation remains the explicit user-entry prompt and must not contain inferred care advice.

- [ ] **Step 4: Implement the stateless FastAPI function**

`api/index.py` exports `app = FastAPI(...)`. It imports pure service functions, does not import Streamlit or storage write helpers, and handles only request data. Add `GET /api/health` returning `{ "status": "ok" }` for Vercel smoke testing.

- [ ] **Step 5: Run API, service, harness, and import checks**

Run:

```powershell
python -m unittest tests.test_handover_api tests.test_handover_service -v
python -m unittest discover -s tests -v
python -c "from api.index import app; print(app.title)"
python scripts/check_harness.py --root .
```

Expected: all commands exit 0; import output contains the API title and no secret value.

---

### Task 3: Next.js application shell and typed demo adapter

**Owner:** frontend subagent, `gpt-5.6-luna`, reasoning `max`

**Files:**
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/lib/contracts.ts`
- Create: `src/lib/demo-workspace-data.ts`
- Create: `src/lib/demo-adapter.ts`
- Create: `src/lib/demo-adapter.test.ts`
- Create: `src/test/setup.ts`
- Create: `src/components/handover/HandoverWorkspace.tsx`

**Interfaces:**
- Consumes: Task 2 response field names exactly.
- Produces: `HandoverComparison`, `HandoverSummary`, and `HandoverApiResponse` TypeScript types.
- Produces: `buildDemoWorkspaceData()` that reads imported fixture objects without writing to disk.

- [ ] **Step 1: Confirm the supervisor-provided toolchain**

Run `pnpm --version`, `pnpm test -- --run`, and inspect the script names. Do not modify package manifests or add a UI component library or icon package.

- [ ] **Step 2: Write failing adapter contract tests**

Assert that five patients are returned, timestamps are ISO strings, change lists use the Python contract field names, and no function writes or fetches during module import.

- [ ] **Step 3: Run the focused frontend test and confirm failure**

Run: `pnpm test -- src/lib/demo-adapter.test.ts`

Expected: FAIL because the adapter is not implemented.

- [ ] **Step 4: Implement the typed shell and demo adapter**

The initial `page.tsx` renders `HandoverWorkspace` with fixture-derived data. Keep comparison calculations out of React components. `src/lib/demo-workspace-data.ts` contains five checked-in API-shaped responses generated from the fictional repository fixtures; `demo-adapter.ts` validates and presents those responses until Task 5 wires the endpoint.

- [ ] **Step 5: Implement global tokens from the product spec**

Define CSS custom properties using the exact colors and typography roles in `docs/product/handover-workspace-spec.md`. Add visible focus styles, reduced-motion handling, and desktop/tablet/mobile breakpoints at 1280px and 960px.

- [ ] **Step 6: Run frontend checks**

Run:

```powershell
pnpm test
pnpm lint
pnpm build
```

Expected: all commands exit 0.

---

### Task 4: Patient queue and Shift Seam comparison workspace

**Owner:** frontend subagent, `gpt-5.6-luna`, reasoning `max`

**Files:**
- Modify: `src/components/handover/HandoverWorkspace.tsx`
- Create: `src/components/handover/PatientQueue.tsx`
- Create: `src/components/handover/PatientContextHeader.tsx`
- Create: `src/components/handover/ComparisonWorkspace.tsx`
- Create: `src/components/handover/ChangeCard.tsx`
- Create: `src/components/handover/HandoverWorkspace.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: Task 3 typed demo workspace data.
- Produces: selected patient state and a stable set of selected summary evidence IDs.

- [ ] **Step 1: Write failing user-flow tests**

Testing Library must verify:

```text
initial patient is selected
selecting another patient changes patient name and comparison timestamps
search filters by name, patient ID, and room
high-priority changes render before medium and low
every change shows previous value, current value, field path, and two timestamps
no_previous, no_changes, and partial states have distinct Korean messages
the safety notice remains visible
```

- [ ] **Step 2: Run the component test and confirm failure**

Run: `pnpm test -- src/components/handover/HandoverWorkspace.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the patient queue and patient context**

Use real fictional fixture content. Queue ordering is high-priority unreviewed, then other unreviewed, then reviewed. Do not introduce attending, code status, isolation, or allergy values absent from the source contract.

- [ ] **Step 4: Implement the Shift Seam**

Each card uses a consistent three-column reading order: previous value, direction/change label on the seam, current value. Evidence details are visible without a modal. Category and priority are written labels, not color-only signals.

- [ ] **Step 5: Implement responsive behavior**

At 960–1279px collapse the queue to a compact rail and keep comparison primary. Below 960px use an explicit patient → compare → summary sequence while preserving keyboard focus order.

- [ ] **Step 6: Run component, build, and harness checks**

Run:

```powershell
pnpm test
pnpm lint
pnpm build
python scripts/check_harness.py --root .
```

Expected: all commands exit 0.

---

### Task 5: Evidence-backed summary panel and API integration

**Owner:** frontend subagent, `gpt-5.6-luna`, reasoning `max`

**Files:**
- Modify: `src/components/handover/HandoverWorkspace.tsx`
- Create: `src/components/handover/SummaryPanel.tsx`
- Create: `src/lib/handover-api.ts`
- Create: `src/lib/handover-api.test.ts`
- Modify: `src/components/handover/HandoverWorkspace.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `POST /api/handover/compare` from Task 2.
- Produces: `comparePatientRecords(previous, current, signal?) -> Promise<HandoverApiResponse>`.
- Browser-only state: selected patient, evidence inclusion, recommendation text, reviewed status.

- [ ] **Step 1: Write failing API and summary interaction tests**

Assert successful mapping, invalid response rejection, network-failure fallback, evidence coverage count, evidence toggle behavior, manual recommendation editing, and reviewed-state confirmation.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```powershell
pnpm test -- src/lib/handover-api.test.ts
pnpm test -- src/components/handover/HandoverWorkspace.test.tsx
```

Expected: FAIL because the client and panel are missing.

- [ ] **Step 3: Implement validated API loading with deterministic fixture fallback**

Reject responses missing `comparison`, `summary`, change IDs, evidence paths, or summary evidence arrays. On fetch failure, retain the demo adapter response and show `서버 요약을 불러오지 못해 검증된 데모 결과를 표시합니다.`

- [ ] **Step 4: Implement the SBAR review panel**

Show mode, four sections, evidence links, included/total coverage, manual recommendation input, `원본 기록을 확인했습니다` checkbox, and a disabled-until-confirmed `검토 완료` button. Clicking an evidence link focuses and highlights the matching change card.

- [ ] **Step 5: Run frontend and full offline verification**

Run:

```powershell
pnpm test
pnpm lint
pnpm build
python -m unittest discover -s tests -v
python scripts/check_harness.py --root .
```

Expected: all commands exit 0.

---

### Task 6: Server-only OpenAI wording with deterministic fallback

**Owner:** core-logic subagent, `gpt-5.6-luna`, reasoning `max`

**Files:**
- Create: `services/openai_service.py`
- Modify: `api/index.py`
- Create: `tests/test_openai_service.py`
- Modify: `tests/test_handover_api.py`

**Interfaces:**
- Consumes: Task 2 deterministic comparison and summary.
- Produces: `rewrite_handover_summary(comparison, deterministic_summary, client) -> HandoverSummary`.
- Endpoint option: request field `summaryMode` with `deterministic | ai`, default `deterministic`.

- [ ] **Step 1: Write failing offline provider tests**

Use a fake client and assert that only patient identifiers, interval, structured changes, and deterministic summary are sent. Assert fallback for missing key, timeout, provider exception, malformed JSON, unknown evidence ID, changed numeric value, and additional unsupported statement.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `python -m unittest tests.test_openai_service -v`

Expected: FAIL because `openai_service` does not exist.

- [ ] **Step 3: Implement strict structured-output validation**

AI output may change sentence wording and section placement only. Every item must use existing evidence IDs; all original numbers, medication names, diagnoses, and note text must remain present verbatim when referenced. Any violation returns the deterministic summary with a warning code.

- [ ] **Step 4: Add opt-in API behavior**

`summaryMode="ai"` reads `OPENAI_API_KEY` only inside the server request path. Missing key returns HTTP 200 with deterministic summary and warning `AI_KEY_UNAVAILABLE`; provider failures return warning `AI_FALLBACK_USED`. Never log request clinical content or the key.

- [ ] **Step 5: Run offline and explicitly opted-in live tests**

Run offline first:

```powershell
python -m unittest tests.test_openai_service tests.test_handover_api -v
python -m unittest discover -s tests -v
```

Only when `.env` contains `OPENAI_API_KEY`, run one separate minimal live smoke test using fictional P001 changes and report its token/cost metadata without printing the key or payload.

---

### Task 7: End-to-end visual and Vercel readiness gate

**Owner:** supervisor; implementation fixes return to the responsible Luna Max subagent

**Files:**
- Create: `e2e/handover-workspace.spec.ts`
- Create: `vercel.json` only if local Vercel routing verification proves it is required
- Modify: `.github/workflows/harness.yml`
- Modify: `README.md`
- Modify: `docs/AGENT_WORKLOG.md`
- Modify: `CHANGELOG.md`
- Modify: `VERSION`

**Interfaces:**
- Consumes: completed Python API and Next.js UI.
- Produces: reproducible local and Preview verification evidence.

- [ ] **Step 1: Add failing end-to-end tests for the portfolio path**

Test P001 selection, a visible before/current value pair, evidence focus from the SBAR panel, fallback banner, review confirmation gating, and responsive layouts at 390×844, 1024×768, and 1440×900.

- [ ] **Step 2: Run E2E and capture baseline failure**

Run: `npx playwright test`

Expected before completion: at least one missing integration assertion fails.

- [ ] **Step 3: Route failures to the owning subagent and re-run**

Frontend layout/interaction failures return to the frontend implementer. Comparison/API/summary failures return to the core-logic implementer. The supervisor reviews the changed diff and reruns only after the responsible agent reports its covering tests.

- [ ] **Step 4: Perform visual QA against this spec, not the Figma composition**

Capture 1440px and 390px screenshots. Verify Shift Seam readability, three-region hierarchy, text labels without color dependence, truncation, overflow, focus visibility, and the absence of retired portfolio/disclaimer chrome.

- [ ] **Step 5: Run the complete local gate**

Run:

```powershell
python scripts/check_harness.py --root .
python -m unittest discover -s tests -v
pnpm test
pnpm lint
pnpm build
npx playwright test
```

Expected: all commands exit 0.

- [ ] **Step 6: Validate Vercel Preview before production**

Verify `/`, `/api/health`, and `/api/handover/compare`; verify deterministic mode with no key and AI fallback behavior. Production deployment is a separate user-approved action.

- [ ] **Step 7: Update version and durable documentation**

After all gates pass, set `VERSION` to `0.5.0`, add the release to `CHANGELOG.md`, and record commands, results, screenshots, known limits, and any supervisor rulings in `docs/AGENT_WORKLOG.md`.

---

### Task 8: Human-readable medication summary contract

**Owner:** core-logic Luna Max subagent

**Files:**
- Modify: `services/handover_service.py`
- Modify: `tests/test_handover_api.py` and/or `tests/test_handover_service.py`
- Modify only if compatibility coverage requires it: `tests/test_openai_service.py`

**Interfaces:**
- Consumes: deterministic medication changes with `name`, `route`, and `frequency`.
- Produces: clinician-readable SBAR text without serialized JSON while preserving evidence IDs and source values.

- [x] **Step 1: Add failing medication summary regression tests**

Cover added, removed, and modified medication changes. Assert the output includes the medication name, route, and frequency; assert it contains no JSON braces, quoted keys, or serialized object text.

- [x] **Step 2: Implement the smallest medication formatter**

Use a compact clinical display such as `타세놀정 500mg · PO · TID`. Keep deterministic comparison facts and evidence mappings unchanged.

- [x] **Step 3: Verify summary and AI-validation compatibility**

Run focused service/API/OpenAI tests, the full Python suite, and the harness check.

---

### Task 9: AI-first summary presentation and clinician-facing workspace copy

**Owner:** frontend Luna Max subagent

**Files:**
- Modify: `src/lib/handover-api.ts`
- Modify: `src/lib/handover-api.test.ts`
- Modify: `src/lib/demo-workspace-data.ts`
- Modify: `src/components/handover/SummaryPanel.tsx`
- Modify: `src/components/handover/HandoverWorkspace.tsx`
- Modify: `src/components/handover/HandoverWorkspace.test.tsx`
- Modify: `e2e/handover-workspace.spec.ts`
- Modify only if layout cleanup requires it: `src/app/globals.css`

**Interfaces:**
- Consumes: API summary modes `ai | deterministic` and warning codes `AI_KEY_UNAVAILABLE | AI_FALLBACK_USED`.
- Produces: AI mode requested by default, human-readable source/fallback labels, and no raw JSON or machine warning codes in the workflow UI.

- [x] **Step 1: Add failing request and rendering tests**

Assert the client sends `summaryMode: "ai"`; known warnings render as Korean fallback guidance; raw codes and raw medication JSON do not render; the two retired phrases are absent.

- [x] **Step 2: Implement AI-first request and presentation mapping**

Display `AI 요약` for AI output and `규칙 요약` for deterministic output. Map known fallback warnings to concise clinician-facing Korean copy and never expose raw warning codes.

- [x] **Step 3: Align checked-in demo fallback and remove retired copy**

Replace serialized medication fixtures with the Task 8 clinical display format. Remove `일반 성인병동 · 교대 검토` and `가상 데이터 · 의사결정 보조가 아님` from empty, header, summary, and responsive test paths.

- [x] **Step 4: Run frontend and E2E gates**

Run focused Vitest tests, the full frontend suite, lint, build, and Playwright E2E. Supervisor performs fresh desktop/mobile visual QA before documentation and version bookkeeping.

---

### Task 10: Compact clinical SBAR wording

**Owner:** core-logic Luna Max subagent

**Files:**
- Modify: `services/handover_service.py`
- Modify: `tests/test_handover_api.py` and/or `tests/test_handover_service.py`
- Modify only if validator compatibility requires it: `services/openai_service.py`, `tests/test_openai_service.py`

**Interfaces:**
- Consumes: the existing deterministic comparison contract and ISO-8601 interval timestamps.
- Produces: the same SBAR structure and evidence IDs with compact clinical wording; no fact, value, category, priority, or evidence mapping changes.

- [x] **Step 1: Add failing compact-wording regressions**

Cover a same-day interval and a cross-day interval. Same-day Situation must read `홍길동(P001) · 301호 · 07/02 07:00 → 09:00 · 변화 9건`; cross-day intervals must retain both dates, for example `07/01 21:00 → 07/02 09:00`. Add literal assertions that no raw ISO `T`, timezone suffix, or `사이에 총` boilerplate appears in Situation. Existing `no_previous` and `no_changes` semantics must remain distinguishable.

- [x] **Step 2: Implement a defensive interval display formatter**

Parse valid ISO-8601 timestamps and compact only the display string. For missing or invalid timestamps, preserve a readable fallback without raising. Do not mutate comparison timestamps or source records.

- [x] **Step 3: Preserve evidence and AI validation contracts**

Assert every change ID still appears exactly once across evidence-bearing summary items where required, and run the focused service/API/OpenAI tests plus the full Python and harness gates.

---

### Task 11: Evidence tray and clinical summary rail polish

**Owner:** frontend Luna Max subagent

**Files:**
- Modify: `src/components/handover/SummaryPanel.tsx`
- Modify: `src/components/handover/HandoverWorkspace.test.tsx`
- Modify: `src/lib/demo-workspace-data.ts`
- Modify: `src/app/globals.css`
- Modify: `e2e/handover-workspace.spec.ts`

**Interfaces:**
- Consumes: Task 10 compact SBAR text and unchanged evidence IDs.
- Produces: a quieter default summary rail whose evidence details remain fully reachable and focus the original change.

- [ ] **Step 1: Add failing evidence-presentation regressions**

Assert full evidence IDs are not visible in the default summary rail, each summary item exposes a labelled `근거 1건` or `근거 N건` disclosure, expanding it reveals the linked evidence controls, and activating a link still focuses the matching change. Add E2E coverage for collapsed-by-default evidence and one expand→focus path.

- [ ] **Step 2: Implement the compact evidence tray**

Use native accessible disclosure semantics. Keep individual inclusion toggles and evidence links inside the disclosure, replace visible IDs with short ordinal labels such as `근거 1`, and retain the full ID in accessible names/tooltips. Do not remove traceability or the review-completion gate.

- [ ] **Step 3: Tighten the summary rail hierarchy**

Keep the current Figma-derived tokens and three-region layout. Make section counts, primary statements, and the evidence disclosure the visual order; avoid new decoration, motion, or consumer-dashboard styling. Align checked-in demo Situation text with Task 10.

- [ ] **Step 4: Run frontend and visual gates**

Run focused/full Vitest, ESLint, Next build, and Playwright. Supervisor verifies 1440×900, 1024×768, and 390×844, including no horizontal overflow and a reachable evidence disclosure.
