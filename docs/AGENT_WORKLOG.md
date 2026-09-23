# Agent Worklog

이 문서는 서브에이전트 작업, 감독 검증, 수정 라운드와 품질 게이트 상태를 기록한다.

## 2026-09-24 CareNote 차팅 재작업 — 1.0.3 / PASSED·배포 완료

- 사용자 요청: ‘모두 직접 작성 필요’로 표시되는 통합 차팅을 기존 담당에게 재작업. 원본 앱의 문장 추천·채택 경험을 참고하되 입력에 없는 사실 생성은 복원하지 않는다.
- 차팅 담당의 Harness 1.2.0 수용과 6개 지정 파일 구현 보고를 확인. 감독이 별도 CareNote 부분 SOAP 검증 정책을 결정했으며 실제 병원 기록 정책으로 확대하지 않는다. 상세 이유: `docs/verification/2026-09-24-carenote-charting-rework.md`.
- 별도 랜딩 담당은 예시/FAQ와 테스트 2파일만 동기화, CSS 미변경, focused 3/3 보고. 감독이 차팅 5 + 랜딩 7 E2E 12건 및 실제 추천·채택·원문 비교·명시 추가·390px 표시를 직접 확인했다.
- 독립 계약 리뷰 Critical 0 / Important 0 / Minor 2. 과도한 미완성 문구 차단과 여러 줄 우회 문제를 같은 차팅 담당에게 검증기/테스트 2파일만 수정하도록 지시. 담당 RED 7 FAIL / 28 PASS 보고; 최종 동결 대기.
- 감독 Python 155 및 harness 통과. 전체 프런트엔드 회귀·빌드·배포는 아직 진행 전이며 현재 결과는 임상 효과·사용성 개선 수치가 아니다.
- 협업 Notion COLLAB-027~029에 사용자 피드백, 범위 조율, 독립 리뷰와 수정 지시를 기록했다.
- FIX ROUND 1 동결 후 독립 재리뷰에서 두 건 해결 확인. 감독 전체 Vitest 33파일473건, 전체 E2E86건, Next build 및 전체 ESLint 통과. 버전 1.0.3 반영. 전체 E2E 일부와 검증기 수정이 겹친 점은 검증 문서에 명시하고 배포 후 차팅을 재검사한다. 기존 원본 차팅 저장소·API·환자 데이터·main은 미변경.
- 최종 고정본에서 CareNote18건 로컬 재검사 통과 후 Preview5CR7NvXDPRe9g9C99RkUBoAJA9sT 화면/API 확인, Production8mWggwNE85tkB59Pn2t7jipXxauE 승격/READY 확인. 공개 차팅·랜딩·실API18건 통과 및 실제 추천 화면 검수. 제품16b242ca, 상세 배포/검증 문서 보존.

## 2026-09-23 CareNote 문구 정리 — 1.0.1 / PASSED·배포 완료

- 사용자 요청: 불필요한 문구 삭제. 기존 승인 화면의 문구만 줄이며 기능·임상 의미·저장 정책·기존 두 서비스는 보존한다.
- 계획: `design-plans/2026-09-23-carenote-copy-cleanup.md`. 랜딩 담당은 LandingPage 3개 파일, 작업공간 담당은 CareWorkspace/ChartingPanel 표시·테스트 파일만 수정한다. 감독은 E2E·문서·통합 검증 담당.
- 제거 대상: 장식 영어, 반복 소개·탭 설명, 정상 완료 배너. 유지 대상: 오류/불완전 데이터, 원본 시각, 읽음 의미, 새로고침 소실 및 미완성 초안 안내.
- E2E의 정상 완료 문구 검사를 실제 항목·API 응답 검사로 대체했다. 최초 실행에서 근거 상세와 목록의 동명 제목으로 strict locator가 실패하여 목록 안으로 범위를 한정했다. 수정한 E2E 기준선 6/6 통과. 제품 결함으로 분류하지 않는다.
- 수정 전 Python155 및 harness 통과. 담당 수정 완료 후 최종 고정 검증 예정. 협업 Notion COLLAB-020에 작업 범위 기록.
- 두 담당의 HARNESS_ACK 1.2.0 및 소유 파일 수용을 확인했다. 랜딩 focused4, 작업공간/차팅 focused25 통과 보고. 담당의 중간 RED 보고에는 테스트 DOM 정리·중복 선택자 문제도 포함되어 있어 모두 제품 결함 재현으로 표현하지 않는다.
- 감독이 소스/CSS 차이를 검토하고 최종 전체 Vitest429, 실제 API E2E6, Next build를 직접 통과 확인했다. 390/960/1440 근거·기록 흐름 및 랜딩/간호기록 화면을 확인했다. 최종 상세 결과: `docs/verification/2026-09-23-carenote-copy-cleanup.md`.
- 버전 반영 후 harness 통과, 전체 ESLint·TypeScript·diff 통과. 제품95c778e3 푸시 후 별도 Preview 원격 화면/API 확인, Production2hcUF9UPSqZKu5DpDbgeeZxB2t9F 승격. 공개 carenote-suite.vercel.app 변경 문구 확인 및 실제API E2E6/6 통과. 기존 서비스/main 보존.

