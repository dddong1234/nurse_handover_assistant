# Agent Worklog

이 문서는 서브에이전트 작업, 감독 검증, 수정 라운드와 품질 게이트 상태를 기록한다.

## 상태 값

- `PLANNED`: 작업 범위만 정의됨
- `IN_PROGRESS`: 담당 에이전트 작업 중
- `REVIEW`: 감독 에이전트 검증 대기 또는 진행 중
- `REVISION`: 담당 에이전트 수정 중
- `PASSED`: 감독 검증 통과
- `BLOCKED`: 사용자 판단 또는 외부 조건 필요

## 작업 기록

| 날짜 | 작업 | 담당 | 하네스 | 상태 | 변경 범위 | 검증 | 수정 라운드 | 비고 |
|---|---|---|---|---|---|---|---:|---|
| 2026-08-27 | WikiDocs 구성요소 기반 저장소 하네스 도입 | supervisor | 1.1.0 | PASSED | 지시 문서, 아키텍처 센서, 테스트·CI, 지식 저장소, 드리프트 검사 | 하네스 검사 통과, 단위 테스트 6/6 통과, 50환자 비교 벤치마크 실행 성공, `git diff --check` 오류 없음 | 0 | Codex 번들 Python 사용; 구현 에이전트 미투입 |
| 2026-08-27 | Vercel 배포 목표 반영 | supervisor | 1.2.0 | PASSED | 배포 ADR, 환경 관례, 무상태·보안 제약, 버전 `0.3.0-dev.2` | 공식 Vercel 문서 검토, 하네스 검사 통과, 단위 테스트 6/6 통과, placeholder 및 diff 오류 없음 | 0 | 애플리케이션 스택 전환 코드는 미구현 |
| 2026-08-28 | Figma Make 분석 및 비교·요약 중심 재설계 | supervisor | 1.2.0 | PASSED | Figma 토큰/컨텍스트 분석, 제품·화면 명세, 7단계 구현 계획 | Make 루트 컨텍스트와 실제 미리보기 확인, 명세·계획 placeholder 검사, `git diff --check` 오류 없음 | 0 | 기존 4탭 구성은 제외; 일반 성인병동 교대 인수인계를 기준 가정으로 채택; 제품 코드는 미변경 |
| 2026-08-28 | 구조화된 차이 비교 엔진 | core-logic (Luna Max) | 1.2.0 | PASSED | `services/handover_service.py`, `tests/test_handover_service.py` | 독립 review·2회 수정 검증 완료; supervisor focused 11/11·full 17/17·harness 통과; P001–P005 모두 ready·근거 ID 유일 | 2 | legacy 정렬 호환, collision-safe ID, JSON evidence path 확인 |
| 2026-08-28 | 결정론적 SBAR 계약 및 무상태 FastAPI | core-logic (Luna Max) | 1.2.0 | PASSED | `services/handover_service.py`, `api/index.py`, `api/__init__.py`, `tests/test_handover_api.py` | 독립 review·1회 수정 완료; supervisor focused 19/19·full 25/25·harness·P001–P005 API 근거 완전성·전체 fixture 불변 통과 | 1 | `no_previous`/`no_changes` 구분, 임상 조언 없는 Recommendation, 무상태 API 확인; partial 전용 문구 테스트는 후속 Minor |
| 2026-08-28 | Next.js 작업공간 셸 및 typed demo adapter | frontend (Luna Max) | 1.2.0 | PASSED | `src/app/`, `src/lib/`, `src/test/`, `src/components/handover/HandoverWorkspace.tsx` | supervisor Vitest 3/3·lint·build·Python 25/25·harness 통과; 독립 재검토 Critical/Important 0건; CSS 산술상 960–1279px 수평 넘침 해소 | 1 | Task 3; 의미 색상·상태 문구·watch 대비·section evidence 검증 수정 완료. 축약 문구와 비활성 검색 placeholder 대비는 Task 4 Minor 후속 |
| 2026-08-28 | 환자 큐 상호작용 및 Shift Seam 비교 화면 | frontend (Luna Max) | 1.2.0 | PASSED | `src/components/handover/`, `src/app/globals.css` | supervisor frontend 18/18·lint·build·Python 25/25·harness 통과; 독립 재검토 Critical/Important 0건 | 1 | Task 4; 계약 기반 상태 문구, 검색 accessible name, empty safety, 선택·검색·일관성 회귀 테스트 완료. viewport E2E는 Task 7 |
| 2026-08-28 | 근거 연결 SBAR 패널 및 compare API 클라이언트 | frontend (Luna Max) | 1.2.0 | PASSED | `src/components/handover/`, `src/lib/handover-api.ts`, `src/lib/demo-records.ts`, `src/app/page.tsx`, `src/app/globals.css` | supervisor frontend 40/40·lint·build·Python 25/25·harness·P001–P005 API smoke 통과; 독립 최종 review Critical/Important 0건 | 2 | Task 5; reviewed snapshot·fixture fallback·pair-aware pending 상태 머신, 근거 focus/포함률, 수기 Recommendation, session-only review 완료. 직렬화·비정상 status·ordering test는 비차단 Minor |
| 2026-08-28 | 레퍼런스 기반 비교 중심 시각 위계 개선 | frontend (Luna Max) | 1.2.0 | PASSED | `src/components/handover/`, `src/app/globals.css`, 제품 명세·작업 계획 | supervisor Vitest 44/44·lint·build·Python 25/25·harness 통과; 새 브라우저 첫 로드 오류 0건, 1280·1024·390px 수평 넘침 없음, 근거 링크→변화 상세 focus/open 확인; 독립 review Critical/Important/Minor 0건 | 1 | Task 5A; hydration 비결정성 제거 및 1024px 요약 띠 줄바꿈 보정 완료; 데이터 계약·API·임상 의미는 변경하지 않음 |
| 2026-08-28 | 서버 전용 OpenAI 문장화 및 결정론적 fallback | core-logic (Luna Max) | 1.2.0 | PASSED | `services/openai_service.py`, `api/index.py`, 관련 오프라인 테스트 | 독립 review 2회 수정 후 clean; supervisor focused 28/28·Python 45/45·frontend 44/44·lint·build·py_compile·harness 통과 | 2 | P001 실 API는 `429 credit_balance_exhausted`; HTTP 200 deterministic fallback·근거 9/9·사용 토큰/비용 0 확인. 성공 AI 문장화는 크레딧 확보 후 재검증 필요 |
| 2026-08-28 | 인수인계 Assistant 기획·근거 조사·산출물 패키지 | supervisor | 1.2.0 | PASSED | Notion 리서치 허브, 9쪽 DOCX/Google Docs 기획서, Figma 메인·예외상태 화면 | Google Docs native 변환 및 PDF 9쪽 전 페이지 렌더 검토; DOCX 접근성 0건·표 geometry·제목선 검사 통과; Figma 1440×1024 메인 화면과 상태 보드 screenshot·metadata 검증 | 2 | 두 번째 Notion의 AI 차팅 코파일럿은 병렬 별도 모듈로만 기록. 시간·금액은 외부 근거, MVP 목표, 병동 시나리오 가정을 분리하고 직접 현금절감이 아닌 기회가치로 표기 |

