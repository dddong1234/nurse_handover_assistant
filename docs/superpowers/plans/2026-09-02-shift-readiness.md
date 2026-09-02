# Shift Readiness Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 휴무 복귀 간호사가 환자 상태, 검사·결과, Line·Device, 오늘 적용되는 투약 변경과 명시된 전달 요청을 실제 인계 순서로 확인하고 모든 항목을 원본 기록까지 추적할 수 있는 Shift Readiness 근무 준비 보드를 구현한다.

**Architecture:** 기존 pair/period 비교와 편집 가능한 핵심 환자 기록은 그대로 유지한다. 새 timestamp 기반 sidecar fixture를 브라우저 adapter가 복귀 snapshot과 병합해 Shift Readiness 요청 전용 논리 record를 만들고, 별도 Python projector와 `/api/handover/shift-readiness`가 결정론적 준비 항목을 반환한다. 프런트엔드는 서버의 사실 상태와 `sessionStorage`의 사용자 읽음 상태를 분리하며 기존 변화 근거와 원본 기록으로 이동한다.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, unittest, Next.js 16, React 19, TypeScript 6, Vitest, Testing Library, Playwright, CSS, Vercel Functions

**Spec:** `docs/superpowers/specs/2026-09-02-shift-readiness-design.md`

## Global Constraints

- Harness `1.2.0`을 적용한다. 모든 구현자는 루트 `AGENTS.md`, 담당 경로의 하위 `AGENTS.md`, 승인 명세와 이 계획을 읽고 지정된 `HARNESS_ACK` 형식으로 시작한다.
- 구현 에이전트와 읽기 전용 리뷰어는 사용자 지시에 따라 `gpt-5.6-luna`, reasoning `max`를 사용한다. 감독 에이전트가 작업 계약, 통합, 테스트와 Git을 관리한다.
- 하위 에이전트는 Git 명령, `VERSION`, `CHANGELOG.md`, `README.md`, `docs/`, 공통 설정, 의존성, 지정 파일 밖 수정과 하위 에이전트 생성을 하지 않는다.
- 서브에이전트 작업 완료 형식은 `HARNESS_VERSION`, `SCOPE_COMPLETED`, `FILES_CHANGED`, `TESTS_RUN`, `TEST_RESULTS`, `KNOWN_LIMITATIONS`, `OUT_OF_SCOPE_CONFIRMED`를 포함한다.
- 모든 임상 사실과 fact status는 deterministic 로직이 만든다. LLM은 항목 생성·삭제·분류, 값, 시각, rule code와 근거를 바꾸지 못한다. 이번 버전은 Shift Readiness 전용 LLM 호출을 추가하지 않는다.
- `확인함`은 읽음 상태다. 처치, 투약, Line 교체, 보고 수행, 임상 안전 또는 업무 완료를 뜻하지 않는다.
- communication 항목은 구조화된 `handoffRequests`의 `open` 요청에서만 만든다. 활력징후, 검사값, 메모 문구에서 보고 필요성을 추론하지 않는다.
- 실제 환자정보를 사용하지 않는다. `.env`와 `OPENAI_API_KEY` 값을 출력·복사·문서화·커밋하지 않는다.
- 기존 `/api/handover/compare`, `/api/handover/period-compare`, 직전 교대, 휴무 복귀 변화 근거, 원본 편집·초안·근거 포커스 계약을 회귀시키지 않는다.
- 새 런타임 의존성을 추가하지 않는다. Vercel Function은 무상태이며 fixture와 검토 상태를 서버 파일시스템에 쓰지 않는다.
- `sessionStorage`에는 가상 record draft와 Shift Readiness 읽음 상태만 저장한다. API 응답 전체와 임상 원문을 review key에 넣지 않는다.
- 각 구현 작업은 RED 확인 → 최소 구현 → 집중 테스트 → 구현자 자체 검증 → 감독 리뷰 → 독립 읽기 전용 리뷰 → 필요 시 같은 구현자 수정 → 감독 재검증 순으로 완료한다.
- 같은 파일을 수정하는 작업은 순차 실행한다. 현재 작업의 검증과 감독 커밋 전에는 다음 큰 작업을 시작하지 않는다.
- 첫 수정 라운드 뒤에도 Critical/Important 문제가 남으면 한 번 더 같은 구현자에게 수정 지시한다. 그 뒤에도 중대한 문제가 남으면 사용자에게 보고하고 중단한다.
- 시각 구현 전 감독 에이전트가 승인된 Figma node `39:3`을 MCP로 다시 확인한다. Figma에서는 디자인 토큰과 임상 제품 컨텍스트만 참고하고, 화면 구성은 승인된 Task First 목업과 이 명세를 따른다.
- 임상 본문, 상태와 근거의 계산 글자 크기는 최소 `12px`이다. `390`, `960`, `1024`, `1279`, `1440`, `1600`, `2544` CSS-pixel 폭에서 가로 overflow와 rail 겹침이 없어야 한다.
- 하위 에이전트는 커밋하지 않는다. 각 작업의 커밋은 감독 에이전트가 검증 후 수행하고 `docs/AGENT_WORKLOG.md`에 근거를 기록한다.

## Storage Refinement

승인 명세의 `investigations`, `devices`, 확장 medication metadata와 `handoffRequests`는 API 요청 시점의 논리 snapshot에 존재한다. 저장소에서는 기존 편집·pair 비교 계약을 보존하기 위해 `data/shift-readiness/P001.json`부터 `P005.json`까지 timestamp별 sidecar로 보관하고 `buildShiftReadinessRecords()`가 기존 timeline snapshot에 병합한다.

이 refinement는 제품·API 의미를 바꾸지 않는다. 기존 `data/patients`, `data/history`, `data/timelines`의 핵심 record는 수정하지 않으며, 새 endpoint만 병합된 논리 record를 받는다. Python projector는 기간 비교를 호출하기 전에 새 필드를 제거한 core projection을 사용해 기존 24-event P001 계약을 보존한다.

## File Structure Map

| Layer | Files | Responsibility |
|---|---|---|
| Readiness sidecar data | `data/shift-readiness/P001.json` … `P005.json` | timestamp별 검사, Device, medication schedule, 명시된 전달 요청과 기본 근무 구간 |
| Fixture validation | `tests/test_shift_readiness_fixtures.py` | 환자·시각 정합성, rule coverage, 개인정보 패턴과 읽기 전용 data contract |
| Deterministic projector | `services/handover_shift_readiness_service.py` | core period reuse, 9개 rule code, source refs, stable items/groups/metrics/status |
| Stateless API | `api/index.py`, `tests/test_shift_readiness_api.py` | `/api/handover/shift-readiness` 요청 검증과 422/partial/no-items 계약 |
| Browser fixture adapter | `src/lib/demo-shift-readiness.ts` | sidecar 검증, core snapshot 병합, current draft overlay, 기본 shift 제공 |
| Runtime contract/client | `src/lib/shift-readiness-contracts.ts`, `shift-readiness-api.ts` | strict response parsing, reference integrity, 서버 호출과 오류 매핑 |
| Fetch/review state | `src/components/handover/useShiftReadiness.ts`, `src/lib/shift-readiness-review.ts` | request generation/cache와 session-only acknowledged IDs/manual note |
| New presentation | `ShiftReadinessWorkspace.tsx`, `ShiftReadinessSummaryPanel.tsx` | Task First 5-domain board, metrics, deterministic brief, unreviewed navigation |
| Existing-workbench integration | `HandoverWorkspace.tsx`, `WorkspaceModeTabs.tsx`, `PatientQueue.tsx`, `PatientRecordWorkspace.tsx` | return default tab, patient progress, evidence source navigation/focus |
| Styling/E2E | `src/app/globals.css`, `e2e/handover-workspace.spec.ts` | hierarchy, responsive geometry, keyboard/focus and full return-to-work journey |
| Release/docs | `VERSION`, `package.json`, `CHANGELOG.md`, `README.md`, `docs/domain/`, `docs/AGENT_WORKLOG.md` | `0.9.0`, terminology, workflow, validation and deployment evidence |

---

### Task 1: Create and validate the five-patient Shift Readiness sidecar pack

**Role:** core-logic agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 기존 환자 record를 변경하지 않고 다섯 환자의 8개 snapshot 시각에 정합한 구조화 검사·Device·medication schedule·전달 요청 상태를 제공한다.

**Files:**

- Create: `data/shift-readiness/P001.json`
- Create: `data/shift-readiness/P002.json`
- Create: `data/shift-readiness/P003.json`
- Create: `data/shift-readiness/P004.json`
- Create: `data/shift-readiness/P005.json`
- Create: `tests/test_shift_readiness_fixtures.py`
- Read only: `data/timelines/*.json`, `data/patients/*.json`, `tests/test_handover_timeline_fixtures.py`
- Do not modify: services, API, TypeScript/frontend, existing fixtures, docs/config/version, Git state

**Interfaces:**

- Consumes: `data/timelines/Pxxx.json`의 `patientId`, 8개 `snapshots[].updated_at`, 현재 medication 이름.
- Produces: timestamp별 full operational state를 가진 아래 `ShiftReadinessSidecar` JSON. Task 2와 Task 3은 같은 구조를 독립적으로 읽는다.

```json
{
  "patientId": "P001",
  "defaultShift": {
    "startsAt": "2026-07-02T07:00:00+09:00",
    "endsAt": "2026-07-02T15:00:00+09:00"
  },
  "states": {
    "2026-07-02T09:00:00+09:00": {
      "investigations": [],
      "devices": [],
      "medicationSchedules": [],
      "handoffRequests": []
    }
  }
}
```