## 2026-09-23 CareNote 통합 제품 — 1.0.0

- 기준: origin/main `2610a017`, 별도 `codex/1.0-carenote-suite`. 기존 원본·배포 보존. 사용자 승인으로 구현·랜딩·배포까지 수행하며 파괴적 변경은 제외.
- 하네스 1.2.0: 차팅 peer는 `src/features/carenote-charting/**`, UI는 `CareWorkspace*`와 `LandingPage*`로 분리. 감독은 공통 계약·라우팅·검증·문서·Git·배포 담당.
- Figma39:3 MCP 검토 후 navy/teal 임상 UI 문맥만 사용. 근무 준비 우선 정보구조로 재구성.
- 차팅 수정: Next 내부 import 해결; 독립 리뷰의 미입력 사실 생성·부분입력 유실·미래근거 연결 3건을 RED 재현 후 좁은 adapter/시간 경계로 해결. 독립 재리뷰132건 및 별도 재현 통과.
- UI 수정: 모바일 핵심탭 노출, 원본시각 명시, reviewKey별 메모, 큰 글씨 적용 후 생긴 근거 overflow를 숨김 없이 수정. 독립390/960/1440 가로폭·내용·포커스·상태검사 통과.
- 랜딩 수정: 실제 P001 시나리오 및 지원 차팅으로 예시 교체. 미입력 SOAP 직접작성, 메모리/서버 계산 구분. 허구 성과·고객·가격·결제 없음.
- 감독 게이트: Vitest423, Python155, 기존 E2E68, 새 실제API E2E6 통과. lint/typecheck/build/harness 통과. 자세한 명령·제약은 릴리스 검증 기록 참조.
- Notion 새 협업 페이지에 배정/보고/수정/재검증을 연속 기록. 사용자1인의 프로젝트이며 AI 협업을 사람 팀 경험으로 표현하지 않음.
- 배포 상태는 `docs/verification/2026-09-23-carenote-release.md`에 별도 기록. 자동 테스트 결과와 사용자 과업/효과 검증을 구분한다.
- 배포 완료: CareNote 별도 Preview 검증 후 Production `https://carenote-suite.vercel.app` READY. 배포 코드43713c4d. 공개 주소 익명 실제API E2E6/6 통과. 새 프로젝트의 자동 환경 감지 문제는 Next.js/Python3.12 명시로 수정했고 첫 빌드는 취소했다.

## 상태 값

2026-09-14 배포 승인: 사용자 `굿 좋은데 배포해`. `codex/0.10.0-onboarding`의 검증된 파일만 커밋·푸시하고 Preview 빌드·화면·API 확인 후 main PR 병합 및 Production smoke 검증을 수행한다. 아래 원격 미반영 문장은 구현 완료 시점의 이력이다. 배포 실행 결과와 URL·커밋 SHA는 해당 릴리스 PR의 검증 댓글에 기록한다. 최신 origin/main은 구현 기준과 동일한 `449dfddd`; 루트 checkout과 다른 작업은 보존한다. 배포 직전 Vitest282/282, Python155/155, harness 재실행 통과.