## 마일스톤 게이트

| 마일스톤 | 목표 버전 | 상태 | 감독 검증 기준 |
|---|---:|---|---|
| 현재 MVP 기준선 검증 | `0.3.0` | PLANNED | 기존 기능 실행, 핵심 흐름 smoke test, 알려진 한계 기록 |
| 구조화된 차이 비교 | `0.4.0` | PLANNED | 단위 테스트, 누락·오탐 사례 검증, UI 계약 고정 |
| Figma 기반 UI 통합 | `0.5.0` | PLANNED | MCP 설계 대조, 주요 화면 시각 검증, 상태별 UI 확인 |
| 근거 제한 AI 요약 | `0.6.0` | PLANNED | 오프라인 fallback, API 통합 테스트, 환각·누락 평가 |
| 포트폴리오 안정판 | `1.0.0` | PLANNED | 전체 시연 시나리오, 회귀 테스트, 문서·영상 준비 |

## 기록 규칙

1. 작업을 위임하기 전에 행을 추가하고 `PLANNED`로 표시한다.
2. 에이전트가 하네스를 수용하면 `IN_PROGRESS`로 변경한다.
3. 감독 검증을 시작하면 `REVIEW`로 변경하고 검증 근거를 기록한다.
4. 수정 요청마다 수정 라운드를 1씩 증가시킨다.
5. 두 번째 검증에서도 중대한 문제가 남으면 `BLOCKED`로 표시하고 사용자에게 보고한다.
6. 검증을 통과한 작업만 `PASSED`로 표시하고 버전 변경 후보가 된다.
