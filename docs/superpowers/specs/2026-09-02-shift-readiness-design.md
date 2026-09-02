# 복귀 간호사 Shift Readiness 설계

- 상태: 사용자 서면 승인 완료
- 목표 버전: `0.9.0`
- 기준 제품: Nurse Handover Assistant `0.8.1`
- 적용 하네스: `1.2.0`
- 데이터 범위: 가상 일반 성인병동 기록
- 1차 사용자: 1일 이상 휴무 후 근무에 복귀하는 담당 간호사

## 1. 배경과 사용자 근거

현재 제품은 직전 교대 또는 휴무 기간의 기록 변화를 검출하고 원본 근거와 함께 보여준다. 이 기능은 “무엇이 바뀌었는가”에는 답하지만, 복귀한 간호사가 근무 시작 전에 “이번 근무에서 무엇을 확인해야 하는가”를 다시 조립해야 한다.

현직 간호사 1인의 비공식 인터뷰에서 회상된 인계 순서는 다음과 같았다.

1. 환자 상태
2. 검사·영상의 예정과 결과
3. Line·Device 교체 예정
4. 오늘부터 적용되는 투약 변경
5. 의사에게 전달하거나 확인할 내용

인터뷰에서는 현재 변화 요약과 차팅 자동완성의 설명만으로는 특별한 효용이 즉시 드러나지 않는다는 피드백도 있었다. 이 의견은 단일 인터뷰의 정성 가설이며 일반화된 임상 근거가 아니다. 이번 설계는 가설을 제품 흐름으로 구체화하고 향후 사용성 검증이 가능하게 만드는 데 목적이 있다.

## 2. 문제 정의

휴무 복귀 간호사는 놓친 기간의 전체 사건을 읽는 것뿐 아니라 현재 상태, 새 검사 결과, 이번 근무의 예정 사항과 명시된 전달 요청을 빠르게 구분해야 한다. 현재 타임라인 중심 화면에서는 이 항목들이 날짜와 변화 유형으로 흩어져 있어 사용자가 실행 가능한 근무 준비 목록으로 재구성해야 한다.

제품의 중심 질문을 다음과 같이 전환한다.

```text
기존: 휴무 중 무엇이 바뀌었는가?
목표: 그 변화에 근거해 이번 근무 전에 무엇을 확인해야 하는가?
```

기존 기간 비교는 폐기하지 않는다. 검증된 변화·근거 엔진을 하부 사실 계층으로 유지하고, 그 위에 `Shift Readiness` 읽기 전용 투영 계층을 추가한다.

## 3. 목표

1. 복귀 간호사가 환자별 근무 확인사항을 실제 인계 순서로 검토한다.
2. 검사·결과, Line·Device, 투약 적용 시점과 명시적 전달 요청을 가상 구조화 데이터로 시연한다.
3. 모든 준비 항목을 정확한 원본 기록과 결정 규칙으로 추적한다.
4. 임상적 위험도, 정상·비정상 또는 보고 필요성을 자동 판단하지 않는다.
5. 기존 직전 교대 비교, 휴무 기간 변화와 원본 기록 기능을 보존한다.
6. OpenAI API 키가 없어도 전체 근무 준비 흐름을 재현한다.
7. Vercel의 무상태 제약 안에서 브라우저 세션만으로 시연한다.

## 4. 비목표

- 실제 EMR, LIS, PACS, 처방, 근무표 또는 실제 환자정보 연동
- 활력징후나 검사값의 정상·비정상, 악화, 긴급도 또는 의사 보고 필요성 판단
- 처치 수행, 투약 수행, Line 교체 또는 보고 완료 상태의 기록
- 사용자 인증, 다중 사용자 공유, 기기 간 검토 상태 동기화
- 서버 또는 Vercel 파일시스템에 검토 상태 영속 저장
- 기관별 프로토콜, 알림, 에스컬레이션 또는 간호 의사결정 자동화
- 새 Shift Readiness 사실을 LLM이 생성하거나 선택하는 기능
- 차팅 코파일럿의 기능 확장

## 5. 검토한 접근

### 5.1 선택: 별도 Shift Readiness 투영 계층