2026-09-14 최종 상태: **PASSED · 0.10.0**. 사용자 `ㅇㅇ` 및 `다시 ㄱㄱ`로 재개 승인 후 동일 frontend Luna Max가 FIX ROUND 2를 수행했다. 아래 BLOCKED는 재개 전 이력이다. 활성 탭 패널의 표시된 대상만 참조하고 원본 기록 모드에서는 기록 헤더를 유지하도록 수정했다. 회귀 E2E RED(기록 하단590.203 > 안내 시작535.359) → GREEN 및 감독 화면 검사(기록379–464, 안내535–832), 독립 재리뷰 잔여 문제 0. 감독 최종 Vitest 282/282, 기존 E2E 64/64, 안내 E2E 4/4, Python 155/155, Next build, TypeScript, 변경 파일 ESLint, harness, diff-check 통과. Python 실행 경로: `.superpowers/.venv/Scripts/python.exe` (3.12). 첫 전체 Vitest의 포커스 검사 1건 실패는 안내창 focus 이전 이벤트를 발생시킨 테스트 준비 시점 문제로, focus 대기를 추가한 후 전체 재실행 통과; 브라우저 Tab 양방향·Escape도 독립 확인. VERSION/package.json/CHANGELOG를 함께 0.10.0으로 반영. 임상 로직·계약·API 키 접근 변경 없음. 원격 push·merge·배포는 수행하지 않음.

튜토리얼 2026-09-14 최종 게이트: **BLOCKED (수정 1회 후 재검증)**. supervisor Python 155/155, Next build, 기존 E2E 64/64 통과; 수정 후 전용 E2E 3/3 통과. 구현 담당 focused 112/112, tsc/lint 통과 보고. 독립 리뷰의 기존 두 문제(환자 목록 재실행 스크롤, 1440→390 전환 시 대상 이탈)는 재현 검사로 해결 확인. 그러나 수정 코드의 `mobileActionTarget`이 document 전체에서 숨겨진 비교 버튼을 선택하여, 모바일 원본 기록 모드 3단계에서 실제 기록 헤더(y505–590)가 안내 카드(y535부터)와 겹치는 새 Important 회귀 확인. 근거: `OnboardingTour.tsx:546–550`; 재현: 390×844 → 원본 기록 → 화면 안내 → 시작 → 3단계. 활성 표시 패널/대상 안에서만 action을 찾도록 수정 필요. 하네스에 따라 추가 수정·버전 승격·커밋/푸시/머지를 중단하고 사용자에게 보고. VERSION은 0.9.0 유지; 원격 변경 없음.

- `PLANNED`: 작업 범위만 정의됨
- `IN_PROGRESS`: 담당 에이전트 작업 중
- `REVIEW`: 감독 에이전트 검증 대기 또는 진행 중
- `REVISION`: 담당 에이전트 수정 중
- `PASSED`: 감독 검증 통과
- `BLOCKED`: 사용자 판단 또는 외부 조건 필요

## 작업 기록

2026-09-24 차팅 재작업 정책 조율: 담당이 기존 4입력×근거 유무 8조합을 실행 비교하여 원본의 문장화와 미확인 확인·계획 자동 생성, 현 통합의 원문복사+placeholder 차이를 보고했다. 감독은 사용자 재작업 요청과 가역적 자율 진행 범위에서 **CareNote 데모에 한정한 근거 있는 부분 SOAP** 구현을 허용했다. 이는 공식 병원 기록 요건 변경이 아니다. 전역 legacy validator 완화 대신 적용 범위를 제한한 새 검증, 빈/중복/역순/placeholder 거부, 의미를 확장하지 않는 문장화, 명시 추가 및 근거 경계 유지 조건을 전달했다. ‘호소함/관찰함/확인함/계획’의 임의 보충과 과거 사실의 현재화는 복구하지 않는다. 공통 schema/API/원본 앱/Git/배포 수정 금지 유지. 결과 동결 후 감독이 사용자 흐름·문서·랜딩·E2E를 대조할 예정이다. 구현 검증은 아직 미완료.

