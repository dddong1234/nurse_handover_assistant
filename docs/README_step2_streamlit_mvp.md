# Nurse Handover Assistant - Step 2: Streamlit MVP 설계

## 목적

이 단계의 목표는 기존의 dict/JSON 중심 MVP 구조를 유지하면서,
`웹형 UI 입력 -> JSON 저장 -> 인수인계 요약 생성` 흐름을
`Streamlit`으로 빠르게 구현 가능한 형태로 구체화하는 것이다.

이 단계에서는 다음을 구현 대상으로 본다.

1. 환자 정보를 입력하는 EMR 스타일 웹 UI
2. 입력된 환자 정보를 JSON 파일로 저장
3. 인수인계 화면에서 환자 변동사항 자동 요약

## 왜 Streamlit인가

현재 프로젝트 요구사항은 정식 병원 EMR 수준의 복잡한 권한, 인증,
다중 사용자 협업보다 다음이 더 중요하다.

1. 빠른 MVP 구현
2. 입력 폼 구성의 단순성
3. JSON 저장과 즉시 결과 확인
4. 인수인계 요약 로직 검증

이 요구에는 Flask보다 Streamlit이 더 적합하다.

장점:

1. 별도 프론트엔드 없이 폼과 화면 구성이 빠르다
2. 버튼 클릭 기반 워크플로우 구현이 쉽다
3. 표와 입력창, 상태 메시지, 요약 영역을 바로 만들 수 있다
4. 초기 PoC와 데모에 적합하다

제약:

1. 복잡한 권한 관리에는 약하다
2. 다중 사용자의 동시 편집에는 적합하지 않다
3. 정교한 SPA 스타일 UI 제어는 제한적이다

결론:

MVP는 Streamlit으로 구현하고,
실사용 서비스로 확장할 때 Flask/FastAPI 기반 구조로 이전하는 전략이 적절하다.

## 목표 사용자 흐름

간호사 사용 흐름은 아래와 같이 정의한다.

1. 환자 목록에서 환자를 선택하거나 신규 환자를 등록한다
2. EMR 입력 화면에서 기본정보, 바이탈, 투약, 메모를 입력한다
3. 저장 버튼을 누르면 현재 환자 정보가 JSON으로 저장된다
4. 저장 전 기존 데이터가 있으면 이전 snapshot을 history에 보관한다
5. 인수인계 탭으로 이동한다
6. 환자를 선택하고 `인수인계 하기` 버튼을 누른다
7. 시스템이 직전 데이터와 현재 데이터를 비교해 변동사항을 요약한다

## 화면 구조

Streamlit에서는 멀티페이지보다 단일 앱 + 탭 구성이 MVP에 더 적합하다.

권장 구조:

1. `환자 입력` 탭
2. `환자 목록` 탭
3. `인수인계` 탭

### 1. 환자 입력 탭

목적:
환자 정보를 신규 등록하거나 수정한다.

구성:

- 환자 선택 드롭다운
- 신규 환자 생성 버튼
- 기본정보 섹션
- 바이탈 섹션
- 투약 섹션
- 메모 섹션
- 저장 버튼

입력 필드 예시:

- patient_id
- name
- room_no
- age
- sex
- diagnosis
- systolic
- diastolic
- heartrate
- respiratory
- saturation
- body_temperature
- medications
- notes

권장 위젯:

- `st.selectbox`: 기존 환자 선택
- `st.text_input`: 이름, 병실, 진단, 메모
- `st.number_input`: 나이, 바이탈 수치
- `st.data_editor`: 투약 목록 편집
- `st.form`: 저장 단위 제어

### 2. 환자 목록 탭

목적:
저장된 환자 JSON 목록을 빠르게 조회한다.

구성:

- 환자 요약 테이블
- 최근 수정 시간 표시
- 변동 여부 표시

표시 컬럼 예시:

- patient_id
- name
- room_no
- diagnosis summary
- updated_at
- handover_status