기존 기간 사건과 새 구조화 데이터를 결정론적으로 읽어 `환자 상태 → 검사·결과 → Line·Device → 투약 변경 → 보고·확인` 순서의 준비 항목으로 투영한다. 기간 사건과 원본 기록은 단일 사실 원본으로 유지한다.

장점은 기존 비교 정확성과 회귀 테스트를 보존하면서 제품의 실무 메시지를 바꿀 수 있다는 점이다. 새 데이터와 계약이 필요하지만 가장 작은 범위에서 인터뷰 가설을 검증할 수 있다.

### 5.2 기각: 기존 변화 그룹의 이름만 변경

현재 진단·투약·활력징후·메모를 다섯 영역처럼 다시 배치하는 방식이다. 구현은 빠르지만 검사, 영상, Line과 명시적 전달 요청이 없어 실무 흐름을 이름으로만 흉내 내게 된다.

### 5.3 기각: 완전한 업무관리 시스템

담당자, 마감시간, 수행·보고 결과와 공유 상태를 저장하는 방식이다. 실제 운영 가치가 커질 수 있지만 인증, 감사로그, 영속 저장과 EMR 연동이 필요하다. 현재 포트폴리오 MVP와 Vercel 무상태 경계를 벗어난다.

## 6. 제품 의미와 안전 언어

`Shift Readiness`는 임상적 안전 판정이 아니라 사용자가 읽어야 할 항목의 검토 진행 상태다.

- 허용: `7개 중 5개 확인`, `미확인 2개`, `결과 대기 1개`
- 금지: `환자 안전`, `준비 완료`, `업무 완료`, `보고가 필요함`, `위험`, `악화`

화면의 `확인함`은 해당 항목을 읽었다는 뜻이다. 처치·투약·교체·보고가 수행됐다는 뜻이 아니다. 서버의 사실 상태와 브라우저의 사용자 확인 상태는 별도 계약으로 유지한다.

## 7. 전체 아키텍처

```text
가상 환자 snapshot + 검사/Device/전달 요청 기록
                       │
                       ├─ 기존 pair/period deterministic 비교
                       │          └─ PeriodEvent + 원본 근거
                       │
                       └─ Shift Readiness deterministic projector
                                  ├─ 환자 상태
                                  ├─ 검사·결과
                                  ├─ Line·Device
                                  ├─ 투약 변경
                                  └─ 보고·확인
                                             │
                                             ├─ /api/handover/shift-readiness
                                             └─ Next.js 근무 준비 보드
                                                        ├─ 세션 확인 상태
                                                        ├─ 변화 근거
                                                        └─ 원본 기록 이동
```

새 `/api/handover/shift-readiness`는 기존 `/api/handover/compare`와 `/api/handover/period-compare`를 변경하지 않는다. 내부에서 기존 기간 비교 결과를 재사용할 수 있지만 외부 응답 계약은 분리한다. 새 도메인 오류가 기존 비교 화면에 전파되지 않게 하고 각 계약을 독립 검증하기 위해서다.

## 8. 가상 데이터 설계

### 8.1 공통 원칙

- 모든 데이터는 가상 환자 ID만 사용한다.
- 이름, 연락처, 주민등록번호, 실제 병원 식별자와 자유서술의 실명은 포함하지 않는다.
- 시각은 `+09:00` offset을 포함한 ISO 8601 문자열을 사용한다.
- fixture는 읽기 전용이며 API 호출과 브라우저 검토가 파일을 수정하지 않는다.
- 기존 다섯 환자의 8개 snapshot과 66시간 이상 복귀 기간을 유지한다.
- 마지막 snapshot은 현재 환자 fixture와 의미상 일치해야 한다.

### 8.2 추가 구조화 필드

기존 snapshot의 활력징후, 진단, 투약, 메모에 다음 배열을 추가한다.