2026-09-24 차팅 재작업 **IN_PROGRESS**: 담당의 HARNESS_ACK 1.2.0과 `src/features/carenote-charting/**` 소유권·비범위 수용 회신을 확인했다. 기존 4입력의 이전 출력·현재 어댑터·기록 추가 경계 비교부터 착수하며, 공유 계약 또는 SOAP 필수 섹션 정책 충돌은 감독에게 먼저 보고하기로 했다.

2026-09-24 차팅 경험 복구 재작업: **DISPATCHED / ACK 대기**. 사용자가 ‘잠 못잠’에 S 원문과 O/A/P 작성 필요만 나오는 화면을 지적하며 기존 차팅 담당에게 다시 구현하도록 명시했다. `EMR 차팅 MVP 기획 수립` 작업(01a04625-a8f9-7662-8b4d-c1410d087043)에 하네스1.2.0, 기존 앱 출력 대조, 입력 문장화·추천/채택 경험 복구, 사실 생성 금지 경계, 테스트·보고 계약을 전달하고 active 상태 확인. 소유 범위는 `src/features/carenote-charting/`의 관련 구현/테스트이며 기존 UI 동결을 해당 범위만 해제. 원본 차팅 저장소는 읽기 전용, 공통 계약·워크스페이스·랜딩·API·Git·배포는 비범위. 현재 구현 수정/검증 완료로 간주하지 않으며 감독 재검증 후 통합 예정. 협업 Notion COLLAB-027 기록.

2026-09-23 CareNote 랜딩 **1.0.2 배포 완료**. 제품 커밋 f9b30bb9, Preview `dpl_4mCQGC3VKKNLsFnfQtKin3EMxsgc`의 랜딩/차팅/합성 API 확인 후 Production `dpl_GnSk2BpYzFuJ66Sjg89k5SQgWVNH`로 승격. 공개 주소에서 로그인 없는 랜딩+실 API E2E13/13 및 실제 화면 확인 완료. 기존 서비스·main 미변경. 협업 Notion COLLAB-023~026에 참고·수정·검증·배포 이력 기록.

2026-09-23 CareNote SaaS 랜딩 최종 로컬 게이트: **PASSED · 1.0.2**. 같은 담당의 FIX ROUND 1과 마지막 제목 줄바꿈 조정 후 감독 화면 검토 및 독립 정적 재검토 통과. 전체 Vitest428, Python155, 전체 E2E81 통과; 마지막 랜딩 제목 변경 후 Vitest428와 CareNote/랜딩 E2E13 재실행 통과. Next build·ESLint·TypeScript·하네스 통과. CTA 대비 RED 1.151:1 → 기본/hover 4.5:1 이상 GREEN. 자세한 실행 범위는 `docs/verification/2026-09-23-carenote-saas-landing.md`. 아래 IN_PROGRESS는 착수 이력이다.

2026-09-23 CareNote SaaS 랜딩 리디자인: **IN_PROGRESS**. 사용자 요청과 기존 자율 진행 범위에 따라 공식 Linear/Ramp/Heidi의 실제 화면을 확인하고 UI/UX Pro·frontend-design을 적용했다. Figma node 39:3 MCP 재확인. 프런트엔드 담당 `/root/carenote_landing`이 하네스 1.2.0 및 LandingPage 3파일 소유권을 수용했다. 감독은 별도 `e2e/carenote-landing.spec.ts`와 문서를 소유하며 키보드 탭 검사 RED를 확인했다. 제품 로직·API·환자 데이터·저장 정책은 비범위. 결정 근거: `docs/decisions/2026-09-23-carenote-saas-landing.md`. 협업 기록은 지정 Notion COLLAB-023부터 이어간다.