- [ ] **Step 0: Add concrete fixture-test helpers**

At the top of `tests/test_shift_readiness_fixtures.py`, define the helpers used below exactly once:

```python
import json
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TIMELINE_DIR = ROOT / "data" / "timelines"
READINESS_DIR = ROOT / "data" / "shift-readiness"
PATIENT_IDS = tuple(f"P{index:03d}" for index in range(1, 6))

def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as source:
        return json.load(source)

def parse_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise AssertionError(f"offset-aware timestamp required: {value}")
    return parsed
```

Place every `test_*` method below inside `class ShiftReadinessFixtureTests(unittest.TestCase):`; verify the focused run reports a non-zero test count in RED and GREEN.

- [ ] **Step 1: Write exact sidecar contract tests**

```python
def test_every_sidecar_matches_all_eight_timeline_timestamps(self):
    for patient_id in PATIENT_IDS:
        timeline = load_json(TIMELINE_DIR / f"{patient_id}.json")
        sidecar = load_json(READINESS_DIR / f"{patient_id}.json")
        self.assertEqual(patient_id, sidecar["patientId"])
        self.assertEqual(
            {item["updated_at"] for item in timeline["snapshots"]},
            set(sidecar["states"]),
        )

def test_default_shift_contains_the_current_snapshot(self):
    for patient_id in PATIENT_IDS:
        timeline = load_json(TIMELINE_DIR / f"{patient_id}.json")
        sidecar = load_json(READINESS_DIR / f"{patient_id}.json")
        current = parse_iso(timeline["snapshots"][-1]["updated_at"])
        self.assertLessEqual(parse_iso(sidecar["defaultShift"]["startsAt"]), current)
        self.assertLess(current, parse_iso(sidecar["defaultShift"]["endsAt"]))
```

Add literal schema assertions for exact top-level/state keys, enum values, offset-aware timestamps, unique IDs within each array, medication schedule names that exist in the matching core snapshot, and no phone/email/real-identifier patterns.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `python -m unittest tests.test_shift_readiness_fixtures -v`

Expected: FAIL because `data/shift-readiness/P001.json` through `P005.json` are absent.

- [ ] **Step 3: Create P001's binding scenario**

At `2026-07-02T09:00:00+09:00`, P001 must contain these exact demonstration facts:

```json
{
  "investigations": [
    {
      "id": "INV-P001-CBC",
      "kind": "lab",
      "name": "CBC",
      "orderedAt": "2026-07-01T08:00:00+09:00",
      "scheduledAt": null,
      "status": "resulted",
      "resultedAt": "2026-07-02T08:20:00+09:00",
      "resultSummary": "WBC 12.1 ×10³/μL"
    },
    {
      "id": "INV-P001-CXR",
      "kind": "imaging",
      "name": "Chest AP",
      "orderedAt": "2026-07-02T07:30:00+09:00",
      "scheduledAt": "2026-07-02T11:00:00+09:00",
      "status": "scheduled",
      "resultedAt": null,
      "resultSummary": null
    }
  ],
  "devices": [
    {
      "id": "DEV-P001-PIV-1",
      "type": "말초정맥관",
      "site": "좌측 전완",
      "insertedAt": "2026-06-29T14:00:00+09:00",
      "changeDueAt": "2026-07-02T14:00:00+09:00",
      "status": "active",
      "removedAt": null
    }
  ],
  "medicationSchedules": [
    {
      "medicationName": "타세놀정 500mg",
      "effectiveFrom": "2026-07-02T09:00:00+09:00",
      "effectiveTo": null,
      "orderStatus": "active"
    }
  ],
  "handoffRequests": [
    {
      "id": "REQ-P001-ROUND-1",
      "topic": "회진 전 발열 경과 전달",
      "requestedAt": "2026-07-02T07:40:00+09:00",
      "dueBy": "2026-07-02T10:30:00+09:00",
      "sourceType": "physician_order",
      "status": "open"
    }
  ]
}
```

Earlier timestamp states must show when each item was absent, ordered, inserted, resulted, communicated or removed rather than copying the current state backward.

- [ ] **Step 4: Complete the fixture coverage matrix**

Use the following binding coverage. Additional items are allowed only when they exercise an approved enum without adding clinical interpretation.

| Patient | Required scenarios |
|---|---|
| P001 | new CBC result, scheduled imaging this shift, active PIV due this shift, medication effective this shift, explicit open request |
| P002 | investigation pending beyond this shift, current medication changed during absence, no implicit communication from oxygen/vitals |
| P003 | recent Device insert/remove state plus existing coverage gap; all safe items remain source-backed |
| P004 | cancelled investigation excluded, communicated request excluded, no false scheduled item at `shift.endsAt` |
| P005 | imaging result, removal-ordered Device without due-this-shift classification, cancelled handoff request excluded |

- [ ] **Step 5: Run focused and full backend baseline tests**

Run: `python -m unittest tests.test_shift_readiness_fixtures -v`

Run: `python -m unittest discover -s tests -v`

Expected: all existing 112 tests plus the new fixture tests PASS; the existing P001 24-event timeline expectation remains unchanged.

- [ ] **Step 6: Stop conditions and supervisor gate**

Stop and report if a sidecar timestamp does not map one-to-one to a core timeline snapshot, if a medication schedule names a medication absent from that snapshot, or if any scenario requires adding risk/normality/report inference. The supervisor runs an independent fixture review, reruns both commands, records the test count, and commits only the six owned files.

Supervisor-only commit message:

```text
feat: add shift readiness demo fixtures
```

---

### Task 2: Implement the deterministic Shift Readiness projector and API

**Role:** core-logic agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 병합된 논리 snapshot을 검증하고 승인된 9개 rule code만 사용해 source-backed 준비 항목, groups, metrics와 상태를 반환한다.

**Files:**

- Create: `services/handover_shift_readiness_service.py`
- Create: `tests/test_handover_shift_readiness_service.py`
- Modify: `api/index.py`
- Create: `tests/test_shift_readiness_api.py`
- Read only: `services/handover_period_service.py`, `services/handover_service.py`, Task 1 sidecars, existing API tests
- Do not modify: existing comparison services, OpenAI services, TypeScript/frontend, fixtures, docs/config/version, Git state

**Interfaces:**

- Consumes: logical records containing core fields plus `investigations`, `devices`, medication optional `effectiveFrom|effectiveTo|orderStatus`, and `handoffRequests`.
- Produces:

```python
def build_shift_readiness(
    records: list[dict[str, Any]],
    review_start_at: str,
    shift: dict[str, str],
    coverage_gaps: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    return {
        "patient": {},
        "reviewPeriod": {},
        "shift": {},
        "status": "available",
        "dataWarnings": [],
        "items": [],
        "groups": {},
        "metrics": {},
    }
```

- Endpoint: `POST /api/handover/shift-readiness`.

- [ ] **Step 0: Add concrete service/API test fixture builders**

In `tests/test_handover_shift_readiness_service.py`, load the checked-in P001 timeline and sidecar through explicit helpers and merge each timestamp without mutating either source:

```python
import copy
import json
import unittest
from pathlib import Path

from services.handover_shift_readiness_service import build_shift_readiness

ROOT = Path(__file__).resolve().parents[1]
REVIEW_START = "2026-06-28T09:00:00+09:00"
SHIFT = {
    "startsAt": "2026-07-02T07:00:00+09:00",
    "endsAt": "2026-07-02T15:00:00+09:00",
}

def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as source:
        return json.load(source)

def p001_records() -> list[dict]:
    timeline = load_json(ROOT / "data" / "timelines" / "P001.json")
    sidecar = load_json(ROOT / "data" / "shift-readiness" / "P001.json")
    records = []
    for snapshot in timeline["snapshots"]:
        merged = copy.deepcopy(snapshot)
        state = copy.deepcopy(sidecar["states"][snapshot["updated_at"]])
        schedules = {item["medicationName"]: item for item in state.pop("medicationSchedules")}
        for medication in merged["medications"]:
            schedule = schedules.get(medication["name"])
            if schedule:
                medication.update({key: value for key, value in schedule.items() if key != "medicationName"})
        merged.update(state)
        records.append(merged)
    return records

def build_p001_response() -> dict:
    return build_shift_readiness(p001_records(), REVIEW_START, SHIFT, [])

def records_with_no_handoff_requests() -> list[dict]:
    records = p001_records()
    for record in records:
        record["handoffRequests"] = []
    return records
```

Place the service test methods inside `class ShiftReadinessServiceTests(unittest.TestCase):`. Place API test methods inside `class ShiftReadinessApiTests(unittest.TestCase):` using the repository's existing FastAPI `TestClient` setup. Both focused RED runs must report collected tests; a `Ran 0 tests` result is a gate failure, not RED.

In `tests/test_shift_readiness_api.py`, import those test helpers and define the request factory:

```python
import copy

from tests.test_handover_shift_readiness_service import REVIEW_START, SHIFT, p001_records

def p001_request() -> dict:
    return {
        "reviewStartAt": REVIEW_START,
        "shift": copy.deepcopy(SHIFT),
        "records": p001_records(),
        "coverageGaps": [],
    }
```

- [ ] **Step 1: Write RED tests for time and safety rules**

```python
def test_p001_emits_all_five_domains_without_clinical_inference(self):
    response = build_p001_response()
    self.assertEqual(
        {"patient_status", "investigation", "line_device", "medication", "communication"},
        {item["domain"] for item in response["items"]},
    )
    self.assertIn("COMMUNICATION_EXPLICIT_OPEN", {item["ruleCode"] for item in response["items"]})

def test_vitals_results_and_notes_cannot_create_communication(self):
    records = records_with_no_handoff_requests()
    response = build_shift_readiness(records, REVIEW_START, SHIFT, [])
    self.assertEqual([], response["groups"]["communications"])
```