논리 snapshot은 아래 필드를 포함하지만 저장소의 기존 `data/patients`, `data/history`, `data/timelines` record를 직접 팽창시키지는 않는다. 편집·pair 비교 계약을 보존하기 위해 timestamp별 operational state를 `data/shift-readiness/P001.json`부터 `P005.json`까지 sidecar로 저장하고, 브라우저 adapter가 `/api/handover/shift-readiness` 요청 직전에 core snapshot과 병합한다. 새 endpoint가 받는 논리 record와 아래 판별 규칙은 동일하며 기존 pair·period endpoint에는 sidecar 필드를 보내지 않는다.

```text
investigations[]
├─ id
├─ kind: lab | imaging
├─ name
├─ orderedAt
├─ scheduledAt?
├─ status: ordered | scheduled | in_progress | resulted | cancelled
├─ resultedAt?
└─ resultSummary?

devices[]
├─ id
├─ type
├─ site
├─ insertedAt
├─ changeDueAt?
├─ status: active | removal_ordered | removed
└─ removedAt?

medications[] 기존 필드 확장
├─ effectiveFrom?
├─ effectiveTo?
└─ orderStatus: planned | active | stopped

handoffRequests[]
├─ id
├─ topic
├─ requestedAt
├─ dueBy?
├─ sourceType: physician_order | nursing_note
└─ status: open | communicated | cancelled
```

`resultSummary`는 원본 결과의 축약된 가상 텍스트다. 시스템이 정상·비정상 또는 해석을 추가하지 않는다. `handoffRequests`는 원본에 명시된 전달 요청만 표현한다. 시스템은 다른 활력징후나 검사 결과를 보고 새 요청을 생성하지 않는다.

각 환자는 다섯 영역이 모두 보이는 동일한 사례를 가질 필요가 없다. 전체 fixture 집합은 모든 판별 규칙을 포함하되 환자별 항목 수와 조합을 달리해 화면이 고정 데모 문구에 의존하지 않게 한다.

## 9. Shift Readiness 계약

### 9.1 준비 항목

```text
ShiftReadinessItem
├─ id
├─ patientId
├─ domain: patient_status | investigation | line_device | medication | communication
├─ factStatus: new_result | scheduled_this_shift | pending_result | recent_change | explicit_follow_up
├─ title
├─ detail
├─ relevantAt?
├─ sourceRefs[]
│  ├─ recordedAt
│  ├─ path
│  ├─ label
│  └─ periodEventId?
└─ ruleCode
```

- `id`는 환자 ID, 도메인 원본 ID, fact status와 관련 시각으로 결정적으로 생성한다.
- `sourceRefs`는 최소 1개여야 하며 실제 snapshot 시각과 JSON path를 가리킨다.
- 기존 변화에서 파생된 항목은 관련 `PeriodEvent.id`도 포함한다.
- `title`과 `detail`은 구조화된 사실로 만드는 deterministic 표현이다.
- `ruleCode`는 어떤 규칙이 항목을 생성했는지 공개한다.
- 임상 우선순위 필드는 두지 않는다.

### 9.2 판별 규칙

| Rule code | 조건 | 결과 상태 |
|---|---|---|
| `STATUS_PERIOD_CHANGE` | 기간 사건의 진단·활력징후·메모 변화가 현재 상태 설명에 포함됨 | `recent_change` |
| `INVESTIGATION_NEW_RESULT` | `resultedAt`이 복귀 기준 이후 현재 기록 시각 이하 | `new_result` |
| `INVESTIGATION_SCHEDULED_SHIFT` | `scheduledAt`이 현재 근무 구간 안이며 결과 없음 | `scheduled_this_shift` |
| `INVESTIGATION_PENDING` | 현재 상태가 `ordered`, `scheduled`, `in_progress`이고 이번 근무 예정으로 분류되지 않음 | `pending_result` |
| `DEVICE_DUE_SHIFT` | 활성 Device의 `changeDueAt`이 현재 근무 구간 안 | `scheduled_this_shift` |
| `DEVICE_RECENT_CHANGE` | 삽입·제거·상태 변경 기록이 복귀 기준 이후 현재 기록 시각 이하 | `recent_change` |
| `MEDICATION_EFFECTIVE_SHIFT` | `effectiveFrom`이 현재 근무 구간 안 | `scheduled_this_shift` |
| `MEDICATION_RECENT_CHANGE` | 현재 유지되는 투약의 추가·용량·경로·빈도 변경이 복귀 기간에 존재하고 이번 근무 적용 항목이 아님 | `recent_change` |
| `COMMUNICATION_EXPLICIT_OPEN` | 현재 `open`인 명시적 요청이며 `dueBy`가 없거나 현재 근무 종료 이하 | `explicit_follow_up` |

