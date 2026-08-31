# Return-to-Work Handover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 며칠간 근무하지 않은 간호사가 마지막 근무 이후의 현재 변화, 중간에 생겼다가 사라진 변화, 활력징후 추세와 기록 이벤트를 원본 근거까지 추적하며 검토할 수 있는 `휴무 복귀 인계` 모드를 구현한다.

**Architecture:** 기존 `이전 기록 → 현재 기록` 비교기는 그대로 보존하고, 새 기간 비교 서비스가 시간순 스냅샷의 인접 쌍마다 기존 비교기를 호출해 이벤트를 축적한다. 백엔드는 이벤트를 단일 사실 원천으로 반환하고 LLM은 검출 결과의 문장화만 담당한다. 프런트엔드는 기간 응답을 성공 시에만 원자적으로 교체하며, 근거 선택 시 해당 이벤트의 직전·현재 스냅샷을 읽기 전용으로 연다.

**Tech Stack:** Python 3, FastAPI, Pydantic, unittest, Next.js 16, React 19, TypeScript 6, Vitest, Testing Library, Playwright, CSS, Vercel Functions

**Spec:** `docs/superpowers/specs/2026-08-31-return-to-work-handover-design.md`

## Global Constraints

- Harness `1.2.0`을 적용한다. 구현자는 작업 시작 전에 루트 `AGENTS.md`, 담당 경로의 하위 `AGENTS.md`, 설계 문서와 이 계획을 읽고 지정된 `HARNESS_ACK` 형식으로 응답한다.
- 구현 작업은 사용자 지시에 따라 `gpt-5.6-luna`, reasoning `max` 하위 에이전트가 수행한다. 각 작업은 새 구현자와 새 읽기 전용 리뷰어를 사용한다.
- 하위 에이전트는 Git 명령, 버전 변경, 문서 변경, 다른 하위 에이전트 생성, 지정 파일 밖 수정을 하지 않는다. 커밋·버전·문서·통합은 감독 에이전트만 수행한다.
- 모든 임상 사실과 분류는 결정적 로직이 만든다. LLM은 이벤트 ID, 수치, 시각, 분류, 우선순위, 근거 수 또는 데이터 공백을 만들거나 바꾸지 못한다.
- 실제 환자정보를 사용하지 않는다. `.env`와 `OPENAI_API_KEY` 값을 출력·기록·커밋하지 않는다. 외부 API 테스트는 선택 사항이며 오프라인 테스트와 분리한다.
- 기존 `/api/handover/compare`, `직전 교대` 흐름, 현재 기록 편집, 세션 초안 저장을 회귀시키지 않는다.
- 새 의존성은 추가하지 않는다. Vercel 함수는 무상태로 유지하고 기간 결과를 서버 파일시스템에 저장하지 않는다.
- 같은 파일을 수정하는 작업은 순차 실행한다. 각 작업은 RED 확인 → 최소 구현 → 집중 테스트 → 감독 리뷰 → 감독 재검증 순으로 완료한다.
- 시각 구현(Task 6) 전에 감독 에이전트가 승인된 Figma 파일의 node `39:3`을 MCP로 다시 확인한다. 토큰과 제품 맥락만 참고하고 화면 구성은 이 기능 설계를 따른다.
- 각 작업 커밋은 감독 에이전트만 수행하며, 작업별 커밋 뒤 `docs/AGENT_WORKLOG.md`에 검증 근거를 기록한다.

## File Structure Map

| Layer | Files | Responsibility |
|---|---|---|
| Demo timeline data | `data/timelines/P001.json` … `P005.json` | 환자별 8개 스냅샷, 기본 복귀 시작 시각, 명시적 데이터 공백 |
| Deterministic period logic | `services/handover_period_service.py` | 정렬·검증, 인접 비교, lifecycle 분류, review group, 결정적 SBAR |
| Optional AI wording | `services/openai_period_service.py` | 결정적 사실을 보존한 문장 다듬기와 실패 fallback |
| API | `api/index.py` | `/api/handover/period-compare` 요청 검증과 응답 조립 |
| Frontend contracts/data | `src/lib/handover-period-contracts.ts`, `demo-timelines.ts`, `handover-period-api.ts` | 런타임 검증, 데모 데이터 적재, API 호출 |
| Frontend orchestration | `src/components/handover/useReturnHandover.ts`, `HandoverWorkspace.tsx` | 모드, 기간 선택, 캐시, 요청 세대, 성공 응답 트랜잭션 |
| Frontend UI | `ReturnHandoverControls.tsx`, `ReturnComparisonWorkspace.tsx`, `ReturnSummaryPanel.tsx` | 복귀 인계 조작·기간 변화·SBAR·근거 표현 |
| Existing record view | `PatientRecordWorkspace.tsx`, `PatientContextHeader.tsx` | 이벤트의 정확한 직전/현재 원본 보기, 기간 맥락 표시 |
| Styling/E2E | `src/app/globals.css`, `e2e/handover-workspace.spec.ts` | 임상 워크벤치 통합, 반응형·접근성·핵심 사용자 여정 |
| Release/docs | `VERSION`, `package.json`, `CHANGELOG.md`, `README.md`, `docs/AGENT_WORKLOG.md` | 0.8.0 릴리스와 검증 이력 |