Add literal boundary tests proving `[startsAt, endsAt)`, `currentRecordedAt < endsAt`, empty records/current rejection, future record rejection, scheduled-vs-pending precedence, cancelled/communicated exclusion and Device due/current-state rules. Add a recoverable orphan direct/period source case proving the item is excluded, a stable warning is emitted and status is `partial`; an item with no valid source can never survive in `items`.

- [ ] **Step 2: Write RED tests for stable IDs, grouping and source integrity**

```python
def test_every_item_has_known_sources_and_exactly_one_group(self):
    response = build_p001_response()
    item_ids = {item["id"] for item in response["items"]}
    grouped_ids = [item_id for ids in response["groups"].values() for item_id in ids]
    self.assertEqual(item_ids, set(grouped_ids))
    self.assertEqual(len(grouped_ids), len(set(grouped_ids)))
    for item in response["items"]:
        self.assertGreaterEqual(len(item["sourceRefs"]), 1)
        self.assertTrue(all(ref["recordedAt"] for ref in item["sourceRefs"]))
        self.assertTrue(all(ref["path"] for ref in item["sourceRefs"]))
```

Assert identical inputs produce byte-equivalent IDs/order, same-field period events collapse into one patient-status item while retaining all event IDs, each structured source ID produces at most one item, and `items` alone owns display facts.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `python -m unittest tests.test_handover_shift_readiness_service -v`

Expected: FAIL because `services.handover_shift_readiness_service` is absent.

- [ ] **Step 4: Implement validation and core period projection**

Implement a private `_core_record()` that keeps identity, diagnosis, vitals, medication `name|route|frequency`, notes and `updated_at` only. Call the existing period service with these projections:

```python
core_records = [_core_record(record) for record in ordered_records]
period = build_handover_period_comparison(
    core_records,
    review_start_at,
    coverage_gaps or [],
)
```

Validate one patient, unique offset-aware timestamps, exact supported operational enums, source IDs, `startsAt < endsAt`, and current snapshot inside `[startsAt, endsAt)`. Do not change `handover_service.py` or the existing period output.

- [ ] **Step 5: Implement the nine binding rule functions**

Use one focused function per rule family and export only `build_shift_readiness`. Binding rule codes are:

```python
RULE_CODES = {
    "STATUS_PERIOD_CHANGE",
    "INVESTIGATION_NEW_RESULT",
    "INVESTIGATION_SCHEDULED_SHIFT",
    "INVESTIGATION_PENDING",
    "DEVICE_DUE_SHIFT",
    "DEVICE_RECENT_CHANGE",
    "MEDICATION_EFFECTIVE_SHIFT",
    "MEDICATION_RECENT_CHANGE",
    "COMMUNICATION_EXPLICIT_OPEN",
}
```

For one structured source object, select exactly one representative item with this precedence: `scheduled_this_shift` → `new_result` → `pending_result` → `recent_change`. Merge all matching source refs into that item. `communication` remains separate because it has its own explicit request source.

Direct source paths use the canonical grammar `investigations[id=<rfc3986(id)>]`, `devices[id=<rfc3986(id)>]`, `medications[name=<rfc3986(name)>]`, or `handoffRequests[id=<rfc3986(id)>]`, with no property suffix and exactly one selector. Python uses `urllib.parse.quote(value, safe="-._~")`. TypeScript applies `encodeURIComponent`, then percent-encodes each of `!'()*` with its uppercase two-digit UTF-8 byte hex. Both sides require uppercase percent hex and decode→re-encode equality before matching, so those five characters cannot drift across runtimes. Examples are `investigations[id=INV-P001-CBC]`, `devices[id=DEV-P001-PIV-1]`, `medications[name=%ED%83%80%EC%84%B8%EB%86%80%EC%A0%95%20500mg]`, and `handoffRequests[id=REQ-P001-ROUND-1]`.

For a period-derived source ref, set `periodEventId` to the exact `PeriodEvent.id`, `recordedAt` to `event.interval.currentRecordedAt`, and `path` to `event.change.evidence.fieldPath`. The service verifies the referenced event exists in the internally produced period response and all three fields match it. Direct refs omit `periodEventId`. Integration resolves a period ref only through the existing period event/evidence handler; it resolves a direct ref by exact `recordedAt` logical snapshot plus the canonical selector. No array-index guessing or partial string match is allowed.

`DEVICE_RECENT_CHANGE` uses `insertedAt` or `removedAt` when those timestamps enter `(reviewStartAt, currentRecordedAt]`. A status transition is detected only by comparing the same Device ID across adjacent logical snapshots; its deterministic relevant time is the later snapshot's `updated_at`, and both adjacent recorded times are retained as source refs. No separate `statusChangedAt` field and no inferred transition are introduced.

- [ ] **Step 6: Implement status, groups and metrics**

Return the exact group keys `patientStatus`, `investigations`, `lineDevices`, `medications`, `communications` as item-ID arrays in that fixed workflow order. Sort within each domain by `relevantAt` ascending, source ID, item ID; null time comes last. Status precedence is `no_baseline`, then `partial`, then `no_items`, then `available`.

Define the fixed mapping and metric helper directly:

```python
DOMAIN_GROUPS = {
    "patient_status": "patientStatus",
    "investigation": "investigations",
    "line_device": "lineDevices",
    "medication": "medications",
    "communication": "communications",
}

def count_status(items: list[dict[str, Any]], status: str) -> int:
    return sum(item["factStatus"] == status for item in items)
```

The “source ID” sort key is the decoded selector value for direct items and the lexicographically first matched `periodEventId` for patient-status items; if neither exists, validation fails rather than inventing a key.

```python
metrics = {
    "itemCount": len(items),
    "newResultCount": count_status(items, "new_result"),
    "scheduledThisShiftCount": count_status(items, "scheduled_this_shift"),
    "pendingResultCount": count_status(items, "pending_result"),
    "domainCounts": {domain: len(groups[group_name]) for domain, group_name in DOMAIN_GROUPS.items()},
}
```

If a recoverable source field is incomplete, exclude only that item, append a stable warning code and mark `partial`. Never convert a service exception to `no_items`.

- [ ] **Step 7: Write and run API RED tests**

```python
def test_shift_readiness_endpoint_returns_p001_contract(self):
    response = client.post("/api/handover/shift-readiness", json=p001_request())
    self.assertEqual(200, response.status_code)
    body = response.json()
    self.assertEqual("P001", body["patient"]["id"])
    self.assertEqual(body["metrics"]["itemCount"], len(body["items"]))

def test_bad_shift_and_future_record_return_422(self):
    request = p001_request()
    request["shift"] = {"startsAt": request["shift"]["endsAt"], "endsAt": request["shift"]["startsAt"]}
    self.assertEqual(422, client.post("/api/handover/shift-readiness", json=request).status_code)
```

Add `available`, `no_baseline`, `no_items`, `partial`, empty `records`, patient mismatch, invalid enum, duplicate timestamp, fixture immutability and existing pair/period route regression tests. Monkeypatch `build_shift_readiness` to raise an unexpected `RuntimeError` and assert HTTP 500 with body `{"detail":"Shift Readiness 처리 중 오류가 발생했습니다"}`; assert it is never translated to HTTP 200 `no_items`.

- [ ] **Step 8: Implement the Pydantic request and route**

```python
class ShiftWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    startsAt: str
    endsAt: str

class ShiftReadinessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewStartAt: str
    shift: ShiftWindow
    records: list[dict[str, Any]]
    coverageGaps: list[CoverageGap] = Field(default_factory=list)
```

Catch `KeyError`, `TypeError`, and `ValueError` from input/domain validation and raise HTTP 422. In this route only, catch any remaining `Exception` and raise `HTTPException(status_code=500, detail="Shift Readiness 처리 중 오류가 발생했습니다") from None`; never expose the exception text. This makes the ordinary existing `TestClient(app)` return a sanitized response because the route converts the exception itself. Do not access `OPENAI_API_KEY` on this route.

- [ ] **Step 9: Run focused and full backend gates**

Run: `python -m unittest tests.test_handover_shift_readiness_service tests.test_shift_readiness_api -v`

Run: `python -m unittest discover -s tests -v`

Run: `python scripts/check_harness.py --root .`

Expected: all PASS, existing P001 period remains exactly 24 events, pair and period API response contracts are unchanged.

- [ ] **Step 10: Supervisor review and commit**

The independent reviewer checks all 9 rule codes, communication non-inference, source selector validity, stable ordering, error/no-items distinction and statelessness. The supervisor reruns focused/full tests and commits only the four owned files.

Stop and report before integration if any rule needs an unapproved clinical inference/schema field, a source cannot be made canonical, or existing pair/period output changes.

Supervisor-only commit message:

```text
feat: add deterministic shift readiness API
```

---

### Task 3: Add the browser sidecar adapter, strict contract and API client

**Role:** frontend agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** sidecar와 core timeline을 결정적으로 병합하고 `/shift-readiness` 응답의 모든 type/reference 관계를 브라우저 경계에서 검증한다.

**Files:**