2026-09-14 첫 방문 안내: PASSED. frontend Luna Max (`/root/onboarding_ui`) HARNESS_ACK 1.2.0 및 소유 파일/비범위 수용 확인. 계획: `docs/superpowers/plans/2026-09-14-onboarding.md`. 기존 격리 worktree에서 `codex/0.10.0-onboarding` 브랜치 생성, 기준 탭 테스트 11/11 통과 후 단계별 구현·감독 검증. Figma 신규 MCP 조회는 Starter 호출 한도; 기존 node 39:3 검토 기록과 승인된 토큰 재사용. 중간 화면과 독립 리뷰에서 발견한 스크롤·가림 문제는 수정 및 재검토를 거쳤고, 사용자 재개 승인 후 최종 게이트 통과.

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
| 2026-08-28 | E2E·반응형 시각 QA 및 Vercel 준비 게이트 | frontend (Luna Max) + supervisor | 1.2.0 | PASSED | `e2e/`, Playwright/Vitest 설정, UI 요청 상태, CI·README·`0.5.0` | 독립 review Critical/Important 0; 최종 Python 60/60·frontend 51/51·로컬/Production E2E 각 9/9·lint·build·harness 통과; 1440·1024·390px overflow 0 | 2 | 첫 Production의 API 404를 명시적 `/api/:path*` rewrite와 회귀 테스트로 수정. Preview 검증 후 사용자 승인으로 Production 승격 완료 |
| 2026-08-28 | 인수인계 Assistant 기획·근거 조사·산출물 패키지 | supervisor | 1.2.0 | PASSED | Notion 리서치 허브, 9쪽 DOCX/Google Docs 기획서, Figma 메인·예외상태 화면 | Google Docs native 변환 및 PDF 9쪽 전 페이지 렌더 검토; DOCX 접근성 0건·표 geometry·제목선 검사 통과; Figma 1440×1024 메인 화면과 상태 보드 screenshot·metadata 검증 | 2 | 두 번째 Notion의 AI 차팅 코파일럿은 병렬 별도 모듈로만 기록. 시간·금액은 외부 근거, MVP 목표, 병동 시나리오 가정을 분리하고 직접 현금절감이 아닌 기회가치로 표기 |
| 2026-08-28 | 임상형 약물 요약·AI 우선 요청·작업 화면 카피 정리 | core-logic + frontend (Luna Max), supervisor | 1.2.0 | PASSED | 약물 SBAR 표현, OpenAI 검증 문법, API 요청 모드, 요약 출처·경고 표시, demo fixture, 헤더·빈 상태·요약 패널, E2E | 핵심 로직 독립 재검토 Critical/Important 0; 화면 독립 검토 Critical/Important/Minor 0; supervisor Python 55/55·Vitest 48/48·E2E 8/8·lint·build·harness·1440/390 시각 QA 통과 | 1 | 실 `.env` 호출은 HTTP 200·근거 9/9를 유지한 `AI_FALLBACK_USED`; provider 크레딧 확보 전까지 성공 AI 문장화는 외부 미검증. 범위 고지는 UI가 아닌 README·제품 문서에 유지 |
| 2026-08-28 | 교대 시간·SBAR 근거 레일 임상형 정리 | core-logic + frontend (Luna Max), supervisor | 1.2.0 | PASSED | compact Situation 시간, 접이식 근거 트레이, 반복 근거 선택 포커스, demo·단위·E2E 회귀 테스트 | 핵심 로직·화면 독립 재검토 Critical/Important 0; supervisor Python 59/59·Vitest 51/51·E2E 9/9·lint·build·harness 통과; 1440/1024/390 시각·overflow 확인 | 1 | 전체 근거 ID는 접근성 이름·툴팁·원문 카드에 유지. provider 호출 없이 deterministic 경로만 검증; 근거 순번의 섹션별 재시작과 추가 keyboard/multi-item 자동화는 비차단 후속 |
| 2026-08-28 | Vercel Preview·Production 배포 | supervisor | 1.2.0 | PASSED | Vercel 프로젝트 연결, API catch-all rewrite, Preview/Production smoke, `0.5.0` 문서·버전 | Preview·Production `/`·`/api/health` 200; 가상 기록 compare `ready`·변화 1·근거 1; Production Playwright 9/9; 공개 화면 clientWidth=scrollWidth=1265 | 1 | 공개 주소 `https://nurse-handover-assistant.vercel.app`; OpenAI 키는 Vercel에 등록하지 않아 규칙 요약 fallback으로 동작 |
| 2026-08-28 | 가상 원본 기록 조회·입력 샌드박스 | frontend (Luna Max) + supervisor | 1.2.0 | PASSED | 세션 기록 경계, 차트 장부형 드로어, 구조화 입력, 성공 시 비교 결과 교체, `0.6.0` 문서·Vercel 배포 | 독립 최종 review Critical 0; 발견된 Important 요청 경쟁·세션 검증·변화 카드 테스트를 수정하고 pending 실패 경로까지 재검토·보완. supervisor Python 60/60·Vitest 71/71·로컬·Production E2E 각 10/10·lint·typecheck·build·harness·diff-check 통과; Production root 200·health ok·P001 ready/변화 12/근거 12; 1440/1024/390 overflow 0·scroll lock·focus 확인 | 4 | 공개 주소 `https://nurse-handover-assistant.vercel.app`; 자동·수동 요청 세대 가드, strict ISO 시각, stable row, KST 왕복, hydration, modal focus 적용; 실제 환자정보·영구 DB·새 임상 규칙 비범위 |
| 2026-08-31 | Figma 기반 통합 임상 워크벤치 재설계 | frontend (Luna Max) + supervisor | 1.2.0 | PASSED | 전역 임상 헤더, 담당 환자 레일, 비교·원본 기록 중앙 모듈, 인계 검토 레일, 960–1440/390 반응형 | 기능·시각 작업별 독립 review 및 수정 재검토 완료; supervisor harness·Python 60/60·Vitest 86/86·로컬·Production Playwright 각 19/19·lint·typecheck·build·diff-check 통과; Preview health ok·P001 ready/변화 9/근거 9; Production root 200·health ok·P001 ready/9/9; 1440/960/390 공개 화면 overflow 0 | 3 | PR #2 병합, 공개 주소 `https://nurse-handover-assistant.vercel.app`; 임상·API 계약 변경 없음. 960px 레일 침범·비교 시각 clipping·원본 기록 요청 중 검토 상태 경쟁을 회귀 테스트로 보완; CSS dead override 정리는 후속 비차단 항목 |
| 2026-08-31 | 중앙 밀도·근거 가독성 개선 | frontend (Luna Max) + supervisor | 1.2.0 | PASSED | 환자 컨텍스트 간격·ID 배치, 근거 링크·상세·SBAR 글자와 조작 높이, 5개 viewport 회귀 테스트 | TDD baseline 8건 실패 확인 후 구현; 독립 review의 신규 색상·overflow 범위·높이 여유 문제를 1회 수정. supervisor harness·Python 60/60·Vitest 86/86·Playwright 27/27·lint·typecheck·build·diff-check 통과; 1440/1279/1024 컨텍스트 137.8px, 5개 폭 근거 11px/24px·overflow 0 확인 | 1 | 임상 데이터·비교 로직·API·세션 경계는 변경하지 않음. 960px 2행 요약과 390px 모바일 스택 유지 |
| 2026-08-31 | 2544px 와이드 화면 임상 가독성 개선 | frontend (Luna Max) + supervisor | 1.2.0 | PASSED | 1600px 이상 전용 레일 기하, 역할별 타이포그래피, 근거 조작 높이, 2544px 계산 스타일 회귀 테스트, `0.7.2` | 기존 268px 레일로 RED 후 구현 GREEN; 독립 review Critical/Important/Minor 0. supervisor harness·Python 60/60·Vitest 86/86·Playwright 28/28·lint·typecheck·build·diff-check 통과; 2544px에서 좌/우 304/400px, 환자 15px, 변화 17px, 요약·근거 13px, 근거 컨트롤 30px·overflow 0 직접 확인 | 0 | `>=1600px`에서만 적용하며 1440 이하 디자인·기능·임상 데이터·비교 로직·API·세션 경계는 변경하지 않음 |
| 2026-09-01 | 휴무 복귀 다중 시점 인수인계 | core-logic + frontend (Luna Max), supervisor | 1.2.0 | PASSED | 5×8 가상 타임라인, 기간 비교·AI fallback·FastAPI, 복귀 모드·원본 근거·검토 세션, 반응형 E2E, `0.8.0` | 각 단계 독립 review와 수정 재검토 완료; supervisor Python 112/112·Vitest 171/171·Playwright 42/42·lint·typecheck·build·harness·diff-check 통과; P001 기간 사건 24건·근거 24/24, 불완전 투약 partial, 편집 중 근거 snapshot, 7개 viewport와 pair-mode 회귀 확인; main CI·Production root/health·pair 9/9·period 24/24·실제 근거 이동 통과 | 6 | PR #7·main `c7a6600`; 공개 주소 `https://nurse-handover-assistant.vercel.app`. 실제 EMR·근무표·인증·공유 영속 저장은 비범위. OpenAI 성공 문장화는 provider 크레딧 문제로 실 API 미검증이며 deterministic fallback 유지 |
| 2026-09-01 | 복귀 인계 임상 계층 강화 | frontend (Luna Max) + supervisor | 1.2.0 | PASSED | 네 검토 그룹의 clinical-priority spine·tone 표면·제목 위계, 사건 현재 값·근거 조작, 우측 SBAR 독립 블록, `0.8.1` | TDD RED 2건 후 focused 20/20; supervisor Python 112/112·Vitest 173/173·Playwright 43/43·lint·typecheck·build·harness·diff-check 통과; 390–2544px overflow 0, 1440px 화면 직접 검토; 독립 review Critical/Important/Minor 0; main CI·Production root/health·pair 9/9·period 24/24·공개 화면 계층 8/8 통과 | 0 | PR #9·main `afb894a`; 공개 주소 `https://nurse-handover-assistant.vercel.app`. 기능·데이터·사건 순서·API·세션 경계 변경 없음. 초기 Playwright 기본 3000 포트 정체는 격리 포트로 재검증해 해소 |
| 2026-09-02 | 복귀 간호사 Shift Readiness 제품 설계 | supervisor | 1.2.0 | PASSED | 현직자 피드백을 반영한 Task First 근무 준비 보드, 5개 도메인, 별도 deterministic API·세션 확인·원본 추적·안전 경계 명세와 구현 계획 | 사용자에게 아키텍처·데이터 계약·화면 흐름·오류/테스트·서면 명세를 단계별 승인받음; 기준선 harness 통과·Python 112/112·Vitest 173/173; placeholder·모호성·범위·diff 자체 검토; Luna Max 독립 계획 review 1차 Important 10건·재감사 6건 수정 후 최종 Critical/Important 0 PASS | 0 | 단일 비공식 인터뷰는 정성 가설로만 사용; 기존 record 계약 보존을 위해 timestamp sidecar→API 논리 snapshot 병합으로 저장 경계 구체화 |
| 2026-09-02 | Shift Readiness 0.9.0 구현·검증 | core-logic + frontend (Luna Max), supervisor | 1.2.0 | PASSED | 5명 sidecar, 9개 deterministic 규칙·별도 API, TS 계약·세션 상태, 5도메인 보드, 기존 workbench·원본 근거 통합, 반응형 E2E, 릴리스 문서 | 최종 Python 155/155·Vitest 274/274·Playwright 64/64, lint·typecheck·build·py_compile·harness·diff-check 통과; P001 16항목·5도메인·근거 100%; 독립 최종 재리뷰 Critical/Important/Minor 0 | 7 | 최종 리뷰의 유효 Important 2건(no_items 진행 의미, timestamp parser parity) 수정. 근거 포커스·API 422/500 후보는 binding 테스트/계약으로 기각. 실제 EMR·영속 공유·임상 판단은 비범위 |