---

### Task 1: Build the five-patient timeline fixture pack

**Role:** core-logic agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 가상 환자 5명에게 각각 8개 시점과 최소 66시간의 기간 데이터를 제공하고, 마지막 시점이 현재 데모 기록과 정확히 일치하도록 한다.

**Files:**

- Create: `data/timelines/P001.json`
- Create: `data/timelines/P002.json`
- Create: `data/timelines/P003.json`
- Create: `data/timelines/P004.json`
- Create: `data/timelines/P005.json`
- Create: `tests/test_handover_timeline_fixtures.py`
- Read only: `data/patients/*.json`, `data/history/**`, `docs/superpowers/specs/2026-08-31-return-to-work-handover-design.md`
- Do not modify: services, API, frontend, docs/config/version, Git state

**Fixture contract:**

```json
{
  "patientId": "P001",
  "defaultReturnStartAt": "2026-06-29T15:00:00+09:00",
  "snapshots": [{ "recorded_at": "2026-06-29T15:00:00+09:00" }],
  "coverageGaps": [{ "from": "2026-06-30T15:00:00+09:00", "to": "2026-07-01T07:00:00+09:00", "code": "source_unavailable" }]
}
```

- [ ] **Step 1: Write fixture-validation tests first**

```python
def test_each_timeline_has_eight_ordered_snapshots_and_66_hour_span(self):
    for patient_id in PATIENT_IDS:
        timeline = load_timeline(patient_id)
        self.assertEqual(8, len(timeline["snapshots"]))
        stamps = [parse_iso(item["recorded_at"]) for item in timeline["snapshots"]]
        self.assertEqual(stamps, sorted(stamps))
        self.assertGreaterEqual(stamps[-1] - stamps[0], timedelta(hours=66))

def test_last_snapshot_matches_current_patient_fixture(self):
    for patient_id in PATIENT_IDS:
        self.assertEqual(load_patient(patient_id), load_timeline(patient_id)["snapshots"][-1])
```

Add literal tests that all records keep the same patient identity, `defaultReturnStartAt` matches a snapshot, only P003 has one explicit coverage gap, no file contains real-person identifiers, and P001 has the exact eight timestamps below.

- [ ] **Step 2: Run the fixture tests and confirm RED**

Run: `python -m unittest tests.test_handover_timeline_fixtures -v`

Expected: FAIL because `data/timelines/*.json` does not exist.

- [ ] **Step 3: Create the minimal fixture pack**

P001 timestamps and intended adjacent changes are binding:

| # | Timestamp (+09:00) | Intent |
|---|---|---|
| 1 | 2026-06-29 15:00 | baseline; same clinical state as 2026-07-01 21:00 except timestamp |
| 2 | 2026-06-29 23:00 | add fictional `생리식염주 500mL`, IV, QD |
| 3 | 2026-06-30 07:00 | ibuprofen BID→TID; temperature 37.4→38.0 |
| 4 | 2026-06-30 15:00 | remove saline; temperature 38.0→37.5 |
| 5 | 2026-07-01 07:00 | ibuprofen TID→BID; temperature 37.5→37.4 |
| 6 | 2026-07-01 21:00 | reuse the existing historical record state; no new clinical change from #5 |
| 7 | 2026-07-02 07:00 | reuse existing historical record; expected 8 adjacent events |
| 8 | 2026-07-02 09:00 | exact `data/patients/P001.json`; expected 9 adjacent events |

This produces 24 deterministic P001 events once Task 2 uses the existing comparator. P002/P004/P005 must each exercise at least two categories. P003 alone carries one explicit `coverageGaps` entry whose bounds sit inside the requested period.

- [ ] **Step 4: Run focused and existing fixture tests**

Run: `python -m unittest tests.test_handover_timeline_fixtures -v`

Expected: PASS.

Run: `python -m unittest discover -s tests -v`

Expected: existing 60 tests plus new fixture tests PASS.

- [ ] **Step 5: Report for supervisor review**

Stop and report if any current patient fixture cannot be represented as the eighth snapshot without changing it, if a timestamp is naive, or if P001 cannot preserve the 24-event setup. Do not reinterpret clinical meaning silently.

- [ ] **Step 6: Supervisor-only commit after independent review**