- Create: `src/lib/demo-shift-readiness.ts`
- Create: `src/lib/demo-shift-readiness.test.ts`
- Create: `src/lib/shift-readiness-contracts.ts`
- Create: `src/lib/shift-readiness-contracts.test.ts`
- Create: `src/lib/shift-readiness-api.ts`
- Create: `src/lib/shift-readiness-api.test.ts`
- Create: `src/test/shift-readiness-fixtures.ts`
- Read only: `src/lib/demo-timelines.ts`, `src/lib/demo-records.ts`, `src/lib/handover-period-api.ts`, Task 1 sidecars
- Do not modify: components/CSS, Python, fixtures, docs/config/version, Git state

**Interfaces:**

```ts
export type ShiftWindow = { startsAt: string; endsAt: string };
export type Investigation = {
  id: string;
  kind: "lab" | "imaging";
  name: string;
  orderedAt: string;
  scheduledAt: string | null;
  status: "ordered" | "scheduled" | "in_progress" | "resulted" | "cancelled";
  resultedAt: string | null;
  resultSummary: string | null;
};
export type Device = {
  id: string;
  type: string;
  site: string;
  insertedAt: string;
  changeDueAt: string | null;
  status: "active" | "removal_ordered" | "removed";
  removedAt: string | null;
};
export type MedicationSchedule = {
  effectiveFrom: string | null;
  effectiveTo: string | null;
  orderStatus: "planned" | "active" | "stopped";
};
export type HandoffRequest = {
  id: string;
  topic: string;
  requestedAt: string;
  dueBy: string | null;
  sourceType: "physician_order" | "nursing_note";
  status: "open" | "communicated" | "cancelled";
};
export type ShiftReadinessRecord = DemoPatientRecord & {
  investigations: Investigation[];
  devices: Device[];
  medications: Array<DemoMedication & MedicationSchedule>;
  handoffRequests: HandoffRequest[];
};

export type ShiftReadinessRequest = {
  reviewStartAt: string;
  shift: ShiftWindow;
  records: ShiftReadinessRecord[];
  coverageGaps: HandoverPeriodCoverageGap[];
};

export type RequestShiftReadinessOptions = {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type ShiftReadinessSourceRef = {
  recordedAt: string;
  path: string;
  label: string;
  periodEventId?: string;
};
export type ShiftReadinessRuleCode =
  | "STATUS_PERIOD_CHANGE"
  | "INVESTIGATION_NEW_RESULT"
  | "INVESTIGATION_SCHEDULED_SHIFT"
  | "INVESTIGATION_PENDING"
  | "DEVICE_DUE_SHIFT"
  | "DEVICE_RECENT_CHANGE"
  | "MEDICATION_EFFECTIVE_SHIFT"
  | "MEDICATION_RECENT_CHANGE"
  | "COMMUNICATION_EXPLICIT_OPEN";
export type ShiftReadinessItem = {
  id: string;
  patientId: string;
  domain: "patient_status" | "investigation" | "line_device" | "medication" | "communication";
  factStatus: "new_result" | "scheduled_this_shift" | "pending_result" | "recent_change" | "explicit_follow_up";
  title: string;
  detail: string;
  relevantAt: string | null;
  sourceRefs: ShiftReadinessSourceRef[];
  ruleCode: ShiftReadinessRuleCode;
};
export type ShiftReadinessGroups = {
  patientStatus: string[];
  investigations: string[];
  lineDevices: string[];
  medications: string[];
  communications: string[];
};
export type ShiftReadinessResponse = {
  patient: HandoverPeriodApiResponse["patient"];
  reviewPeriod: { requestedStartAt: string; baselineRecordedAt: string | null; currentRecordedAt: string };
  shift: ShiftWindow;
  status: "available" | "no_baseline" | "no_items" | "partial";
  dataWarnings: string[];
  items: ShiftReadinessItem[];
  groups: ShiftReadinessGroups;
  metrics: {
    itemCount: number;
    newResultCount: number;
    scheduledThisShiftCount: number;
    pendingResultCount: number;
    domainCounts: Record<ShiftReadinessItem["domain"], number>;
  };
};

export function getDemoShiftWindow(patientId: string): ShiftWindow;
export function buildShiftReadinessRecords(
  patientId: string,
  coreRecords: readonly DemoPatientRecord[],
): ShiftReadinessRecord[];

export function requestShiftReadinessComparison(
  request: ShiftReadinessRequest,
  options?: RequestShiftReadinessOptions,
): Promise<ShiftReadinessResponse>;
```

- [ ] **Step 0: Add concrete TypeScript test factories**

Create `createValidShiftReadinessResponse()` in the test-only `src/test/shift-readiness-fixtures.ts` module as a literal seven-item P001 response that exercises all five groups, all metrics and at least one direct source ref plus one `periodEventId`. In `shift-readiness-api.test.ts`, define:

```ts
const request: ShiftReadinessRequest = {
  reviewStartAt: "2026-06-28T09:00:00+09:00",
  shift: {
    startsAt: "2026-07-02T07:00:00+09:00",
    endsAt: "2026-07-02T15:00:00+09:00",
  },
  records: buildShiftReadinessRecords("P001", getDemoTimeline("P001").snapshots),
  coverageGaps: [],
};
const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
  new Response(JSON.stringify(createValidShiftReadinessResponse()), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }),
);
```

Reuse this factory from component/hook tests. Production modules must not import the test fixture.

- [ ] **Step 1: Write adapter RED tests**

```ts
it("merges P001 current operational state without mutating the core timeline", () => {
  const timeline = getDemoTimeline("P001");
  const before = structuredClone(timeline.snapshots);
  const records = buildShiftReadinessRecords("P001", timeline.snapshots);

  expect(records.at(-1)?.investigations.map((item) => item.id)).toEqual([
    "INV-P001-CBC",
    "INV-P001-CXR",
  ]);
  expect(records.at(-1)?.medications.find((item) => item.name === "타세놀정 500mg")?.effectiveFrom)
    .toBe("2026-07-02T09:00:00+09:00");
  expect(timeline.snapshots).toEqual(before);
});
```

Add tests for exact 8-slot parity, fresh clones, unknown patient rejection, mismatched medication schedule rejection, current draft core-field overlay with sidecar metadata preserved, edited final `updated_at`, edited medication name, non-final timestamp mutation, and no classification inference in this adapter.

- [ ] **Step 2: Run adapter tests and confirm RED**

Run: `pnpm exec vitest run src/lib/demo-shift-readiness.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict sidecar parsing and merge**

Use exact-key validators for sidecar state. First validate `coreRecords` against the eight canonical timeline slots: historical slots must retain their exact timestamp/order, while the final slot may contain the session-edited current record and a changed `updated_at`. Merge the final sidecar state by canonical slot lineage, then expose direct sources at the logical final record's current `updated_at`. Match medication schedule only by exact medication name after draft overlay. If a draft renames/removes a scheduled medication, reject readiness construction with a typed `STALE_OPERATIONAL_METADATA` error; do not attach metadata by index or old name. A non-final timestamp/count/order mismatch is also a typed contract error. HandoverWorkspace surfaces the readiness error but leaves `변화 근거` and `원본 기록` usable. Return `structuredClone` results. The adapter may merge data but must not create fact status, rule code, summary copy or readiness item.

- [ ] **Step 4: Write runtime contract RED tests**

```ts
it("accepts a complete response and rejects a dangling source or group ID", () => {
  const response = createValidShiftReadinessResponse();
  expect(parseShiftReadinessResponse(response)).toEqual(response);

  const danglingGroup = structuredClone(response);
  danglingGroup.groups.investigations = ["missing-item"];
  expect(() => parseShiftReadinessResponse(danglingGroup)).toThrow();

  const missingSource = structuredClone(response);
  missingSource.items[0]!.sourceRefs = [];
  expect(() => parseShiftReadinessResponse(missingSource)).toThrow();
});
```

Reject unknown top-level/item keys, enum values, duplicate item IDs, item in zero or two groups, wrong-domain group, non-offset timestamps, malformed canonical direct selector/percent encoding, an empty or malformed periodEventId, a ref that mixes a direct selector with periodEventId, mismatched metrics/counts and a patient mismatch. The standalone parser validates shape; Task 6 cross-validates period IDs and field paths against the selected period response before navigation.

- [ ] **Step 5: Implement exact TypeScript types and parser**

Export the five domains, five fact statuses, nine rule codes, four response statuses, `ShiftReadinessItem`, `ShiftReadinessResponse`, request types and `parseShiftReadinessResponse`. A `SourceRef` has the exact keys `recordedAt`, `path`, `label`, and optional `periodEventId`; direct selectors follow Task 2's canonical grammar, while a period ref has a nonblank period event ID and nonblank fieldPath-shaped path. The standalone parser cannot claim that a period event exists; Task 6 performs that cross-response validation. Reuse the existing patient shape and coverage-gap type where possible; do not loosen `unknown` payloads with type assertions before validation.

- [ ] **Step 6: Write API client RED tests**

```ts
it("posts only the approved request fields and validates the patient", async () => {
  await requestShiftReadinessComparison(request, { fetchImpl });
  expect(fetchImpl).toHaveBeenCalledWith("/api/handover/shift-readiness", expect.objectContaining({
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }));
  expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual(request);
});
```

Test aborted-before-call, abort during fetch/JSON, network, HTTP, malformed JSON, invalid response, response patient mismatch, unserializable request and absence of API credentials.

- [ ] **Step 7: Implement `requestShiftReadinessComparison`**

Follow `handover-period-api.ts` error conventions and accept an injectable `fetchImpl` only for tests. Send exactly `reviewStartAt`, `shift`, `records`, `coverageGaps`; never send `summaryMode` or any provider credential.

- [ ] **Step 8: Run focused and frontend-wide checks**

Run: `pnpm exec vitest run src/lib/demo-shift-readiness.test.ts src/lib/shift-readiness-contracts.test.ts src/lib/shift-readiness-api.test.ts`

Run: `pnpm test`

Run: `pnpm exec eslint src/lib/demo-shift-readiness.ts src/lib/shift-readiness-contracts.ts src/lib/shift-readiness-api.ts`

Run: `pnpm exec tsc --noEmit`

Expected: all PASS; existing timeline/record-draft tests remain unchanged.

- [ ] **Step 9: Supervisor review and commit**

The independent reviewer checks exact-key validation, item/group/source integrity, no core fixture mutation, no credential path and stable current-draft merge. The supervisor reruns all four commands and commits only the seven owned files.

Stop and report if Python/TypeScript field names or enums cannot be made exact, if a draft would require stale metadata attachment, or if strict validation would weaken an existing boundary.

Supervisor-only commit message:

```text
feat: add shift readiness frontend boundary
```

---

### Task 4: Implement transactional fetch and session-only review state

**Role:** frontend agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 최신 key의 성공 응답만 노출하고 사용자 acknowledged IDs와 수기 메모를 임상 사실과 분리해 `sessionStorage`에 저장한다.

**Files:**

- Create: `src/components/handover/useShiftReadiness.ts`
- Create: `src/components/handover/useShiftReadiness.test.tsx`
- Create: `src/lib/shift-readiness-review.ts`
- Create: `src/lib/shift-readiness-review.test.ts`
- Read only: Task 3 contracts/client and `src/test/shift-readiness-fixtures.ts`, `src/components/handover/useReturnHandover.ts`, `src/lib/record-drafts.ts`
- Do not modify: existing components/CSS, Python, fixtures, docs/config/version, Git state

**Interfaces:**

```ts
export type ShiftReadinessKey = `sr:${string}`;