시간 구간은 시작 포함·종료 미포함 `[startsAt, endsAt)`으로 계산한다. `currentRecordedAt` 이후 발생했다고 기록된 결과나 상태는 사용하지 않는다. 하나의 원본 개체가 여러 규칙과 일치하면 `이번 근무 예정 → 새 결과 → 결과 대기 → 최근 변경` 순서로 하나의 대표 항목만 생성하고 관련 근거를 합친다. `communication`은 별도 원본 요청이므로 다른 도메인과 합치지 않는다.

활력징후 수치, 검사값 또는 자유서술 메모만으로 `COMMUNICATION_EXPLICIT_OPEN`을 만들 수 없다. 보고 요청은 `handoffRequests`의 구조화 원본이 있어야 한다.

같은 활력징후 필드 또는 진단·메모 생명주기의 여러 기간 사건은 현재 상태를 설명하는 준비 항목 하나로 묶고 모든 관련 event ID를 source ref로 보존한다. 검사, Device, 투약과 전달 요청은 구조화 원본 ID 하나당 준비 항목을 최대 하나만 만든다. 중간 사건 전체는 `변화 근거` 탭에 남기며 준비 보드가 타임라인을 복제하지 않는다.

### 9.3 그룹과 정렬

응답은 다음 고정 순서를 사용한다.

1. `patient_status`
2. `investigation`
3. `line_device`
4. `medication`
5. `communication`

도메인 안에서는 `relevantAt` 오름차순, 원본 ID, 항목 ID 순으로 안정 정렬한다. 시각이 없는 항목은 시각이 있는 항목 뒤에 둔다. 이 정렬은 임상 중요도나 긴급도를 의미하지 않는다.

## 10. API 계약

### 10.1 요청

```json
{
  "reviewStartAt": "2026-06-29T15:00:00+09:00",
  "shift": {
    "startsAt": "2026-07-02T07:00:00+09:00",
    "endsAt": "2026-07-02T15:00:00+09:00"
  },
  "records": [],
  "coverageGaps": []
}
```

- `records`는 같은 환자의 offset-aware snapshot 목록이다.
- `reviewStartAt`은 휴무 복귀 기간의 요청 기준이다.
- `shift`는 시연 중인 현재 근무 구간이며 `startsAt < endsAt`이어야 한다.
- 현재 snapshot의 `updated_at`은 `[shift.startsAt, shift.endsAt)` 안에 있어야 한다. 현재보다 뒤이거나 근무 종료 이후인 기록을 입력에 포함하면 HTTP 422로 거절한다.

### 10.2 응답

```text
ShiftReadinessResponse
├─ patient
├─ reviewPeriod
│  ├─ requestedStartAt
│  ├─ baselineRecordedAt
│  └─ currentRecordedAt
├─ shift
│  ├─ startsAt
│  └─ endsAt
├─ status: available | no_baseline | no_items | partial
├─ dataWarnings[]
├─ items[]
├─ groups
│  ├─ patientStatus[]
│  ├─ investigations[]
│  ├─ lineDevices[]
│  ├─ medications[]
│  └─ communications[]
└─ metrics
   ├─ itemCount
   ├─ newResultCount
   ├─ scheduledThisShiftCount
   ├─ pendingResultCount
   └─ domainCounts
```

`items`가 준비 항목의 단일 기준이다. `groups`는 항목 ID만 참조하며 사실을 복제하지 않는다. 서버는 사용자 확인 수나 완료 상태를 반환하지 않는다.

### 10.3 상태와 오류