```text
feat: add return handover timeline fixtures
```

---

### Task 2: Implement deterministic period comparison and summary

**Role:** core-logic agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 시간순 인접 기록 비교로 기간 이벤트를 만들고, 현재 변화·기간 중 변화·추세·기록 이벤트를 근거 ID와 함께 결정적으로 분류한다.

**Files:**

- Create: `services/handover_period_service.py`
- Create: `tests/test_handover_period_service.py`
- Read only: `services/handover_service.py`, `data/timelines/*.json`, `services/AGENTS.md`, `tests/AGENTS.md`
- Do not modify: existing comparator, API, frontend, docs/config/version, fixtures, Git state

**Public interfaces:**

```python
def build_handover_period_comparison(
    records: list[dict[str, Any]],
    review_start_at: str,
    coverage_gaps: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Return the validated deterministic period comparison."""
    raise RuntimeError("implemented by Task 2")

def build_deterministic_period_summary(
    period_comparison: dict[str, Any],
) -> dict[str, Any]:
    """Return SBAR items that reference period event IDs."""
    raise RuntimeError("implemented by Task 2")
```

- [ ] **Step 1: Write literal RED tests for validation and chronology**

Create four named cases: `test_sorts_input_but_rejects_duplicate_timestamps`, `test_rejects_mixed_patient_identity_and_naive_iso_timestamp`, `test_reports_no_baseline_but_keeps_available_post_start_events`, and `test_reports_partial_only_for_explicit_coverage_gap`. Each case must use a literal fixture and assert the exact status or exception message.

Assert offset-aware ISO timestamps, same patient identity, independently sorted input, duplicate rejection, actual baseline at or before the selected start, current as the latest record, and `ready|no_baseline|no_events|partial` status.

- [ ] **Step 2: Write lifecycle and single-source RED tests**

```python
def test_p001_produces_exactly_24_stable_events(self):
    timeline = load_timeline("P001")
    result = build_handover_period_comparison(
        timeline["snapshots"],
        timeline["defaultReturnStartAt"],
        timeline["coverageGaps"],
    )
    self.assertEqual(24, result["period"]["eventCount"])
    self.assertEqual(24, len(result["events"]))
```

Add separate literal cases named `test_transient_saline_add_and_remove_are_period_only`, `test_reverted_ibuprofen_frequency_keeps_each_event_and_links_history`, `test_current_removed_item_is_classified_current`, and `test_review_items_reference_existing_event_ids_only`.

For every event assert:

```python
{
    "id": "event:P001:medications:saline:2026-06-29T23:00:00+09:00:added",
    "detectedAt": "2026-06-29T23:00:00+09:00",
    "interval": {
        "previousRecordedAt": "2026-06-29T15:00:00+09:00",
        "currentRecordedAt": "2026-06-29T23:00:00+09:00"
    },
    "classification": "period_only",
    "change": {
        "category": "medications",
        "changeType": "added",
        "label": "생리식염주 500mL"
    }
}
```

Review groups contain only `{id, category, label, classification, eventIds}`. Values and evidence remain exclusively in `events[].change`.

- [ ] **Step 3: Run tests and confirm RED**

Run: `python -m unittest tests.test_handover_period_service -v`

Expected: FAIL because the service is absent.

- [ ] **Step 4: Implement validation and adjacent-pair aggregation**

```python
ordered = sorted(records, key=lambda record: parse_recorded_at(record["recorded_at"]))
pair_results = [
    build_handover_comparison(previous, current)
    for previous, current in zip(ordered, ordered[1:])
]
```

Select the baseline as the latest snapshot whose `recorded_at <= review_start_at`; compare every adjacent pair from the baseline forward. With no baseline, compare available adjacent records after the requested start and return `no_baseline`. Do not infer coverage gaps from elapsed time.

- [ ] **Step 5: Implement lifecycle classification and stable ordering**

For diagnoses and medications, compare the normalized baseline value with the current value:

- Different, including removed/stopped: `current`.
- Same, but one or more intermediate changes occurred and reverted: `period_only`.
- Vitals: `trend` in chronological order, without normal/worse inference.
- Notes: `record_event`, without resolved/completed inference.

Reuse only existing `high|medium|low` priority. Sort high before medium before low, then newest `detectedAt`, category, stable ID. Create IDs only from deterministic patient/category/field/interval/change data; never from list index or random values.

- [ ] **Step 6: Implement deterministic SBAR summary**

Return:

```python
{
    "mode": "deterministic",
    "sections": {"situation": [], "background": [], "assessment": [], "recommendation": []},
    "evidenceIds": [event["id"] for event in period_comparison["events"]],
    "warnings": [],
}
```