## 0.9.0 Shift Readiness 단계별 하네스 기록

모든 구현 작업은 `HARNESS_ACK: 1.2.0`과 역할·소유 파일·비범위를 확인한 뒤 통합했다. 하네스 응답이 누락된 Task 3과 Task 8 timestamp 수정은 takeover 에이전트가 기존 diff를 감사하고 binding ACK를 제출한 뒤 감독자가 검증했다.

| Task | 역할·소유 범위 | TDD·감독 검증 | 독립 검토·수정 |
|---:|---|---|---|
| 1 | core-logic · `data/shift-readiness/P001–P005.json`, fixture test | missing sidecar RED 11건 → focused 11/11, Python 123/123 | 수정 0, 승인 |
| 2 | core-logic · projector/API와 관련 Python test | 초기 focused 21/21; 보완 후 31/31, Python 154/154 | medication period source·부분 상태·4상태 계약 수정 1회, 승인 |
| 3 | frontend · TS adapter/contracts/client와 test | focused 27/27, Vitest 200/200 | takeover ACK, Critical/Important 0 |
| 4 | frontend · fetch/cache/review hook 4파일 | 보완 RED 5건 → focused 20/20, Vitest 220/220 | exact-key cache·review key·identity 수정 1회, 승인 |
| 5 | frontend · Shift Readiness board/summary presentational 4파일 | missing module RED → focused 24/24, Vitest 244/244 | item focus·null progress·live region 수정 1회, 승인 |
| 6 | frontend · workbench/queue/evidence 통합 7파일 | 보완 RED 6건 → focused 119/119, Vitest 274/274 | queue sort·cross-key state·field path·read-only/focus 수정 1회, 이중 리뷰 승인 |
| 7 | frontend · `globals.css`, Playwright E2E | focused 21/21, full 64/64; 2544·1440·1024·960·390 직접 화면 검토 | 모바일 순서·요청/근거/상태/접근성·occlusion 수정 2회, 승인 |
| 8 | supervisor + scoped takeover · 최종 계약/문서/배포 | UI RED 1 → 9/9; timestamp RED → Python focused 20/20; 최종 Python 155/155·Vitest 274/274·Playwright 64/64 | 유효 Important 2건 수정 1회, 최종 Critical/Important/Minor 0 승인 |