| 상태 | 조건 | 화면 처리 |
|---|---|---|
| `available` | 기준·현재 기록이 있고 하나 이상의 항목이 있으며 알려진 공백 없음 | 준비 보드 표시 |
| `no_baseline` | 복귀 기준 이전 snapshot이 없음 | 기준 기록 부재와 확인 가능한 현재 항목만 표시 |
| `no_items` | 유효한 입력이나 표시 규칙에 해당하는 항목 없음 | `이번 근무에 표시할 항목 없음` 표시 |
| `partial` | coverage gap, 불완전 필드 또는 고아 근거가 아닌 복구 가능한 일부 경고 | 경고와 검증된 항목만 표시 |

환자 불일치, 빈 현재 기록, 중복·유효하지 않은 시각, 역전된 근무 구간과 스키마 오류는 HTTP 422로 거절한다. 내부 오류는 실패 응답을 반환하며 `no_items`로 변환하지 않는다. 프런트엔드는 실패 전의 다른 탭 결과를 보존하고 재시도를 제공한다.

## 11. 결정론적 요약과 LLM 경계

근무 준비 보드의 우측 `복귀 기간 요약`은 `items`와 `metrics`로 만드는 결정론적 문장과 목록을 기본으로 한다. 검사 결과값을 해석하거나 항목 간 인과관계를 생성하지 않는다.

기존 기간 비교의 SBAR와 선택적 AI 문장화는 `변화 근거` 탭에 그대로 유지한다. 이번 버전은 Shift Readiness 전용 LLM 호출을 새로 추가하지 않는다. 이후 문장화를 추가하더라도 LLM은 준비 항목을 생성·삭제·재분류하거나 `ruleCode`, 값, 시각, 근거를 바꿀 수 없으며 검증 실패 시 전체 결과를 버리고 결정론적 표현으로 돌아가야 한다.

따라서 OpenAI 크레딧 또는 API 키가 없어도 핵심 데모와 수용 기준이 모두 동작한다.

## 12. 프런트엔드 화면과 상호작용

### 12.1 모드 구조

- `직전 교대` 모드의 현재 비교 화면은 변경하지 않는다.
- `휴무 복귀` 모드에 `근무 준비`, `변화 근거`, `원본 기록`을 제공한다.
- 휴무 복귀 진입 시 기본 탭은 `근무 준비`다.
- `변화 근거`는 기존 현재 확인·기간 중 변경·활력징후 추세·전체 타임라인을 보존한다.
- `원본 기록`은 기존 읽기·세션 편집 경계를 보존한다.

### 12.2 선택된 화면안

시각 목업의 A안인 `Task First 근무 준비 보드`를 채택한다. 중앙 상단은 다음 세 수치를 우선 표시한다.

- 검토 진행 `확인 수 / 전체 항목 수`
- 이번 근무 예정 수
- 결과 대기 수

본문은 다섯 도메인을 고정 순서로 표시한다. 각 항목은 다음 읽기 순서를 가진다.

```text
관련 시각 → 핵심 내용 → 사실 상태 → 확인함 → 근거 보기
```

`근거 보기`는 해당 source ref의 원본 snapshot과 경로를 연다. 기간 사건이 있으면 기존 이전·현재 기록 쌍을 사용한다. 이동 후 대상 원본 제목으로 focus를 옮긴다.

근거 열람은 `확인함`의 선행 조건으로 강제하지 않는다. 근거를 열었다고 자동 확인 처리하지도 않는다. 두 동작을 분리해 사용자가 필요한 항목만 원본까지 내려가면서 확인 표시는 항상 명시적으로 남기게 한다.

### 12.3 확인 상태

브라우저의 `ShiftReadinessReviewState`는 다음 값을 가진다.

```text
reviewKey
acknowledgedItemIds[]
manualHandoverNote
```

`reviewKey`는 `patientId + reviewStartAt + shift window + currentRecordFingerprint`의 결정적 hash다. 원문 임상 값은 키 문자열에 노출하지 않는다. 같은 키에서는 환자 탭 이동 후에도 확인 상태를 복원한다. 환자, 복귀 기준, 근무 구간 또는 현재 기록 fingerprint가 달라지면 새 API 성공 후 새 검토 상태로 전환한다. 요청 실패 시 기존 성공 화면과 수기 메모를 보존한다.

확인 상태는 `sessionStorage`만 사용한다. API, fixture 또는 로컬 파일에 쓰지 않는다. 존재하지 않는 item ID는 hydration 때 제거한다.