Situation includes patient/room/actual baseline/current/event count; Background includes diagnosis and medication items from both current and period-only groups; Assessment includes vital trends and note events; Recommendation uses the existing fixed wording `간호사가 확인할 후속 항목을 입력하세요.` exactly. Every summary item references existing event IDs.

- [ ] **Step 7: Run focused and full backend tests**

Run: `python -m unittest tests.test_handover_period_service -v`

Expected: PASS.

Run: `python -m unittest discover -s tests -v`

Expected: PASS with no change to existing pair-comparison expectations.

- [ ] **Step 8: Supervisor-only commit after independent review**

```text
feat: add deterministic return handover comparison
```

---

### Task 3: Add the period API and constrained AI wording fallback

**Role:** core-logic agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 새 기간 비교 API를 제공하고, AI 사용 여부와 무관하게 동일한 검출 사실과 근거를 보존한다.

**Files:**

- Modify: `api/index.py`
- Create: `services/openai_period_service.py`
- Create: `tests/test_handover_period_api.py`
- Create: `tests/test_openai_period_service.py`
- Read only: `services/openai_service.py`, `services/handover_period_service.py`, existing API tests
- Do not modify: pair endpoint/service, fixtures, frontend, docs/config/version, Git state

**Request and response boundary:**

```python
class HandoverPeriodCompareRequest(BaseModel):
    reviewStartAt: str
    records: list[dict[str, Any]]
    coverageGaps: list[CoverageGap] = []
    summaryMode: Literal["deterministic", "ai"] = "deterministic"
```

Response includes `patient`, `period`, `dataWarnings`, `events`, `reviewGroups`, and `summary` exactly as specified. The endpoint is `POST /api/handover/period-compare`.

- [ ] **Step 1: Write endpoint RED tests**

Create five named cases: `test_period_compare_returns_deterministic_p001_response`, `test_unsorted_records_are_sorted_and_duplicate_times_return_422`, `test_mixed_patient_or_invalid_current_record_returns_422`, `test_no_baseline_and_partial_are_successful_domain_states`, and `test_existing_pair_compare_contract_is_unchanged`. Use P001 for the 24-event response, reverse a copy of its records for sorting, duplicate its first timestamp for the 422 case, and call the existing pair fixture for the regression assertion.

Assert exact P001 event count, the four review group keys, actual interval values, evidence coverage, and no leaked API key.

- [ ] **Step 2: Write AI boundary RED tests**

Public interface:

```python
def rewrite_handover_period_summary(
    period_comparison: dict[str, Any],
    deterministic_summary: dict[str, Any],
    client: Any,
) -> dict[str, Any]:
    """Return validated AI wording or the deterministic fallback."""
    raise RuntimeError("implemented by Task 3")
```

Test valid structured wording, timeout/provider exception, malformed JSON, invented event ID, changed value/count/time/classification/priority/gap, and missing evidence. Every invalid case must return the deterministic summary with a warning; it must not raise an HTTP error.

- [ ] **Step 3: Run tests and confirm RED**

Run: `python -m unittest tests.test_handover_period_api tests.test_openai_period_service -v`

Expected: FAIL because the route and AI service are absent.

- [ ] **Step 4: Implement the endpoint with server-only key access**

```python
comparison = build_handover_period_comparison(
    request.records,
    request.reviewStartAt,
    [gap.model_dump() for gap in request.coverageGaps],
)
summary = build_deterministic_period_summary(comparison)
```

Only when `summaryMode == "ai"` and `OPENAI_API_KEY` is present, send the minimum fictional event/summary structure to the provider. Do not send raw unrelated records. Keep current `/api/handover/compare` untouched.

- [ ] **Step 5: Implement strict AI output validation**

Validate the returned summary against the deterministic event map. Preserve all event IDs and evidence relationships. Append a machine-readable/user-readable warning on fallback, matching existing warning conventions.

- [ ] **Step 6: Run focused and full backend tests**

Run: `python -m unittest tests.test_handover_period_api tests.test_openai_period_service -v`

Expected: PASS.

Run: `python -m unittest discover -s tests -v`

Expected: PASS. External provider calls are not required.

- [ ] **Step 7: Supervisor-only commit after independent review**

```text
feat: expose return handover period API
```

---

### Task 4: Add frontend contracts, timeline adapter, and API client

**Role:** frontend agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 백엔드 기간 계약을 엄격히 검증하고 데모 타임라인과 API 요청을 UI에 안전하게 제공한다.

**Files:**

- Create: `src/lib/handover-period-contracts.ts`
- Create: `src/lib/handover-period-contracts.test.ts`
- Create: `src/lib/demo-timelines.ts`
- Create: `src/lib/demo-timelines.test.ts`
- Create: `src/lib/handover-period-api.ts`
- Create: `src/lib/handover-period-api.test.ts`
- Read only: `src/lib/contracts.ts`, `src/lib/demo-adapter.ts`, `src/lib/handover-api.ts`, `data/timelines/*.json`
- Do not modify: components/CSS, Python, fixtures, docs/config/version, Git state