export type ShiftReadinessState = {
  status: "idle" | "loading" | "success" | "error";
  response: ShiftReadinessResponse | null;
  error: HandoverApiError | null;
};

export type ShiftReadinessHookInput = ShiftReadinessRequest & {
  patientId: string;
  currentRecordFingerprint: string;
  enabled: boolean;
};

export type ShiftReadinessRosterEntry = ShiftReadinessState & {
  key: ShiftReadinessKey;
};

export function createShiftReadinessKey(
  patientId: string,
  reviewStartAt: string,
  shift: ShiftWindow,
  currentRecordFingerprint: string,
): ShiftReadinessKey;

export function useShiftReadiness(
  input: ShiftReadinessHookInput,
): ShiftReadinessState & { key: ShiftReadinessKey; retry(): void };

export function useShiftReadinessRoster(
  inputs: readonly ShiftReadinessHookInput[],
  enabled: boolean,
): {
  entriesByPatient: ReadonlyMap<string, ShiftReadinessRosterEntry>;
  retry(patientId: string): void;
};
```

`createShiftReadinessKey` builds one canonical object with the exact keys `patientId`, `reviewStartAt`, `shiftStartsAt`, `shiftEndsAt`, and normalized `currentRecordFingerprint`, then passes that object to the existing `createCurrentRecordFingerprint()`. Return only `sr:<8 lowercase hex>`; the key must not contain patient ID, timestamps, draft text, clinical values or delimiters derived from raw inputs. Tests prove object-key-order stability, all five identity dimensions changing the digest, and absence of each raw input substring.

```ts
export const SHIFT_READINESS_REVIEW_STORAGE_KEY = "nurse-handover:shift-readiness-review:v1";
export type ShiftReadinessReview = {
  acknowledgedItemIds: string[];
  manualHandoverNote: string;
};
```

- [ ] **Step 0: Add concrete hook-test inputs and deferred helper**

In `useShiftReadiness.test.tsx`, define a typed `deferred<T>()`, create P001/P002 requests from the Task 3 adapter, and derive `p001Input`/`p002Input` by adding `patientId`, an exact `currentRecordFingerprint`, and `enabled: true`. Create `p001Response`/`p002Response` from the shared valid response factory with patient identity changed consistently. Reset module cache and mocks in `beforeEach` with `vi.resetModules()`; no production test-only export and no test-order dependency are allowed.

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
```

- [ ] **Step 1: Write hook RED tests for transactional requests**

```tsx
it("ignores an older response after patient/start/shift/fingerprint changes", async () => {
  const first = deferred<ShiftReadinessResponse>();
  const second = deferred<ShiftReadinessResponse>();
  requestMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

  const { result, rerender } = renderHook((props) => useShiftReadiness(props), { initialProps: p001Input });
  rerender(p002Input);
  second.resolve(p002Response);
  await waitFor(() => expect(result.current.response?.patient.id).toBe("P002"));
  first.resolve(p001Response);
  expect(result.current.response?.patient.id).toBe("P002");
});
```

Test exact hashed key composition/privacy, bounded successful-response cache, same-key reuse, abort, retry, failure preserving the same key's prior success and disabled state returning idle without deleting cache. Add roster tests proving all five unique patients are requested once, the active patient's changed fingerprint invalidates only that entry, patient errors remain isolated, late old responses cannot overwrite an entry, and duplicate keys share one in-flight promise. On a different uncached key, expose `response: null` during loading/error; retain other-key cached responses internally but never render them under the new key. On a same-key refresh failure, keep that key's previous response and surface the error alongside it.

- [ ] **Step 2: Implement the hook using the existing generation pattern**

Use one maximum 24-entry module cache plus an in-flight map shared by the single and roster hooks. Cache only parsed successful responses. The roster starts at most the five bundled patient requests when return mode is enabled; it aborts removed keys and uses a generation per patient. On a new uncached key set `loading` with `response: null`; preserve only a prior response for that exact key. Never show a different patient's response under the new key.

- [ ] **Step 3: Write review-state RED tests**

```ts
function createMemoryStorage(seed: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

it("reconciles stored IDs against the current response and never stores response facts", () => {
  const reviewKey = createShiftReadinessKey(
    "P001",
    "2026-06-28T09:00:00+09:00",
    { startsAt: "2026-07-02T07:00:00+09:00", endsAt: "2026-07-02T15:00:00+09:00" },
    createCurrentRecordFingerprint({ patientId: "P001", version: 1 }),
  );
  const storage = createMemoryStorage({
    [SHIFT_READINESS_REVIEW_STORAGE_KEY]: JSON.stringify({
      [reviewKey]: { acknowledgedItemIds: ["valid", "removed"], manualHandoverNote: "확인 메모" },
    }),
  });
  expect(loadShiftReadinessReview(storage, reviewKey, new Set(["valid"]))).toEqual({
    acknowledgedItemIds: ["valid"],
    manualHandoverNote: "확인 메모",
  });
  expect(storage.getItem(SHIFT_READINESS_REVIEW_STORAGE_KEY)).not.toContain("resultSummary");
});
```

Test corrupt JSON fallback, wrong shapes, duplicate ID normalization, independent keys, toggle behavior, note persistence, clear-by-key, and exact storage key.

- [ ] **Step 4: Implement pure storage functions**

Export `emptyShiftReadinessReview()`, `loadShiftReadinessReview()`, `persistShiftReadinessReview()`, `toggleAcknowledgedItem()` and `removeShiftReadinessReview()`. Accept `Pick<Storage, "getItem" | "setItem" | "removeItem">` boundaries for tests. Persist only acknowledged IDs and manual note; response data and source refs never enter storage.

- [ ] **Step 5: Run focused and frontend-wide checks**

Run: `pnpm exec vitest run src/components/handover/useShiftReadiness.test.tsx src/lib/shift-readiness-review.test.ts`

Run: `pnpm test`

Run: `pnpm exec eslint src/components/handover/useShiftReadiness.ts src/lib/shift-readiness-review.ts`

Run: `pnpm exec tsc --noEmit`

Expected: all PASS.

- [ ] **Step 6: Supervisor review and commit**

The independent reviewer checks response/key isolation, storage minimization, stale request behavior, cache bound and no response persistence. The supervisor reruns all four commands and commits only the four owned files.

Stop and report if raw identity/clinical text appears in a review key, if an API response must be persisted, or if one patient's generation can affect another roster entry.

Supervisor-only commit message:

```text
feat: add shift readiness session state
```

---

### Task 5: Build the Task First board and readiness summary rail

**Precondition:** The supervisor reviews Figma node `39:3` through MCP and records exact token/context findings. If the Figma connection is unavailable, pause this task without writing visual code.

**Role:** frontend agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 승인된 A안에 따라 다섯 업무 도메인, 항목별 읽음·근거 조작, deterministic 복귀 요약과 미확인 바로가기를 독립 presentational components로 구현한다.

**Files:**

- Create: `src/components/handover/ShiftReadinessWorkspace.tsx`
- Create: `src/components/handover/ShiftReadinessWorkspace.test.tsx`
- Create: `src/components/handover/ShiftReadinessSummaryPanel.tsx`
- Create: `src/components/handover/ShiftReadinessSummaryPanel.test.tsx`
- Read only: Task 3 contracts and `src/test/shift-readiness-fixtures.ts`, approved spec, existing Return components for semantic patterns
- Do not modify: `HandoverWorkspace.tsx`, existing components, CSS, Python, fixtures, docs/config/version, Git state

**Interfaces:**

```ts
export type ShiftReadinessWorkspaceProps = {
  response: ShiftReadinessResponse | null;
  status: "idle" | "loading" | "success" | "error";
  acknowledgedItemIds: readonly string[];
  errorMessage?: string | null;
  onToggleAcknowledged(itemId: string): void;
  onOpenEvidence(itemId: string, sourceIndex: number, trigger: HTMLElement): void;
  onRetry(): void;
};
```