### 3. 인수인계 탭

목적:
환자의 최신 변경사항을 자동 요약한다.

구성:

- 환자 선택
- 이전 snapshot 존재 여부 표시
- `인수인계 하기` 버튼
- 변화 요약 결과 박스
- 현재 데이터 / 이전 데이터 비교 영역

출력 예시:

```text
- 활력징후 변화: systolic 120 -> 150, body_temperature 37.5 -> 38.2
- 투약 변화: 타세놀정 500mg 신규, 광동라푸티딘 중단
- 신규 메모: 미열 지속
- 신규 진단: hypertension
```

## 디렉토리 구조

권장 디렉토리 구조는 아래와 같다.

```text
nurse_handover_assistant/
  app.py
  requirements.txt
  data/
    patients/
    history/
  services/
    patient_service.py
    storage_service.py
    handover_service.py
  utils/
    time_utils.py
  docs/
    README_step1_MVP.md
    README_step2_streamlit_mvp.md
```

## 모듈 설계

### app.py

역할:

- Streamlit 앱 진입점
- 탭 렌더링
- 사용자 입력 수집
- 서비스 함수 호출

### services/storage_service.py

역할:

- 환자 JSON 저장
- 환자 JSON 불러오기
- snapshot 저장
- history 조회

필수 함수:

- `load_patient(patient_id)`
- `load_all_patients()`
- `save_patient(patient_data)`
- `save_snapshot(patient_data)`
- `get_latest_snapshot(patient_id)`

### services/patient_service.py

역할:

- 입력 폼 데이터를 표준 patient dict로 변환
- 기본 유효성 검사

필수 함수:

- `build_patient_data(form_values)`
- `validate_patient_data(patient_data)`
- `summarize_patient_row(patient_data)`

### services/handover_service.py

역할:

- 이전 데이터와 현재 데이터 비교
- 변화 목록 생성
- 사람이 읽기 쉬운 인수인계 문장 생성

필수 함수:

- `detect_changes(prev_data, curr_data)`
- `compare_vitals(prev_data, curr_data)`
- `compare_medications(prev_data, curr_data)`
- `compare_notes(prev_data, curr_data)`
- `compare_diagnosis(prev_data, curr_data)`
- `generate_handover_text(changes)`

## JSON 저장 구조

환자 최신본은 `data/patients`에 저장한다.

예:

`data/patients/P001.json`

이전 이력은 `data/history`에 시점별 snapshot으로 저장한다.

예:

`data/history/P001/2026-06-28T103000.json`

최신 환자 JSON 예시:

```json
{
  "patient_id": "P001",
  "name": "홍길동",
  "room_no": "301",
  "age": 67,
  "sex": "M",
  "diagnosis": [
    "acute pharyngitis"
  ],
  "vitals": {
    "systolic": 120,
    "diastolic": 80,
    "respiratory": 16,
    "heartrate": 78,
    "saturation": 98,
    "body_temperature": 37.5
  },
  "medications": [
    {
      "name": "이부프로펜 400mg",
      "route": "PO",
      "frequency": "TID"
    }
  ],
  "notes": [
    "인후통 호소"
  ],
  "updated_at": "2026-06-28T10:30:00+09:00"
}
```

## 저장 흐름

환자 저장 시 처리 순서는 아래와 같다.

1. 폼 입력값 수집
2. 표준 patient dict 생성
3. 필수값 검증
4. 기존 최신본 존재 여부 확인
5. 기존 최신본이 있으면 history snapshot 저장
6. 최신본을 `data/patients/{patient_id}.json`에 저장
7. 저장 완료 메시지 표시

주의:

신규 저장과 수정 저장을 같은 함수에서 처리하되,
기존 파일이 있을 때만 snapshot을 남기도록 한다.

## 변화 감지 규칙

기존 `main.py`의 `detect_changes()`는 방향은 맞지만,
실제 MVP에서는 비교 범위를 확장해야 한다.