### 12.4 좌·중·우 정보 계층

- 좌측 환자 목록: 환자별 `확인 5/7`을 표시하고 임상 완료를 뜻하는 색상은 사용하지 않는다.
- 중앙: 다섯 도메인과 개별 준비 항목을 주 작업 영역으로 사용한다.
- 우측: 복귀 기간 요약, 미확인 항목 바로가기, 수기 인계 메모를 표시한다.
- 휴무 복귀 모드에서는 전역 버튼을 `검토 완료`로 부르지 않는다. 항목별 `확인함`과 진행도만 제공한다.
- 직전 교대 모드의 기존 검토 계약은 회귀를 피하기 위해 유지한다.

### 12.5 시각 계층과 가독성

- 환자·복귀 기간·검토 현황은 1계층이다.
- 도메인 제목과 개수는 2계층이다.
- 개별 항목과 사실 상태는 3계층이다.
- 시간·근거 ID·판별 규칙은 4계층이다.
- 임상 본문은 최소 12px, 핵심 항목은 13–14px를 사용한다.
- 근거 링크와 상태 문구를 10px 이하로 축소하지 않는다.
- 색상만으로 상태를 구분하지 않고 텍스트 배지, 경계선과 아이콘을 함께 사용한다.
- 비어 있는 고정 높이 패널을 만들지 않고 항목 밀도에 따라 행 높이가 늘어난다.

### 12.6 반응형

- 1280px 이상: 환자 레일, 중앙 준비 보드, 우측 요약의 3열 유지
- 960–1279px: 220px 환자 레일과 280px 요약 레일을 유지하되 중앙 항목은 wrap하고 rail 아래로 가리지 않음
- 959px 이하: 주 작업 탭 안에서 중앙과 요약을 순차 영역으로 제공
- 390px: 항목을 `시각·상태 / 내용 / 확인·근거` 순서로 쌓고 수평 overflow를 만들지 않음
- 1600px 이상: 임상 본문을 축소하지 않고 중앙 여백을 항목 폭과 가독성에 배분

## 13. 상태 전환과 요청 경쟁

새 요청은 `patientId + reviewStartAt + shift + currentRecordFingerprint`로 식별한다. 환자 또는 조건 변경 중 이전 요청이 늦게 도착해도 현재 선택 결과를 덮어쓰지 못하도록 요청 세대 가드를 사용한다.

다음 동작은 새 요청 성공 후에만 현재 준비 보드와 review key를 교체한다.

- 환자 변경
- 마지막 근무 변경
- 근무 구간 변경
- 현재 기록 편집 후 재비교
- 데모 기록 초기화

요청 실패 시 기존 성공 결과는 남기고 오류 안내와 재시도만 표시한다. 다른 환자의 성공 결과를 현재 환자 결과처럼 남기지는 않는다. 환자 선택이 달라졌다면 준비 보드 대신 해당 환자의 오류 상태를 표시하되 캐시된 이전 환자 상태는 내부에 보존한다.

## 14. 접근성

- `근무 준비`, `변화 근거`, `원본 기록`은 `tablist`와 `tab` 계약을 사용한다.
- 도메인 제목은 heading 구조를 가지며 항목 수를 접근 가능한 이름에 포함한다.
- `확인함`은 checkbox로 제공하고 항목 제목을 접근 가능한 이름에 연결한다.
- 상태 배지는 색상 없이도 의미가 전달되는 한국어 텍스트를 포함한다.
- 근거 이동 후 원본 기록으로 focus가 이동하며 뒤로 돌아오면 원래 근거 버튼으로 복원한다.
- 로딩, partial과 오류는 하나의 상태 영역에서 `aria-live`로 알린다.
- reduced motion에서는 스크롤·강조 전환 애니메이션을 제거한다.

## 15. 오류 처리