**Type boundary:**

```ts
export type PeriodClassification = "current" | "period_only" | "trend" | "record_event";
export type PeriodStatus = "ready" | "no_baseline" | "no_events" | "partial";

export type PeriodEvent = {
  id: string;
  detectedAt: string;
  interval: { previousRecordedAt: string; currentRecordedAt: string };
  classification: PeriodClassification;
  change: HandoverChange;
};
```

- [ ] **Step 1: Write strict parser RED tests**

Test a complete success response and reject unknown status/classification, missing interval, dangling review-group event ID, duplicate event ID, bad patient identity, and AI summary evidence ID not present in events.

- [ ] **Step 2: Write timeline adapter RED tests**

```ts
expect(getDemoTimeline("P001").snapshots).toHaveLength(8);
expect(getDemoTimeline("P001").snapshots.at(-1)).toEqual(getDemoRecordPair("P001").current);
expect(listReturnStartOptions("P001")).toContain("2026-06-29T15:00:00+09:00");
```

The adapter only loads and validates supplied data. It must not infer clinical classification or missing periods.

- [ ] **Step 3: Write API client RED tests**

```ts
await requestHandoverPeriodComparison({
  reviewStartAt,
  records,
  coverageGaps,
  summaryMode: "deterministic",
}, { signal });
```

Assert exact URL/body, runtime response validation, abort propagation, 422 mapping, network error mapping, and no API key in browser request headers/body.

- [ ] **Step 4: Run tests and confirm RED**

Run: `pnpm test -- src/lib/handover-period-contracts.test.ts src/lib/demo-timelines.test.ts src/lib/handover-period-api.test.ts`

Expected: FAIL because modules are absent.

- [ ] **Step 5: Implement minimal contracts, adapter, and client**

Reuse `HandoverChange` and existing error conventions instead of duplicating pairwise types. Validate event-reference integrity once at the response boundary.

- [ ] **Step 6: Run focused checks**

Run: `pnpm test -- src/lib/handover-period-contracts.test.ts src/lib/demo-timelines.test.ts src/lib/handover-period-api.test.ts`

Expected: PASS.

Run: `pnpm exec eslint src/lib/handover-period-contracts.ts src/lib/demo-timelines.ts src/lib/handover-period-api.ts`

Run: `pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Supervisor-only commit after independent review**

```text
feat: add return handover frontend data boundary
```

---

### Task 5: Implement transactional return-handover state orchestration

**Role:** frontend agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 환자·복귀 시작 시각·현재 초안에 따라 기간 비교를 요청하고, 최신 성공 응답만 화면 상태로 교체한다.

**Files:**

- Create: `src/components/handover/useReturnHandover.ts`
- Create: `src/components/handover/useReturnHandover.test.tsx`
- Modify: `src/components/handover/HandoverWorkspace.tsx`
- Modify: `src/components/handover/HandoverWorkspace.test.tsx`
- Read only: period lib modules, `record-drafts.ts`, existing component contracts
- Do not modify: presentational components/CSS, Python, fixtures, docs/config/version, Git state

**Hook boundary:**

```ts
type ReturnHandoverKey = `${string}:${string}:${string}`;

export function useReturnHandover(input: {
  patientId: string;
  reviewStartAt: string;
  records: HandoverRecord[];
  currentRecordFingerprint: string;
  enabled: boolean;
}): {
  status: "idle" | "loading" | "success" | "error";
  response: HandoverPeriodApiResponse | null;
  error: HandoverApiError | null;
  retry(): void;
};
```

- [ ] **Step 1: Write hook RED tests for concurrency and cache**

Test deterministic normalized-current fingerprinting, key `patientId + reviewStartAt + currentRecordFingerprint`, request abortion, stale response rejection, latest-response-only success, same-key cache reuse, and failures preserving the last successful response.

- [ ] **Step 2: Write workspace RED tests for state transitions**

Test:

- Default mode remains `직전 교대`.
- Selecting `휴무 복귀` defaults to the timeline's `defaultReturnStartAt`.
- Patient/start-time changes trigger the correct request.
- Successful period change resets recommendation and review checkbox.
- Loading or failed request does not reset or replace the visible successful period/recommendation.
- Editing the current record changes the fingerprint and recomputes; `sessionStorage` still stores only the current draft, never period responses.
- Returning to pair mode restores its prior successful state.

- [ ] **Step 3: Run tests and confirm RED**

Run: `pnpm test -- src/components/handover/useReturnHandover.test.tsx src/components/handover/HandoverWorkspace.test.tsx`

Expected: FAIL because the hook and new mode do not exist.

- [ ] **Step 4: Implement the hook with request generation guard**

```ts
const generation = ++generationRef.current;
const next = await requestHandoverPeriodComparison(payload, { signal: controller.signal });
if (generation !== generationRef.current) return;
setState({ status: "success", response: next, error: null });
```

Keep a module-local/in-hook bounded `Map` cache for the browser session only. Do not persist period results. Cache only validated successful responses.

- [ ] **Step 5: Wire domain mode into `HandoverWorkspace`**

Keep existing workspace tabs (`comparison|record`) separate from the handover scope (`shift|return`). The domain mode selector belongs above the comparison content. Do not overload `WorkspaceModeTabs` with a third semantic axis.

- [ ] **Step 6: Run focused and frontend-wide checks**

Run: `pnpm test -- src/components/handover/useReturnHandover.test.tsx src/components/handover/HandoverWorkspace.test.tsx`

Expected: PASS.

Run: `pnpm test`

Run: `pnpm exec eslint src/components/handover/useReturnHandover.ts src/components/handover/HandoverWorkspace.tsx`

Run: `pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Supervisor-only commit after independent review**