```ts
export type ShiftReadinessSummaryPanelProps = {
  response: ShiftReadinessResponse | null;
  acknowledgedItemIds: readonly string[];
  manualHandoverNote: string;
  status: "idle" | "loading" | "success" | "error";
  errorMessage?: string | null;
  onManualHandoverNoteChange(value: string): void;
  onNavigateToItem(itemId: string): void;
  onRetry(): void;
};
```

- [ ] **Step 0: Add concrete presentation test builders**

In the two component tests, reuse the Task 3 test-only seven-item P001 response. Define `props(response, onToggle = vi.fn(), onOpen = vi.fn())` with `status: "success"`, empty acknowledged IDs, `onRetry: vi.fn()` and the supplied callbacks. Define `summaryProps(response, acknowledgedItemIds)` with `manualHandoverNote: ""`, `status: "success"`, and explicit mock callbacks. The shared factory uses stable titles including `CBC`, so the accessible-name assertions below are deterministic.

- [ ] **Step 1: Write board RED tests for hierarchy and semantics**

```tsx
it("renders the five domains in the nurse-recalled handover order", () => {
  render(<ShiftReadinessWorkspace {...props(createValidShiftReadinessResponse())} />);
  expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual([
    expect.stringContaining("환자 상태"),
    expect.stringContaining("검사·결과"),
    expect.stringContaining("Line·Device"),
    expect.stringContaining("투약 변경"),
    expect.stringContaining("보고·확인"),
  ]);
});
```

Assert time → title/detail → Korean fact-status label → `확인함` checkbox → `근거 보기` order, empty domain copy, available/no-baseline/no-items/partial, loading/error/retry distinction, and error-with-prior-response retaining the board plus an alert. Assert no `완료`, `안전`, `악화`, `보고 필요` automatic copy and no inline JSON leakage.

- [ ] **Step 2: Write interaction and accessibility RED tests**

```tsx
it("keeps evidence opening and acknowledgement independent", async () => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  const onOpen = vi.fn();
  render(<ShiftReadinessWorkspace {...props(createValidShiftReadinessResponse(), onToggle, onOpen)} />);
  await user.click(screen.getByRole("button", { name: /CBC.*근거 보기/ }));
  expect(onOpen).toHaveBeenCalledWith(expect.any(String), 0, expect.any(HTMLElement));
  expect(onToggle).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox", { name: /CBC.*확인함/ }));
  expect(onToggle).toHaveBeenCalledTimes(1);
});
```

Test heading/region relationships, status text not color-only, source count, retry, `aria-busy`, keyboard-operable checkboxes/buttons and item focus by stable DOM ID. Each title element must expose `data-testid="shift-readiness-item-title"` for the binding typography E2E without using clinical copy as a CSS locator.

- [ ] **Step 3: Implement `ShiftReadinessWorkspace`**

Use constant domain definitions and fact-status labels:

```ts
const FACT_STATUS_LABELS: Record<ShiftReadinessFactStatus, string> = {
  new_result: "새 결과 있음",
  scheduled_this_shift: "이번 근무 예정",
  pending_result: "결과 대기",
  recent_change: "최근 변경",
  explicit_follow_up: "명시된 전달 요청",
};
```

Resolve group item IDs through one `Map` built from `response.items`; never copy clinical facts into a UI-only model. Unknown IDs cannot occur after parser validation and should render a visible contract error in tests rather than being silently skipped.

- [ ] **Step 4: Write summary-rail RED tests**

```tsx
it("shows review progress without claiming task completion", () => {
  const response = createValidShiftReadinessResponse();
  render(<ShiftReadinessSummaryPanel {...summaryProps(response, ["item-1", "item-2"])} />);
  expect(screen.getByText("2/7")).toBeVisible();
  expect(screen.getByText(/미확인 5/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "검토 완료" })).not.toBeInTheDocument();
});
```

Assert new-result/scheduled/pending counts, fixed deterministic brief, unacknowledged item buttons, manual note callback, loading/error preserving prior response and the current manual note, retry behavior, and no source-confirmation/global-completion controls.

- [ ] **Step 5: Implement `ShiftReadinessSummaryPanel`**

The deterministic brief reports counts and source-backed item titles only. It does not interpret result values or create a Recommendation. The manual field label is `인계 메모` and helper copy says the note is session-only. Unacknowledged quick links call `onNavigateToItem(item.id)`.

- [ ] **Step 6: Run focused checks**

Run: `pnpm exec vitest run src/components/handover/ShiftReadinessWorkspace.test.tsx src/components/handover/ShiftReadinessSummaryPanel.test.tsx`

Run: `pnpm exec eslint src/components/handover/ShiftReadinessWorkspace.tsx src/components/handover/ShiftReadinessSummaryPanel.tsx`

Run: `pnpm exec tsc --noEmit`

Expected: all PASS without modifying global CSS or existing components.

- [ ] **Step 7: Supervisor semantic review and commit**

The supervisor personally checks Korean copy, domain order, no clinical inference, evidence/ack independence and the absence of global completion. The independent reviewer checks spec compliance and component accessibility. Commit only after focused checks and review pass.

Stop and report if the Figma checkpoint is unavailable, if required copy implies completion/safety/priority, or if the presentation needs facts not present in `response.items`.

Supervisor-only commit message:

```text
feat: add shift readiness clinical panels
```

---

### Task 6: Integrate readiness into the existing clinical workbench and original-record evidence

**Role:** frontend agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 휴무 복귀의 기본 탭을 근무 준비로 전환하고 환자별 세션 진행도, 요청 성공 경계와 새 operational source의 정확한 원본 보기를 기존 워크벤치에 연결한다.

**Files:**

- Modify: `src/components/handover/HandoverWorkspace.tsx`
- Modify: `src/components/handover/HandoverWorkspace.test.tsx`
- Modify: `src/components/handover/WorkspaceModeTabs.tsx`
- Modify: `src/components/handover/WorkspaceModeTabs.test.tsx`
- Modify: `src/components/handover/PatientQueue.tsx`
- Modify: `src/components/handover/PatientRecordWorkspace.tsx`
- Modify: `src/components/handover/PatientRecordWorkspace.test.tsx`
- Read only: Tasks 3–5 modules, existing Return components
- Do not modify: CSS/E2E, Python, fixtures, lib contracts, docs/config/version, Git state

**Integration contract:**

```ts
export type WorkspaceMode = "comparison" | "readiness" | "record";
export type WorkspaceScope = "shift" | "return";

export type WorkspaceModeTabsProps = {
  scope: WorkspaceScope;
  mode: WorkspaceMode;
  recordAvailable: boolean;
  readinessPanelId: string;
  comparisonPanelId: string;
  recordPanelId: string;
  onModeChange(mode: WorkspaceMode): void;
};
```

`MODES_BY_SCOPE` is exactly `{ shift: ["comparison", "record"], return: ["readiness", "comparison", "record"] }`. Tab IDs are `readiness-tab`, `comparison-tab`, and `record-tab`; each controls its matching supplied panel ID. Labels are scope-derived exactly as listed below. Refs use `Partial<Record<WorkspaceMode, HTMLButtonElement | null>>`. ArrowLeft/Right/Home/End cycles only through the current scope's enabled modes, skips a disabled record tab, and never selects readiness in shift scope.

- Shift scope exposes `comparison | record` with existing labels.
- Return scope exposes `readiness | comparison | record` with `근무 준비 | 변화 근거 | 원본 기록` and defaults to `readiness`.
- Existing ReturnComparisonWorkspace/ReturnSummaryPanel remain the comparison-tab experience.
- Entering return scope creates hook inputs for all five bundled patients and enables `useShiftReadinessRoster`; this is the sole readiness data source for both the selected board and every queue-row denominator.
- Queue progress derives each successful response's `items.length`, response status and that response key's reconciled session review. Unloaded/loading rows show `확인 —`; failed rows show `확인 오류`; `available` shows `확인 n/total`; `partial` shows `일부 자료 · 확인 n/total` when total > 0 or `일부 자료 · 확인 항목 없음`; `no_baseline` shows `기준 없음 · 확인 n/total` when total > 0 or `기준 없음 · 확인 항목 없음`; `no_items` shows `표시 항목 없음`. No zero-item state renders `0/0`, `완료`, or a clinical urgency/completion color. The same exact phrases are included in the row button's accessible name.

- [ ] **Step 1: Write workspace-mode RED tests**

```tsx
it("defaults return scope to readiness while preserving shift comparison", async () => {
  render(<HandoverWorkspace data={data} recordPairs={pairs} />);
  expect(screen.getByRole("tab", { name: "인수인계 비교" })).toHaveAttribute("aria-selected", "true");
  await user.click(screen.getByRole("radio", { name: "휴무 복귀" }));
  expect(screen.getByRole("tab", { name: "근무 준비" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "변화 근거" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "원본 기록" })).toBeVisible();
});
```

Test ArrowLeft/Right/Home/End across the dynamic tab list, shift↔return state restoration, readiness unavailable error state, and no third tab in shift scope.

- [ ] **Step 2: Write transactional orchestration RED tests**

Mock period and readiness endpoints independently. Assert:

```tsx
await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
  "/api/handover/shift-readiness",
  expect.objectContaining({ method: "POST" }),
));
expect(requestBody(readinessCall).shift).toEqual({
  startsAt: "2026-07-02T07:00:00+09:00",
  endsAt: "2026-07-02T15:00:00+09:00",
});
```