Figma checkpoint는 Task 5 전에 node `39:3`의 디자인 토큰·임상 제품 맥락만 재확인했다. 화면 구성은 승인된 Task First 5도메인 흐름을 따랐고 Figma 원본의 차팅 구성은 복제하지 않았다.

## 마일스톤 게이트

| 마일스톤 | 목표 버전 | 상태 | 감독 검증 기준 |
|---|---:|---|---|
| 현재 MVP 기준선 검증 | `0.3.0` | PLANNED | 기존 기능 실행, 핵심 흐름 smoke test, 알려진 한계 기록 |
| 구조화된 차이 비교 | `0.4.0` | PLANNED | 단위 테스트, 누락·오탐 사례 검증, UI 계약 고정 |
| Figma 기반 UI 통합 | `0.5.0` | PASSED | MCP 설계 대조, 주요 화면 시각 검증, 상태별 UI 확인 |
| 통합 임상 워크벤치 | `0.7.0` | PASSED | 중앙 모듈 전환, 3레일 기하, 원본 기록 성공·실패 경계, 390·960·1024·1279·1440 회귀 검증 |
| 휴무 복귀 인계 | `0.8.0` | PASSED | 5×8 기간 데이터, 인접 변화·생명주기 보존, 근거 100%, pair-mode 회귀, 390–2544px·배포 검증 |
| Shift Readiness 근무 준비 보드 | `0.9.0` | PASSED | 5개 업무 도메인, 근거 100%, 사실·확인 상태 분리, no-items/오류 구분, 기존 비교 회귀, 390–2544px 검증 |
| 근거 제한 AI 요약 | `0.6.0` | PLANNED | 오프라인 fallback, API 통합 테스트, 환각·누락 평가 |
| 포트폴리오 안정판 | `1.0.0` | PLANNED | 전체 시연 시나리오, 회귀 테스트, 문서·영상 준비 |

## 기록 규칙

1. 작업을 위임하기 전에 행을 추가하고 `PLANNED`로 표시한다.
2. 에이전트가 하네스를 수용하면 `IN_PROGRESS`로 변경한다.
3. 감독 검증을 시작하면 `REVIEW`로 변경하고 검증 근거를 기록한다.
4. 수정 요청마다 수정 라운드를 1씩 증가시킨다.
5. 두 번째 검증에서도 중대한 문제가 남으면 `BLOCKED`로 표시하고 사용자에게 보고한다.
6. 검증을 통과한 작업만 `PASSED`로 표시하고 버전 변경 후보가 된다.