- 정상 빈 결과와 로딩 실패를 같은 빈 화면으로 표현하지 않는다.
- API 실패는 `근무 준비 정보를 불러오지 못했습니다`와 재시도를 표시한다.
- 일부 필드가 누락됐지만 안전하게 제외할 수 있으면 `partial`과 필드 경고를 표시한다.
- 유효한 source ref가 없는 항목은 응답에 포함하지 않고 전체 결과를 `partial`로 만든다.
- 알 수 없는 enum은 임의 문자열로 화면에 표시하지 않고 계약 오류로 처리한다.
- 오류·partial·no baseline 항목은 사용자 검토 진행도의 분모에 포함되는 실제 items만 사용한다.
- `no_items`는 검토 완료로 표현하지 않는다.
- Shift Readiness 실패와 무관하게 기존 변화 근거와 원본 기록을 열 수 있다.

## 16. 테스트 전략

### 16.1 핵심 로직

- 새 검사 결과, 이번 근무 예정 검사와 결과 대기 상태의 경계값
- 활성 Device의 근무시간 내 교체 예정과 최근 삽입·제거 변화
- 투약 `effectiveFrom`의 시작 포함·종료 미포함 계산
- 현재 유지되는 복귀 기간 투약 변경과 기간 중 종료된 투약의 제외
- `open`인 명시적 전달 요청만 communication 항목으로 생성
- 활력징후·검사값·자유서술 메모만으로 communication 항목이 생성되지 않음
- 중복 규칙 일치 시 대표 상태와 근거 병합
- 결정적 ID, 안정 정렬, 환자 불일치·중복 시각·미래 기록 거절

### 16.2 계약과 fixture

- 모든 항목이 1개 이상의 실제 source ref를 가짐
- 모든 period event 참조가 기존 응답의 실제 event ID를 가리킴
- 고아·중복 근거와 원문 식별자 패턴 없음
- 다섯 환자 전체가 집합 수준에서 모든 도메인과 rule code를 포함
- API 호출 전후 fixture와 파일이 동일함
- `available`, `no_baseline`, `no_items`, `partial`, HTTP 422 계약

### 16.3 프런트엔드

- 휴무 복귀 진입 시 근무 준비 기본 탭
- 다섯 도메인 순서와 각 상태 배지
- 항목 확인·해제와 진행도 계산
- review key 변경과 동일 키 hydration
- 존재하지 않는 item ID 제거
- 요청 경쟁, 실패 시 성공 상태 보존과 환자 간 결과 오염 방지
- 근거에서 정확한 snapshot·경로 이동과 focus 복원
- `no_items`, `partial`, `no_baseline`, 오류 화면의 구분

### 16.4 통합·시각·회귀

- 1440, 1024, 960, 390px에서 수평 overflow, 레일 겹침과 잘린 행 없음
- 임상 본문, 상태와 근거의 계산 글자 크기 하한 검증
- 키보드만으로 환자 선택, 탭, 확인, 근거 이동 가능
- 기존 직전 교대 비교, 휴무 복귀 변화 근거, 원본 기록 편집 테스트 유지
- Python unittest, Vitest, Playwright, ESLint, Next build와 하네스 전체 통과
- Preview와 Production에서 root, health, period API와 shift-readiness API smoke 검증

## 17. 수용 기준

1. P001 기본 복귀 시나리오에서 다섯 도메인 중 최소 네 도메인이 표시된다.
2. 전체 fixture 집합이 다섯 도메인과 모든 승인된 rule code를 포함한다.
3. 표시된 준비 항목의 원본 근거 추적률은 100%다.
4. communication 항목은 구조화된 명시적 요청에서만 생성된다.
5. fact status와 사용자 확인 상태가 서버·브라우저 계약에서 분리된다.
6. API 키 없이 동일한 항목, 근거와 결정론적 요약이 제공된다.
7. 실패와 `no_items`가 시각·접근성 이름·진행도 계산에서 구분된다.
8. 390px부터 2544px까지 핵심 흐름에 수평 overflow나 레일 가림이 없다.
9. 임상 본문과 근거의 계산 글자 크기가 각각 12px 이상이다.
10. 기존 pair compare, period compare, 원본 기록 편집과 검토 기능의 자동 테스트가 유지된다.
11. 실제 환자정보, API 키 또는 영속 검토 데이터가 저장소·클라이언트 로그에 추가되지 않는다.
12. 현직 간호사 사용성 확인에서 한 환자의 이번 근무 확인사항을 30초 안에 설명할 수 있는지를 측정한다. 이는 검증 목표이며 현재 효과 주장으로 사용하지 않는다.