Cover all five roster calls, patient/start/fingerprint changes, stale response rejection, failure not masquerading as no-items, same-key acknowledged state restoration, new successful key resetting review state, period success with readiness failure still allowing `변화 근거`, and no readiness response stored in sessionStorage. Verify a P003 readiness failure does not disturb P001's board or the other queue entries.

- [ ] **Step 3: Implement adapter/hook/review wiring in `HandoverWorkspace`**

Build five readiness inputs from each bundled timeline and current session draft; the selected patient's edited current draft overlays its core fields while operational sidecar fields remain source data. Enable roster requests only for return scope. Apply review hydration only after a validated successful response for the exact hashed key.

Keep fetch orchestration in `useShiftReadinessRoster`; `HandoverWorkspace` owns only per-patient visible snapshots, selected mode, review state and evidence routing. Do not duplicate parser or rule logic in the component.

- [ ] **Step 4: Write patient-queue progress RED tests and implement optional progress**

```tsx
expect(screen.getByRole("button", { name: /홍길동.*확인 2\/7/ })).toBeVisible();
expect(screen.queryByText(/준비 완료/)).not.toBeInTheDocument();
```

Add an optional `reviewProgressByPatient` prop whose row union is `{ status: "loading" | "error" | "no_items" } | { status: "available" | "partial" | "no_baseline"; acknowledged: number; total: number }`. Missing totals cannot be rendered as zero. Existing shift rows without this prop remain byte-for-byte equivalent in visible labels. In return readiness mode, suppress the old comparison-only `변화 있음`, important-count and priority color treatment; restore them unchanged in `직전 교대` and `변화 근거` contexts. Add tests for loading, error, available, partial, no-baseline and no-items across P001–P005 and prove that `확인 total/total` still does not render `완료`.

- [ ] **Step 5: Write operational original-record RED tests**

```tsx
it("opens the exact investigation source read-only and restores focus on close", async () => {
  const trigger = screen.getByRole("button", { name: /CBC.*근거 보기/ });
  await user.click(trigger);
  expect(screen.getByRole("tab", { name: "원본 기록" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("heading", { name: "검사·결과" })).toBeVisible();
  expect(screen.getByText("WBC 12.1 ×10³/μL")).toHaveAttribute("data-evidence-active", "true");
  expect(screen.queryByRole("button", { name: "비교 반영" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "원본 기록 닫기" }));
  expect(trigger).toHaveFocus();
});
```

Cover investigation, Device, medication schedule and handoff request paths. For `periodEventId`, assert the ID exists in the selected period response, `sourceRef.path === event.change.evidence.fieldPath`, and `sourceRef.recordedAt === event.interval.currentRecordedAt` before invoking the existing exact previous/current snapshot handler. Add negative tests for missing event ID, mismatched path/time, malformed percent encoding, missing direct source ID and wrong recordedAt; keep the board visible, show `근거를 찾을 수 없습니다`, leave focus on the trigger, and never open a nearby/guessed record.

- [ ] **Step 6: Extend `PatientRecordWorkspace` read-only supplemental sections**

Add optional props:

```ts
readinessRecord?: ShiftReadinessRecord | null;
focusedSourcePath?: string | null;
focusRequestId?: number;
```

Render `검사·결과`, `Line·Device`, `투약 적용 정보`, `전달 요청 원본` only when `readinessRecord` is present. Do not expose these arrays in editable inputs. A readiness evidence pair is always read-only. Percent-decode the already validated selector only for matching; display values remain from the record object.

- [ ] **Step 7: Connect board and summary navigation**

`onNavigateToItem` focuses the stable board item ID without checking it. `onOpenEvidence` first runs the canonical direct/period cross-validation above, then stores the originating element, opens `record`, selects the exact snapshot/path and increments focusRequestId. Close restores the previous return tab and origin focus.

- [ ] **Step 8: Run focused and frontend-wide gates**

Run: `pnpm exec vitest run src/components/handover/WorkspaceModeTabs.test.tsx src/components/handover/PatientRecordWorkspace.test.tsx src/components/handover/HandoverWorkspace.test.tsx`

Run: `pnpm test`

Run: `pnpm exec eslint src/components/handover/HandoverWorkspace.tsx src/components/handover/WorkspaceModeTabs.tsx src/components/handover/PatientQueue.tsx src/components/handover/PatientRecordWorkspace.tsx`

Run: `pnpm exec tsc --noEmit`

Run: `pnpm build`

Expected: all PASS; existing pair/period edit and evidence tests remain green.

- [ ] **Step 9: Supervisor browserless integration review and commit**

The independent reviewer checks mode boundaries, review-key resets, patient leakage, source focus, read-only enforcement and the 850-line workspace for accidental duplicate logic. Any new cohesive helper extracted from `HandoverWorkspace` must stay within the owned files or be approved by the supervisor before modification.

Stop and report if any source cannot resolve exactly, if queue progress requires a completion/urgency inference, or if integration would mutate the existing core record schema.

Supervisor-only commit message:

```text
feat: integrate shift readiness workbench
```

---

### Task 7: Apply visual hierarchy and prove the complete browser workflow

**Role:** frontend agent (`gpt-5.6-luna`, reasoning `max`)

**Goal:** 승인된 Task First 화면을 기존 임상 디자인 토큰으로 완성하고 모든 지원 폭에서 가독성·focus·API 상태·원본 근거 여정을 E2E로 증명한다.

**Files:**

- Modify: `src/app/globals.css`
- Modify: `e2e/handover-workspace.spec.ts`
- Modify only when a failing test proves a behavioral defect: Task 5–6 component files and their tests
- Do not modify: backend, lib contracts/adapter/API, fixtures, docs/config/version, Git state

- [ ] **Step 0: Lock existing return-mode E2E behavior to the new default tab**

Before adding new scenarios, inventory every existing test that clicks `휴무 복귀` and immediately asserts period summary/events/geometry. Add the readiness route mock to its setup, then explicitly click `변화 근거` before assertions that belong to `ReturnComparisonWorkspace` or `ReturnSummaryPanel`. Keep its existing period values, 24-event expectations, evidence flow and viewport checks unchanged. Tests that cover return entry must instead assert `근무 준비` is selected first. Do not weaken or delete old assertions to make the new default pass.

- [ ] **Step 1: Add the full P001 Task First E2E before CSS fixes**

The test must execute this exact sequence:

```ts
await page.getByRole("radio", { name: "휴무 복귀" }).click();
await expect(page.getByRole("tab", { name: "근무 준비" })).toHaveAttribute("aria-selected", "true");
await expect(page.getByRole("heading", { name: /환자 상태/ })).toBeVisible();
await expect(page.getByRole("heading", { name: /검사·결과/ })).toBeVisible();
await expect(page.getByRole("heading", { name: /Line·Device/ })).toBeVisible();
await expect(page.getByRole("heading", { name: /투약 변경/ })).toBeVisible();
await expect(page.getByRole("heading", { name: /보고·확인/ })).toBeVisible();
```

Then confirm CBC new result, Chest AP scheduled, PIV due, Tylenol effective and explicit request; check one item, verify progress; open direct evidence and restore focus; open `변화 근거` and retain P001 24 events; return to readiness and retain acknowledged state.

- [ ] **Step 2: Add API and state E2E cases**

Route-mock readiness `no_baseline`, `no_items`, `partial`, HTTP failure after success, slow P001 then fast P002, malformed response and missing direct source. Assert exact distinct copy, retry, no stale patient paint, period-tab availability and no failure counted as complete.

- [ ] **Step 3: Add keyboard/accessibility E2E**

Test dynamic tab Arrow/Home/End behavior, checkbox/button keyboard operation, visible focus, item quick navigation, evidence focus restoration, non-color status text, heading/region relationships and one live status announcement for loading/error.

- [ ] **Step 4: Add typography and viewport RED assertions**

At `390`, `960`, `1024`, `1279`, `1440`, `1600`, and `2544` widths assert:

```ts
const clinicalText = page.getByTestId("shift-readiness-item-title").first();
const evidenceButton = page.getByRole("button", { name: /근거 보기/ }).first();
await expect(clinicalText).toBeVisible();
await expect(evidenceButton).toBeVisible();
expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
expect(await clinicalText.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
expect(await evidenceButton.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
```

Also assert each rail's `scrollWidth <= clientWidth`, the center does not paint beneath the right rail at 960–1019, 390px item actions stack without clipping, and 1600+ retains 304px/400px side rails.

- [ ] **Step 5: Apply focused CSS using existing tokens**

Add one contained Shift Readiness section to the existing theme layer. Reuse current color, spacing, border, focus and typography variables. Use domain section headers, status badges plus border/icon, 12–14px clinical text and content-driven row heights. Do not add another `:root`, raw duplicate theme, broad `overflow-x:hidden` masking or fixed-height blank panels.

- [ ] **Step 6: Run focused E2E and fix only demonstrated defects**

Run: `pnpm exec playwright test e2e/handover-workspace.spec.ts --grep "shift readiness"`

Expected: PASS after focused changes. If a component behavior fails, add/adjust its Vitest regression before changing component code.

- [ ] **Step 7: Run the complete frontend gate**

Run: `pnpm test`

Run: `pnpm test:e2e`

Run: `pnpm lint`

Run: `pnpm exec tsc --noEmit`

Run: `pnpm build`

Expected: all PASS. If port 3000 is occupied, use a fresh verified local build on a known alternate port through `PLAYWRIGHT_BASE_URL` and record the exact port; never test against an unidentified stale server.

Use this exact PowerShell fallback after a successful `pnpm build`:

```powershell
if (Get-NetTCPConnection -LocalPort 3107 -State Listen -ErrorAction SilentlyContinue) { throw "Port 3107 is already occupied" }
$server = Start-Process pnpm.cmd -ArgumentList @("start", "--hostname", "127.0.0.1", "--port", "3107") -PassThru -WindowStyle Hidden
try {
  $health = $null
  for ($attempt = 0; $attempt -lt 120 -and -not $server.HasExited -and $health.status -ne "ok"; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    $health = Invoke-RestMethod "http://127.0.0.1:3107/api/health" -ErrorAction SilentlyContinue
  }
  if ($server.HasExited -or $health.status -ne "ok") { throw "Current checkout server did not become healthy within 30 seconds" }
  $env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3107"
  pnpm exec playwright test e2e/handover-workspace.spec.ts
} finally {
  Remove-Item Env:PLAYWRIGHT_BASE_URL -ErrorAction SilentlyContinue
  Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
}
```

The successful `pnpm build` immediately precedes this start, port 3107 must be unbound first, and the test uses only the newly captured process after its health response. This proves freshness without changing the existing health API. The `finally` block stops only the captured PID.

- [ ] **Step 8: Supervisor first visual gate**

The supervisor personally inspects P001 at 2544×1258 and 1440×900 first, then 1024, 960 and 390. Verify the five-domain scan order, readable evidence, no oversized center whitespace, hierarchy, right-rail progress, error/no-items distinction and exact source view. Failures return to the same frontend implementer before further work.

After the implementer commands and before visual inspection, the supervisor runs `git diff --check` and verifies Task 7 touched only its owned files.

- [ ] **Step 9: Independent review and correction gate**

The read-only Luna Max reviewer reports Critical/Important/Minor findings against the approved spec and required viewport range. Critical/Important findings return to the same implementer. The supervisor reruns focused and full gates after each fix round.

If a fix requires backend/lib/schema changes, stop this CSS/E2E task and return the issue to the owning earlier task; do not broaden Task 7 ownership.

- [ ] **Step 10: Supervisor-only commit**

```text
test: verify shift readiness clinical workflow
```

---

### Task 8: Document, release, merge, deploy and validate 0.9.0

**Role:** supervisor only

**Goal:** 검증된 Shift Readiness 기능을 문서·버전·Notion 결정 기록과 일치시키고 GitHub/Vercel Production에서 재현한다.

**Files:**

- Modify: `VERSION`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/domain/workflows.md`
- Modify: `docs/domain/glossary.md`
- Modify: `docs/AGENT_WORKLOG.md`
- Modify only if deployment behavior changes: `docs/conventions/deployment.md`
- External update: existing anonymized Notion feedback/decision page

- [ ] **Step 1: Run the complete clean-worktree quality gate**

```powershell
python scripts/check_harness.py --root .
python -m unittest discover -s tests -v
pnpm test
pnpm test:e2e
pnpm lint
pnpm exec tsc --noEmit
pnpm build
git diff --check
git status --short
```

Use the explicit installed Python path if `python` is unavailable and record it. Record exact test counts. Confirm `git status --short` contains only Task 1–8 owned files before staging; any unrelated path is a stop condition. Do not claim an OpenAI provider test because the new feature does not call it.

- [ ] **Step 2: Run final contract and privacy probes**

Call `/api/handover/shift-readiness` with P001 and assert `metrics.itemCount == len(items)`, every item has source refs, every item belongs to exactly one group and P001 covers five domains. Search tracked changes for phone/email patterns, `OPENAI_API_KEY`, `.env` content, raw JSON leakage and forbidden automatic-decision copy.

- [ ] **Step 3: Run an independent final read-only review**

Review fixture integrity, all 9 rules, communication non-inference, API error/no-items distinction, TypeScript parser parity, review storage minimization, stale request isolation, exact evidence/focus, existing pair/period regression, responsive geometry, accessibility and Vercel statelessness. Fix every Critical/Important issue and repeat affected focused tests plus the full gate.

- [ ] **Step 4: Update release version and docs**

Set `VERSION` and `package.json` to `0.9.0`. Add a changelog entry covering:

- Task First five-domain Shift Readiness board.
- Deterministic separate API and 100% source traceability.
- New synthetic tests/results/Line/medication timing/explicit-request data.
- Session-only read state and original-record evidence.
- API-key-independent summary and unchanged pair/period comparison.
- Known limits: fictional data, no real EMR, no execution/clinical decision/persistence.

Update workflow/glossary to define `사실 상태`, `확인함`, `이번 근무 예정`, `명시된 전달 요청` and the non-clinical meaning of review progress. README demo path is `P001 → 휴무 복귀 → 근무 준비 → CBC/Line/투약/전달 요청 → 근거 보기`.

- [ ] **Step 5: Finalize worklog and Notion decision record**

Record every task's HARNESS_ACK, owned files, RED/GREEN commands, supervisor/independent review, fix rounds, Figma checkpoint, test counts and limitations. Mark the 0.9.0 milestone `PASSED` only after the complete gate. Update the existing anonymized Notion feedback page with `수용한 피드백`, `제품 전환`, `구현 범위`, `검증 결과`; do not add the interview participant's name.

- [ ] **Step 6: Create the supervisor release commit and push**

```text
docs: release shift readiness 0.9.0
```

Push `codex/0.9.0-shift-readiness-design`, create or update the PR, wait for all checks, and merge only after green. Verify `origin/main` resolves to the merged commit. Never include the user's dirty main checkout or unrelated untracked files.

- [ ] **Step 7: Verify Vercel Preview before Production**

Confirm Preview Ready for the exact branch commit. Smoke-test `/`, `/api/health`, `/api/handover/compare`, `/api/handover/period-compare`, and `/api/handover/shift-readiness`. Run the P001 browser path and the viewport matrix on Preview. Confirm no browser API key and no server filesystem persistence.

- [ ] **Step 8: Promote and verify Production**

After Preview and merged-main checks pass, promote the merged deployment. Verify `https://nurse-handover-assistant.vercel.app`, health, all three handover endpoints, P001 five-domain board, 24-event evidence tab, direct/period source navigation, session reset behavior and public viewport overflow.

- [ ] **Step 9: Final user handoff**

Provide the production URL, merged commit, version, exact test counts, implemented nurse workflow, evidence guarantee, deterministic/LLM boundary and only genuine remaining limitations. Call the user only at this demonstrable milestone or when a required human decision/blocker appears.

---

## Execution Order and Quality Gates

```text
Task 1 sidecar fixtures
  → Task 2 deterministic projector/API
  → Task 3 browser adapter/contracts/client
  → Task 4 transactional fetch/review state
  → Figma MCP checkpoint
  → Task 5 Task First presentation
  → Task 6 workbench/evidence integration
  → Task 7 visual/E2E + supervisor screen gate
  → Task 8 release/GitHub/Vercel/Notion
```

Task 4와 Task 5는 Task 3 이후 파일 소유권상 병렬 가능하지만, 사용자의 큰 단계별 감독 지시를 우선해 Task 4의 상태 경계를 검증한 후 Task 5를 시작한다. 각 Task는 구현자 보고, 독립 리뷰, 감독 검증과 감독 커밋이 끝나야 다음 Task로 이동한다.

## Spec Coverage Checklist

- [ ] 1차 사용자는 휴무 복귀 담당 간호사이며 직전 교대 기능은 유지된다.
- [ ] 다섯 업무 도메인이 실제 인계 순서로 표시된다.
- [ ] sidecar는 논리 snapshot에서 승인된 investigation/device/medication/handoff 구조로 병합된다.
- [ ] 모든 9개 rule code는 deterministic이며 전체 fixture 집합에서 검증된다.
- [ ] 활력징후·검사값·메모만으로 communication 항목을 만들지 않는다.
- [ ] API는 `available|no_baseline|no_items|partial`과 HTTP 422/실패를 구분한다.
- [ ] 모든 item은 최소 한 source ref를 가지며 exactly one group에 속한다.
- [ ] 같은 원본/필드의 중복 준비 항목은 병합하고 중간 사건은 변화 근거에 보존한다.
- [ ] Shift Readiness 전용 LLM 호출 없이 deterministic brief가 동작한다.
- [ ] fact status와 acknowledged state는 서버·브라우저 계약에서 분리된다.
- [ ] review key는 patient/start/shift/fingerprint를 포함하고 임상 원문을 노출하지 않는다.
- [ ] sessionStorage는 acknowledged IDs/manual note만 저장하고 stale IDs를 제거한다.
- [ ] 근거 열람과 확인 체크는 서로 자동 연동되지 않는다.
- [ ] operational source와 period event가 정확한 원본 snapshot/path로 이동한다.
- [ ] operational source 원본은 읽기 전용이며 기존 최신 core record 편집은 유지된다.
- [ ] return scope의 기본 탭은 근무 준비이고 변화 근거·원본 기록을 보존한다.
- [ ] 환자 큐와 우측 레일은 진행도만 표시하며 완료·안전 의미를 만들지 않는다.
- [ ] `no_items`, partial, no-baseline, 로딩과 실패 화면이 구분된다.
- [ ] 임상 본문·근거는 12px 이상이며 390–2544px에서 overflow/rail 겹침이 없다.
- [ ] 키보드 탭, checkbox, 근거 focus/restore, live status, non-color state가 검증된다.
- [ ] pair/period API, 기존 비교/편집/초안/근거 계약의 전체 회귀 테스트가 통과한다.
- [ ] Harness, Python, Vitest, Playwright, ESLint, typecheck, build, diff, privacy, Preview와 Production 게이트가 완료된다.
- [ ] `0.9.0` 버전·changelog·workflow·glossary·worklog·Notion이 실제 검증 결과와 일치한다.