```text
feat: orchestrate transactional return handover state
```

---

### Task 6: Build the return-handover clinical workbench UI

**Precondition:** Supervisor must inspect the approved Figma design node `39:3` via MCP and record the token/context findings before dispatching this task. If Figma is unavailable, pause; the harness forbids visual implementation without review.

**Role:** frontend agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 기존 임상 워크벤치 안에서 복귀 기간 변화와 근거를 읽기 쉬운 크기로 보여주고, 해당 이벤트의 정확한 원본 스냅샷으로 이동시킨다.

**Files:**

- Create: `src/components/handover/ReturnHandoverControls.tsx`
- Create: `src/components/handover/ReturnHandoverControls.test.tsx`
- Create: `src/components/handover/ReturnComparisonWorkspace.tsx`
- Create: `src/components/handover/ReturnComparisonWorkspace.test.tsx`
- Create: `src/components/handover/ReturnSummaryPanel.tsx`
- Create: `src/components/handover/ReturnSummaryPanel.test.tsx`
- Modify: `src/components/handover/HandoverWorkspace.tsx`
- Modify: `src/components/handover/HandoverWorkspace.test.tsx`
- Modify: `src/components/handover/PatientContextHeader.tsx`
- Modify: `src/components/handover/PatientRecordWorkspace.tsx`
- Modify: `src/app/globals.css`
- Do not modify: lib contracts/API, Python, fixtures, docs/config/version, Git state

**UI contract:**

- Handover scope: `직전 교대 | 휴무 복귀`.
- Last-work selector uses only available snapshot times.
- Context displays `3일 복귀 인계`, actual baseline→current, and a clear warning when requested start differs from actual baseline.
- Center sections: `현재도 유효한 변화`, `기간 중 발생 후 변경된 사항`, `활력징후 추세`, `전체 타임라인`.
- Each row shows detected record time, category, concrete change, status, and visible `근거 보기`.
- Right rail shows total/current/period-only/evidence coverage, SBAR, recommendation input, source confirmation, and review completion.
- No text claiming medical decision support, normal/abnormal judgment, resolved/completed state, or a precisely known occurrence time.

- [ ] **Step 1: Write controls and workspace RED tests**

```tsx
expect(screen.getByRole("radio", { name: "휴무 복귀" })).toBeChecked();
expect(screen.getByRole("combobox", { name: "마지막 근무 시각" })).toHaveValue("2026-06-29T15:00:00+09:00");
expect(screen.getByRole("heading", { name: "기간 중 발생 후 변경된 사항" })).toBeVisible();
expect(screen.getByText("생리식염주 500mL")).toBeVisible();
```

Test empty groups, `no_baseline`, `no_events`, `partial`, loading overlay/status, recoverable error, exact counts, and no duplicated change values outside `events[].change` adaptation.

- [ ] **Step 2: Write evidence-navigation RED tests**

Clicking an event's `근거 보기` must open `PatientRecordWorkspace` with the exact `previousRecordedAt` and `currentRecordedAt` snapshots. Historical snapshots are read-only; only the actual latest current snapshot may expose edit/save/reset controls. Closing returns focus to the triggering evidence button.

- [ ] **Step 3: Write right-rail RED tests**

Assert total/current/period-only counts, `evidenceIds / events` coverage, four SBAR sections, warning visibility, recommendation preservation during failed reload, and disabled review completion until source confirmation is checked.

- [ ] **Step 4: Run tests and confirm RED**

Run: `pnpm test -- src/components/handover/ReturnHandoverControls.test.tsx src/components/handover/ReturnComparisonWorkspace.test.tsx src/components/handover/ReturnSummaryPanel.test.tsx src/components/handover/HandoverWorkspace.test.tsx`