비교 대상은 아래 4개로 정의한다.

### 1. vitals 비교

변경된 값만 추출한다.

예:

- systolic 120 -> 150
- body_temperature 37.5 -> 38.2

### 2. medications 비교

아래 3가지를 분리한다.

1. 신규 처방
2. 중단
3. 용법/빈도 변경

예:

- 타세놀정 500mg 신규
- 광동라푸티딘 중단
- 이부프로펜 400mg 복용정보 변경: BID -> TID

### 3. diagnosis 비교

신규 진단 추가 여부를 비교한다.

예:

- hypertension 추가

### 4. notes 비교

새로 추가된 메모만 추출한다.

예:

- 미열 지속

## 인수인계 생성 흐름

인수인계 탭에서 `인수인계 하기` 버튼 클릭 시 아래 순서로 처리한다.

1. 현재 환자 최신본 로드
2. 직전 snapshot 로드
3. snapshot이 없으면 `비교 가능한 이전 데이터 없음` 표시
4. snapshot이 있으면 `detect_changes()` 실행
5. 결과를 사람이 읽는 문장으로 변환
6. 화면에 bullet 형태로 렌더링

## Streamlit 상태 관리

MVP에서는 복잡한 상태 관리가 필요 없다.
다만 아래 정도는 `st.session_state`로 관리하는 것이 좋다.

- 현재 선택 환자 ID
- 신규 생성 모드 여부
- 마지막 생성된 인수인계 결과

주의:

저장된 진실 데이터는 항상 JSON 파일이다.
`session_state`는 임시 UI 상태만 가진다.

## 개발 순서

### Phase 1. 실행 가능한 기본 골격

1. `Streamlit` 의존성 추가
2. `app.py` 생성
3. 탭 3개 기본 뼈대 구성

### Phase 2. JSON 저장 기능

1. `storage_service.py` 구현
2. `data/patients`, `data/history` 디렉토리 생성
3. 저장/불러오기 검증

### Phase 3. 입력 폼 구현

1. 기본정보 입력 폼
2. 바이탈 입력 폼
3. 투약 입력 테이블
4. 메모 입력

### Phase 4. 변화 감지 구현

1. 기존 `main.py` 로직 분리
2. vitals 비교
3. medications 비교
4. diagnosis, notes 비교

### Phase 5. 인수인계 화면 연결

1. 환자 선택
2. 직전 snapshot 로드
3. `인수인계 하기` 버튼 연결
4. 결과 표시

## MVP 완료 기준

아래가 모두 가능하면 Step 2 MVP 완료로 본다.

1. Streamlit 앱 실행 가능
2. 웹 UI에서 환자 정보 입력 가능
3. 환자 정보 JSON 저장 가능
4. 기존 환자 수정 시 snapshot 저장 가능
5. 인수인계 버튼 클릭 시 변화 요약 생성 가능

## 다음 단계 확장 포인트

MVP 이후에는 아래 순서로 확장할 수 있다.

1. JSON에서 SQLite로 저장소 전환
2. 환자 검색 기능 추가
3. 병실별 필터 추가
4. 간호사별 인계 큐 관리
5. LLM 기반 자연어 인수인계 요약 고도화
6. FastAPI 또는 Flask 기반 백엔드 분리

## 구현 시 주의점

1. 환자 ID는 파일명으로 쓰므로 공백과 특수문자를 제한해야 한다
2. medications는 dict가 아니라 list of dict로 통일하는 것이 비교와 UI 편집에 유리하다
3. notes는 전체 덮어쓰기보다 신규 메모 append 구조를 고려해야 한다
4. snapshot 저장 시각은 정렬 가능한 ISO 형식을 사용해야 한다
5. 변화 감지 규칙은 먼저 deterministic rule 기반으로 만들고, LLM은 나중에 붙이는 것이 맞다

이 문서는 Streamlit 기반 Nurse Handover Assistant MVP 설계 문서이다.