## 18. 구현 단위와 품질 게이트

구현은 다음 독립 단위로 나눈다.

1. 가상 fixture 스키마와 Python·TypeScript 계약
2. deterministic Shift Readiness projector와 단위 테스트
3. 별도 API와 상태·오류 계약
4. 프런트엔드 adapter, review key와 세션 확인 상태
5. 근무 준비 보드와 우측 요약
6. 변화 근거·원본 기록 이동 통합
7. 반응형·접근성·E2E·Preview 검증
8. 도메인 문서, 작업 로그, 버전, changelog와 Production 검증

각 큰 단위는 Luna Max 담당 에이전트의 TDD 구현과 자체 검증, 감독 에이전트의 코드 리뷰·테스트·화면 확인, 독립 읽기 전용 리뷰를 통과한 후 다음 단계로 진행한다. 같은 파일을 두 에이전트가 동시에 수정하지 않는다. 서브에이전트는 Git 작업과 버전·공통 문서를 변경하지 않는다.

## 19. 결정 근거

| 결정 | 근거 | 감수하는 비용 |
|---|---|---|
| 휴무 복귀 간호사를 1차 사용자로 고정 | 현재 기간 비교 엔진을 활용하면서 모든 교대용 일반 체크리스트보다 차별점이 명확함 | 일반 교대 확장은 후속 단계로 미룸 |
| Task First 보드를 기본 화면으로 선택 | 실제 인계 순서를 첫 화면의 읽기 순서로 바꿔 사용자가 타임라인을 다시 조립하는 부담을 줄임 | 전체 변화 흐름은 보조 탭에서 한 번 더 이동해야 함 |
| 별도 Shift Readiness API | 기존 pair·period 계약과 편집 세션의 회귀 위험을 격리함 | 새 계약과 adapter 유지 비용 발생 |
| 사실 상태와 확인 상태 분리 | 서버 사실을 사용자의 읽음 행위와 혼동하지 않음 | 단일 완료 플래그보다 상태 관리가 복잡함 |
| 명시된 전달 요청만 표시 | 활력징후나 검사값에서 승인되지 않은 보고 기준을 추론하지 않음 | 실제 기관 규칙 연동 전에는 자동 후보 발굴을 제공하지 않음 |
| 결정론적 요약 기본 | API 키·크레딧 없이 재현 가능하고 근거 이탈을 차단함 | LLM 기반 자연스러운 브리핑은 이번 버전에서 확장하지 않음 |
| 세션 저장만 사용 | Vercel 무상태 배포와 가상 데모 경계를 유지함 | 브라우저 종료·기기 변경 시 확인 상태가 사라짐 |
| 30초 설명 가능성을 검증 목표로 설정 | 제품 가치가 단순 항목 수가 아니라 근무 전 파악 속도에 있기 때문 | 현직자 테스트 전에는 효과 수치로 주장할 수 없음 |

## 20. 후속 검증과 확장

`0.9.0` 구현 후 현직 간호사에게 다음을 확인한다.

- 다섯 도메인의 순서가 실제 인계 흐름과 맞는가
- `확인함`이 읽음으로 이해되고 수행 완료로 오해되지 않는가
- 결과 대기, 이번 근무 예정과 새 결과 표현이 구분되는가
- 30초 안에 이번 근무 확인사항을 설명할 수 있는가
- 기존 타임라인과 원본 근거까지 내려가는 흐름이 과도하지 않은가

검증 이후에만 다음 확장을 별도 설계한다.

- 모든 교대 간호사용 Shift Readiness
- 인증·근무표 기반 복귀 기간 자동 계산
- 기관 승인 프로토콜과 명시적 보고 규칙 연동
- EMR/LIS/PACS event feed와 감사로그
- 공유 검토 상태와 실제 수행 워크플로
- 근거 제한 LLM 브리핑 문장화

이 후속 항목은 현재 API, fixture 또는 `0.9.0` 수용 범위에 포함하지 않는다.