Expected: FAIL because presentational components are absent.

- [ ] **Step 5: Implement semantic components and exact evidence binding**

Pass `PeriodEvent` objects or event IDs into presentation components; never copy clinical values into a second UI-only model. Add one explicit callback:

```ts
onOpenEvidence(eventId: string): void
```

Resolve the two source snapshots from the event interval in the orchestrator and fail visibly if either snapshot is unavailable.

- [ ] **Step 6: Apply Figma-derived tokens and readable density**

Preserve the existing integrated clinical workbench, 0.7.2 wide-screen rails, and current typography gains. Use existing CSS variables, 11–12px minimum clinical body text, clearly larger evidence controls, and remove avoidable central whitespace by letting change content consume available width. Do not append a second global theme or raw color system.

- [ ] **Step 7: Run focused tests, lint, and typecheck**

Run: `pnpm test -- src/components/handover/ReturnHandoverControls.test.tsx src/components/handover/ReturnComparisonWorkspace.test.tsx src/components/handover/ReturnSummaryPanel.test.tsx src/components/handover/HandoverWorkspace.test.tsx`

Run: `pnpm exec eslint src/components/handover/ReturnHandoverControls.tsx src/components/handover/ReturnComparisonWorkspace.tsx src/components/handover/ReturnSummaryPanel.tsx src/components/handover/HandoverWorkspace.tsx src/components/handover/PatientContextHeader.tsx src/components/handover/PatientRecordWorkspace.tsx`

Run: `pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 8: Supervisor performs browser review before progression**

Check P001 at 2544×1258 and 1440×900 first: evidence text/buttons must be readable, the center must not have an artificial empty band, and all four period sections must scan in clinical priority order. Any defect returns to the same implementer for one fix round before Task 7.

- [ ] **Step 9: Supervisor-only commit after independent review**

```text
feat: add return handover clinical workspace
```

---

### Task 7: Complete responsive, accessibility, and end-to-end coverage

**Role:** frontend agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 핵심 복귀 인계 흐름을 브라우저 수준에서 증명하고 모든 지원 뷰포트에서 잘림 없이 사용할 수 있게 한다.

**Files:**

- Modify: `e2e/handover-workspace.spec.ts`
- Modify only if a failing E2E demonstrates a defect: `src/app/globals.css`, Task 6 components and their tests
- Do not modify: backend/lib contracts/fixtures, docs/config/version, Git state

- [ ] **Step 1: Add the P001 return-handover E2E before fixing presentation defects**

The test must:

1. Select P001 and `휴무 복귀`.
2. Confirm default three-day baseline and 24 events.
3. Find transient saline and reverted ibuprofen history.
4. Open one event's evidence and assert exact two timestamps/read-only history.
5. Edit the current record, save, wait for a successful recomparison, and assert only then that review/recommendation resets.
6. Confirm the right-rail source checkbox and complete review.

- [ ] **Step 2: Add API-state E2E cases**

Route-mock `partial`, `no_baseline`, `no_events`, slow older request followed by fast newer request, and failure after a prior success. Assert warnings and that stale/failed responses never replace the current success.

- [ ] **Step 3: Add accessibility assertions**

Assert keyboard operation for mode/start selector, visible focus for evidence buttons, headings/landmarks, live loading/error status, focus return from evidence view, and no status conveyed only by color.

- [ ] **Step 4: Add viewport matrix and confirm any RED**

Test at 2544, 1600, 1440, 1279, 1024, 960, and 390 CSS-pixel widths. At every width assert `scrollWidth <= clientWidth` for page and each rail. At 390, event rows stack to one column. At 960–1279, no center content paints below the summary rail. At >=1600, retain 304px patient rail and 400px review rail.

Run: `pnpm test:e2e -- --grep "return handover"`

Expected before responsive fixes: any discovered geometry/accessibility regression fails with a literal assertion.

- [ ] **Step 5: Make only evidence-driven CSS/component fixes**

Do not broadly rewrite `globals.css`. Change only selectors proven by the new tests, preserve existing pair mode at all widths, and add a component regression test for every behavioral fix.

- [ ] **Step 6: Run complete frontend verification**

Run: `pnpm test`

Run: `pnpm test:e2e`

Run: `pnpm lint`

Run: `pnpm exec tsc --noEmit`

Run: `pnpm build`

Expected: all PASS. If port 3000 is occupied, use the documented `PLAYWRIGHT_BASE_URL` against a verified current build and record the exact port.

- [ ] **Step 7: Supervisor browser check and independent review**

The supervisor checks the required widths personally, compares against the Figma token/context review, and sends all Important findings back to the same implementer. If a major issue remains after the fix round, stop and report to the user.

- [ ] **Step 8: Supervisor-only commit after review**

```text
test: cover return handover clinical workflow
```

---

### Task 8: Release, document, deploy, and smoke-test 0.8.0

**Role:** supervisor only

**Goal:** 검증된 복귀 인계 기능을 문서화하고 Vercel 운영 배포에서 재현 가능하게 만든다.

**Files:**

- Modify: `VERSION`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/AGENT_WORKLOG.md`
- Modify if user-facing instructions changed: `README.md`
- Modify if deployment behavior changed: `docs/conventions/deployment.md`

- [ ] **Step 1: Run the complete quality gate from a clean worktree**

```powershell
python scripts/check_harness.py --root .
python -m unittest discover -s tests -v
pnpm test
pnpm test:e2e
pnpm lint
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Record test counts and exact commands. Do not claim an external OpenAI call passed unless it was actually executed. Deterministic fallback is the release blocker; paid-provider availability is not.

- [ ] **Step 2: Run an independent final read-only review**

Review spec compliance, factual traceability, event/reference integrity, pair-mode regression, browser security boundary, responsive geometry, accessibility, and Vercel statelessness. Fix all Critical/Important findings and rerun the affected focused tests plus the full gate.

- [ ] **Step 3: Update version and release notes**

Set both `VERSION` and `package.json` to `0.8.0`. Add a changelog entry covering:

- 5×8 fictional timeline pack.
- Deterministic multi-snapshot comparison and lifecycle classification.
- Constrained AI/fallback summary.
- Return-handover controls, period review, exact evidence navigation.
- Responsive/accessibility/E2E coverage.
- Known limitation: prototype data only; no shared persistence or real EMR connection.

- [ ] **Step 4: Update the worklog and operating instructions**

Document each agent ACK, owned files, RED/GREEN evidence, reviewer verdict/fix round, Figma review checkpoint, complete verification, and any skipped external API test. Update README only with the minimum needed demo path: P001 → 휴무 복귀 → 3-day baseline → period-only saline → evidence.

- [ ] **Step 5: Commit and publish through the approved Git workflow**

```text
docs: release return handover 0.8.0
```

Push `codex/0.8.0-return-to-work-handover`, create/update the PR, wait for checks, merge only after green, then verify the merged commit on `origin/main`. Never include unrelated user-owned files.

- [ ] **Step 6: Verify Vercel production**

Confirm deployment reaches Ready for the merged commit. Smoke-test `/api/health`, `/api/handover/compare`, and `/api/handover/period-compare`; then run the P001 return-handover browser path against production. Verify no server filesystem persistence, no browser-exposed `OPENAI_API_KEY`, exact 24-event result, transient event visibility, and exact evidence timestamps.

- [ ] **Step 7: Final user handoff**

Provide the production URL, merged commit, version, test counts, implemented user journey, deterministic/AI behavior, and only real remaining limitations. Call the user only after this demonstrable milestone or if a required human decision/blocker appears.

---

## Execution Order and Quality Gates

```text
Task 1 fixtures
  → Task 2 deterministic service
  → Task 3 API/AI boundary
  → Task 4 frontend data boundary
  → Task 5 transactional orchestration
  → Figma MCP checkpoint
  → Task 6 clinical UI + supervisor visual gate
  → Task 7 E2E/responsive/accessibility + supervisor gate
  → Task 8 release/deploy
```

Do not begin the next task until the current implementer report, independent review, supervisor verification, and supervisor commit are complete. A first-round issue returns to the same implementer. A serious issue persisting after the correction round is a user-visible blocker.

## Spec Coverage Checklist

- [ ] Five patients, eight snapshots each, 66+ hours, one explicit gap, final/current parity.
- [ ] Adjacent-pair reuse of existing comparator; no duplicate clinical rules.
- [ ] Stable events with `detectedAt`, exact source interval, four classifications.
- [ ] Current vs period-only lifecycle handles add/change/remove/reversion without resolved inference.
- [ ] `events` is the only source of values/evidence; review groups and summary reference IDs.
- [ ] `ready|no_baseline|no_events|partial` and all validation/fallback states covered.
- [ ] AI cannot alter facts and never blocks deterministic results.
- [ ] Existing pair API and shift UI preserved.
- [ ] Manual last-work selection, actual-baseline warning, successful-response-only reset.
- [ ] Current draft fingerprint invalidates period result; period result is not persisted.
- [ ] Exact historical evidence opens read-only; only latest current record is editable.
- [ ] Wide, desktop, tablet, and mobile layouts are readable with no clipped content.
- [ ] Keyboard, focus, landmarks, live states, and non-color status are tested.
- [ ] Harness, backend, frontend, E2E, lint, typecheck, build, version, docs, Git, and Vercel gates complete.
