# Changelog

이 프로젝트는 Semantic Versioning을 사용한다.

## [Unreleased]

## [0.9.0] - 2026-09-02

### Added

- 휴무 복귀 간호사가 `환자 상태 → 검사·결과 → Line·Device → 투약 변경 → 보고·확인` 순서로 이번 근무 항목을 훑는 Task First Shift Readiness 보드
- P001–P005의 기존 8개 snapshot과 시각별로 결합되는 합성 검사·영상·Line·투약 유효기간·명시된 전달 요청 sidecar
- 기존 비교 API와 분리된 deterministic `/api/handover/shift-readiness`, 9개 규칙, `available`·`no_baseline`·`no_items`·`partial` 상태 계약
- 각 준비 항목에서 정확한 원본 snapshot·필드 또는 기간 사건으로 이동하는 100% source reference와 읽기 전용 operational source 보기
- 환자·복귀 시작·근무 구간·현재 기록 fingerprint별 세션 전용 `확인함`·수기 메모 상태

### Changed

- `휴무 복귀`의 기본 중앙 탭을 `근무 준비`로 전환하고 기존 `변화 근거` 24건·`원본 기록` 흐름은 그대로 보존
- 환자 큐와 우측 레일에 임상 완료가 아닌 항목별 검토 진행만 표시하며, `no_items`는 `0/0` 대신 `표시 항목 없음`으로 구분
- Python과 TypeScript의 Shift Readiness 시각 문법을 대문자 `Z`, `T` 구분자, offset 필수 규칙으로 일치
- Shift Readiness는 OpenAI 키와 무관하게 동작하고, LLM은 기존 pair/period 비교의 제한된 문장화 경계에만 유지

### Verification

- 최종 Python unittest 155/155, frontend Vitest 274/274, Playwright 64/64 통과
- ESLint, TypeScript no-emit, Next production build, harness, `git diff --check`, Python `py_compile` 통과
- P001 계약 프로브에서 준비 항목 16건, 5개 도메인, 모든 항목 정확히 한 그룹, source reference 100% 확인
- 390·960·1019·1024·1279·1440·1600·2544px에서 임상 본문·근거 판독성, rail containment, 모바일 정보 순서와 수평 overflow 없음 확인
- 독립 Luna Max 최종 리뷰에서 발견된 `no_items` 진행 표현과 Python/TypeScript timestamp parity를 수정하고 재리뷰 Critical/Important/Minor 0 승인

### Known limits

- 공개 데모는 합성 데이터이며 실제 EMR·근무표·사용자 인증·공유 저장소·EMR 쓰기와 연결되지 않는다.
- `사실 상태`와 `이번 근무 예정`은 기록된 상태·시각을 재구성한 것이며, 임상 우선순위·조치·보고 필요성을 새로 판단하지 않는다.
- `확인함`과 메모는 브라우저 탭의 `sessionStorage`에만 남고 완료·안전·시행을 뜻하지 않는다.
- OpenAI provider 크레딧 문제로 성공 AI 문장화는 실 API에서 미검증이지만 Shift Readiness와 deterministic 비교·근거는 API 키 없이 동작한다.

## [0.8.1] - 2026-09-01

### Changed

- 복귀 인계 중앙 영역을 `현재 확인`·`기간 중 변경`·`활력징후 추세`·`전체 타임라인`의 네 임상 검토 그룹으로 명확히 구분하고, 그룹 제목·사건 카드·현재 값·근거 조작의 3단계 시각 위계를 적용
- 기존 primary·watch·secondary 토큰과 제목·건수·좌측 임상 우선순위 선을 함께 사용해 색상만으로 의미를 전달하지 않도록 개선
- 우측 검토 레일의 Situation·Background·Assessment·Recommendation을 독립된 경계와 표면을 가진 블록으로 정리하면서 근거 펼치기·Recommendation 입력·원본 확인·검토 완료 흐름은 유지

### Verification

- TDD에서 그룹 tone hook과 SBAR block hook 부재로 focused Vitest 2건 RED를 확인한 뒤 20/20 GREEN
- 감독 재검증에서 Python unittest 112/112, frontend Vitest 173/173, Playwright 43/43 통과
- ESLint, TypeScript no-emit, Next production build, harness와 `git diff --check` 통과
- 2544·1600·1440·1279·1024·960·390px에서 기존 3레일 기하, 수평 overflow 없음, 그룹 표면 3종 이상, 그룹 제목이 사건 제목보다 최소 3px 큰 계약을 확인
- 1440px 전체 화면을 검토해 환자 레일 → 복귀 기간 → 네 검토 그룹 → SBAR 레일의 읽기 순서와 조밀한 타임라인 유지 확인
- 독립 Luna Max 리뷰에서 Critical/Important/Minor 0건, 병합 가능 판정
- PR #9 병합 후 main Harness checks와 Vercel Production 배포 통과; 공개 루트 200·health `ok`·기존 비교 `ready` 9/9·기간 비교 `ready` 24/24 확인
- Production 브라우저에서 2544·1600·1440·1279·1024·960·390px containment와 새 그룹·SBAR 계층 계약 8/8 통과

### Known limits

- 이번 변경은 가상 데이터 기반 복귀 인계 화면의 시각 위계만 다루며 임상 분류, 사건 순서, 요약 문구 생성, API·세션 경계는 변경하지 않는다.
- 전체 24건 사건을 한 화면에서 제공하므로 데스크톱에서도 페이지 길이는 길다. 정보 누락 없이 그룹과 조밀한 타임라인으로 탐색 부담만 낮춘 상태이다.
- OpenAI provider 크레딧 문제로 성공 AI 문장화는 실 API에서 미검증이며 deterministic 규칙 요약을 기본 안전 경로로 유지한다.

## [0.8.0] - 2026-09-01

### Added

- `직전 교대`와 분리된 `휴무 복귀` 인계 모드, 실제 가상 기록 시각을 사용하는 마지막 근무 선택기와 기간별 검토 세션
- P001–P005 각 8개 시점·최소 66시간, 총 40개 가상 snapshot으로 구성한 재현 가능한 복귀 인계 데이터 팩
- 모든 인접 snapshot의 변화를 보존하는 deterministic 기간 비교, `현재 반영`·`기간 중 변경`·활력징후 추세·기록 사건 분류와 `/api/handover/period-compare`
- 사건 ID와 원본 직전/현재 snapshot을 연결하는 정확한 근거 이동, 과거 기록 읽기 전용·최신 기록 편집 후 재비교 흐름
- 기간 비교의 키 부재·timeout·provider/검증 실패에 동일 사건·근거를 유지하는 제한적 AI 문장화와 규칙 요약 fallback

### Changed

- 기간·환자·최신 기록이 바뀔 때 성공 응답만 결과와 검토 세션을 교체하도록 요청 세대·캐시·실패 보존 경계를 확장
- 복귀 검토 레일에 기간 사건 수, 현재 확인 수, 기간 중 변경 수와 근거 포함률을 표시하고 기존 원본 확인·Recommendation·검토 완료 흐름을 재사용
- 390–2544px에서 사건 행·근거·3열 임상 워크벤치가 겹치거나 잘리지 않도록 반응형·접근성 계약을 확대

### Verification

- Python unittest 112/112, frontend Vitest 171/171, Playwright 42/42 통과
- ESLint, TypeScript no-emit, Next production build, harness와 `git diff --check` 통과
- P001 3일 복귀 시나리오에서 기간 사건 24건·요약 근거 24/24, 휴무 중 시작 후 현재 전에 종료된 생리식염주 사건과 이부프로펜 BID→TID→BID→TID 이력 확인
- 2544·1600·1440·1279·1024·960·390px에서 수평 가림, 근거 판독성, 모바일 단일 열과 키보드 탭·포커스 복귀를 Playwright로 검증
- 최종 독립 리뷰에서 확인한 불완전 투약 `partial` 계약과 편집 중 근거 snapshot 불일치를 회귀 테스트로 보완
- PR #7 병합 후 Production 루트 200·health `ok`·기존 비교 `ready` 9/9·기간 비교 `ready` 24/24와 클라이언트 키 비노출 확인
- Production 브라우저에서 P001 24/24, 생리식염주 근거의 `06/29 15:00 → 23:00` 원본 이동, 1440px overflow 0·콘솔 오류 0 확인

### Known limits

- 현재 데이터와 기록 편집은 가상 fixture와 브라우저 탭의 `sessionStorage`에만 존재하며 실제 EMR, 근무표, 사용자 인증, 공유 저장소와 연결되지 않는다.
- snapshot 사이 변화는 뒤쪽 기록 시각에 검출된 사실이며 실제 발생 시각이나 임상적 해결·악화·우선순위를 새로 판단하지 않는다.
- OpenAI provider 크레딧 문제로 성공 AI 문장화는 실 API에서 미검증이며, 배포 환경은 동일 사건·근거의 deterministic 규칙 요약을 기본 안전 경로로 유지한다.

## [0.7.2] - 2026-08-31

### Changed

- 1600px 이상 와이드 화면에서 환자 레일을 268px에서 304px로, 인계 검토 레일을 320px에서 400px로 확대해 각 영역의 정보 밀도와 판독 폭을 재균형화
- 와이드 화면의 메타데이터를 최소 11px, 본문·근거를 13px, 환자명·현재 값을 15px, 변화 제목을 17px, 주요 제목을 20px로 확대
- 근거 링크·펼치기 컨트롤을 13px/30px로 키우고 변화 행 여백을 보정해 원본 추적 정보가 중앙 여백에 묻히지 않도록 개선

### Verification

- TDD에서 기존 2544px 좌측 레일 268px 실패를 확인한 뒤 승인한 304px/400px 기하와 역할별 글자 크기 계약으로 전환
- Harness, Python unittest 60/60, frontend Vitest 86/86, Playwright 28/28 통과
- ESLint, TypeScript no-emit, Next production build와 `git diff --check` 통과
- 감독 브라우저에서 2544×1258의 환자명 15px·변화 제목 17px·요약/근거 13px·주요 제목 20px와 수평 overflow 없음 확인
- 1440px에서 기존 268px/320px 레일과 13px 환자명·14px 변화 제목·11px 근거를 유지하고 390px 모바일 수평 overflow 없음 확인
- 독립 Luna Max 리뷰에서 Critical/Important/Minor 0건 확인

### Known limits

- 와이드 가독성 모드는 1600px 이상에서만 적용하므로 더 작은 화면은 기존 고밀도 임상 레이아웃을 유지한다.
- OpenAI provider 크레딧 문제로 성공 AI 문장화는 실 API에서 미검증이며 규칙 요약 fallback을 유지한다.

## [0.7.1] - 2026-08-31

### Changed

- 데스크톱·태블릿 환자 컨텍스트 높이를 약 168px에서 137.8px로 줄이고 환자 ID를 이름 옆에 배치해 중앙 비교 영역의 불필요한 공백 축소
- 근거 링크와 SBAR 근거 펼치기 글자를 8px에서 11px로, 조작 높이를 약 15px에서 24px로 확대
- 근거 ID·상세를 10px, SBAR 핵심 문장을 11px로 조정해 원본 추적 정보의 판독성 강화

### Verification

- Harness, Python unittest 60/60, frontend Vitest 86/86, Playwright 27/27 통과
- ESLint, TypeScript no-emit, Next production build와 `git diff --check` 통과
- 감독 브라우저에서 1440·1279·1024px 환자 컨텍스트 137.8px, 960px 2행 요약과 390px 모바일 스택 유지 확인
- 1440·1279·1024·960·390px에서 근거 링크·펼치기 11px/24px 및 펼친 전후 수평 overflow 0 확인
- 구현 독립 리뷰와 수정 재검토에서 Critical/Important 0건 확인

### Known limits

- 960px 이하에서는 비교 시각과 통계를 읽기 위해 환자 컨텍스트가 반응형으로 여러 행을 사용하므로 높이 축소 상한을 적용하지 않는다.
- OpenAI provider 크레딧 문제로 성공 AI 문장화는 실 API에서 미검증이며 규칙 요약 fallback을 유지한다.

## [0.7.0] - 2026-08-31

### Added

- `NURSE HANDOVER · SHIFT REVIEW` 전역 임상 헤더와 담당 환자·중앙 작업·인계 검토가 이어지는 단일 워크벤치
- 중앙의 `인수인계 비교`·`원본 기록` 접근성 탭과 Arrow/Home/End 키보드 이동
- 960·1024·1279·1440px 기하, 중앙 자손 overflow, 390px 구조화 입력을 고정하는 Playwright 회귀 테스트

### Changed

- 원본 기록 modal drawer를 선택 환자와 인계 검토 맥락이 유지되는 인라인 중앙 모듈로 전환
- 환자 큐, 환자 컨텍스트, Shift Seam 변화 행과 SBAR 검토 레일을 Figma 기반 고밀도·평면형 임상 UI로 통합
- 환자 변경과 근거 이동은 비교 모듈로 복귀하고, 편집 비교는 성공 시에만 비교 모듈·결과·세션을 교체하며 실패 시 원본 기록과 draft를 유지
- 960–1019px에서 비교 구간 시각과 변화 통계가 잘리거나 우측 검토 레일 아래로 침범하지 않도록 두 줄 요약 레이아웃 적용

### Verification

- Harness 통과, Python unittest 60/60, frontend Vitest 86/86, 로컬 Playwright 19/19 통과
- 원본 기록 재비교·초기화 요청 중 근거 선택, 추천 편집, 원본 확인, 검토 완료를 하나의 pending 경계로 잠그는 회귀 테스트 추가
- ESLint, TypeScript no-emit, Next production build와 `git diff --check` 통과
- 감독 브라우저에서 1440×900·1024×768·960×768·390×844 시각 검증, 콘솔 오류 0건 확인
- 960px에서 중앙/context scrollWidth=clientWidth, 변화 통계 레일 침범 0건, 두 비교 시각 각각 64/64px 확인
- 기능·시각 작업별 독립 Luna Max 리뷰와 수정 라운드 재검토에서 Critical/Important 0건 확인
- PR #2 checks 통과 후 `main` 병합; Vercel Preview `/api/health` `ok`, 가상 P001 비교 `ready`·변화 9·근거 9 확인
- Production `https://nurse-handover-assistant.vercel.app` 루트 200·health `ok`·P001 `ready`/9/9, 공개 Playwright 19/19 및 1440·960·390 수평 overflow 0 확인

### Known limits

- 적용 기록은 현재 브라우저 탭의 `sessionStorage`에만 유지되며 실제 EMR·다중 사용자·서버 영구 저장과 연결되지 않는다.
- OpenAI provider 크레딧 문제로 성공 AI 문장화는 실 API에서 미검증이며 규칙 요약 fallback을 유지한다.
- 전역 CSS에는 기존 화면 규칙 위의 0.7 override 계층이 남아 있어 후속 마일스톤에서 dead rule 정리가 필요하다.

## [0.6.0] - 2026-08-28

### Added

- 선택 환자의 이전·현재 가상 원본 차트를 EMR 장부형 사이드 시트에서 조회하는 화면
- 활력징후·진단·투약·간호기록·기록시각을 구조화 입력하고 기존 비교 API를 다시 실행하는 시연 흐름
- 적용된 현재 기록을 환자별 `sessionStorage`에 보관하고 잘못된 세션 값은 무시하는 검증 경계
- 원본 차트 드로어, 비교 성공·실패·초기화, 세션 복원과 반응형 동작의 Vitest·Playwright 회귀 테스트

### Changed

- 입력 기록은 비교 API 성공 후에만 결과·검토 세션·브라우저 세션 상태에 함께 반영하도록 트랜잭션 경계를 강화
- 데모 초기화도 번들 원본 기록 비교가 성공한 뒤에만 적용하며 실패 시 기존 검토 결과와 열린 입력값을 보존
- 드로어가 열릴 때 내부 닫기 버튼으로 포커스를 옮기고 닫힌 뒤 원래 `원본 기록` 버튼으로 복귀

### Verification

- Python unittest 60/60, frontend Vitest 71/71, Playwright 10/10 통과
- ESLint, TypeScript no-emit, Next production build, harness, `git diff --check` 통과
- supervisor 브라우저 검증에서 1440×900·1024×768·390×844 드로어 폭, 수평 overflow 0, 본문 scroll lock, 진입·복귀 focus 확인
- 독립 최종 리뷰가 찾은 요청 경쟁·세션 검증·테스트 정합 문제와 후속 pending 해제 경로를 네 차례 수정 라운드에서 해소
- Vercel Production `/`·`/api/health`·가상 P001 비교 smoke와 공개 환경 Playwright 10/10 통과

### Known limits

- 기록은 현재 브라우저 탭 세션에만 유지되며 다른 사용자·기기와 공유되지 않는다.
- 실제 환자정보·운영 EMR 쓰기·서버 영구 저장은 지원하지 않는다.
- OpenAI provider 크레딧 문제로 성공 AI 문장화는 실 API에서 미검증이며 규칙 요약 fallback을 유지한다.

## [0.5.0] - 2026-08-28

### Added

- 공개 포트폴리오 앱을 `https://nurse-handover-assistant.vercel.app`에 배포
- `/api/:path*` 요청을 단일 FastAPI Function으로 전달하는 명시적 Vercel rewrite와 배포 계약 테스트 추가

### Changed

- 약물 변화 SBAR를 직렬화된 JSON 대신 `약명 · 경로 · 빈도` 임상형 표현으로 변경
- 화면 비교 요청이 서버의 근거 제한 AI 문장화를 기본 시도하도록 변경하고, 결과 출처를 `AI 요약`/`규칙 요약`으로 표시
- AI 키 부재·provider 실패 경고 코드를 사용자용 한국어 대체 안내로 변환
- 임상 작업 화면에서 병동·교대 맥락 배지와 포트폴리오 면책 문구를 제거하고 범위 고지는 README·제품 문서에 유지
- Situation의 원시 ISO 구간을 당일 `MM/DD HH:mm → HH:mm`, 날짜 변경 시 양쪽 날짜를 표시하는 임상형 시간으로 축약
- SBAR 근거 ID를 기본 접힘 상태의 `근거 N건` 영역으로 이동하고, 짧은 순번 링크·전체 접근성 이름·원문 카드 재포커스를 유지

### Verification

- Python unittest 60/60, frontend Vitest 51/51, 로컬·Production Playwright 각각 9/9 통과
- ESLint, Next production build, harness 통과; Production 1440×900·1024×768·390×844 브라우저 시각·수평 overflow 검증 완료
- Vercel Preview와 Production에서 `/` 200, `/api/health` 200, `/api/handover/compare`의 `ready`·변화 1건·근거 1건 deterministic 응답 확인
- `.env` 실 API smoke는 HTTP 200과 근거 9/9를 유지한 `AI_FALLBACK_USED`를 확인

### Known limits

- OpenAI provider 크레딧 부족으로 성공 AI 문장화는 아직 실 API에서 검증하지 못했으며, 화면은 규칙 요약으로 안전하게 대체된다.

## [0.5.0-dev.0] - 2026-08-28

### Added

- Next.js 기반 3영역 간호 인수인계 작업공간과 반응형 390·1024·1440px 레이아웃
- 이전·현재 값, 우선순위, 원본 필드와 evidence ID를 포함하는 구조화 비교 화면
- 근거 연결 SBAR, 근거 focus, 간호사 직접 Recommendation, 원본 확인 후 검토 잠금
- 서버 전용 OpenAI Responses API 문장화와 엄격한 deterministic fallback
- P001 핵심 시연 흐름과 fallback·검토·반응형을 검증하는 Playwright E2E

### Changed

- README와 CI를 Next.js + FastAPI + Vercel Preview 목표 구조로 갱신
- Vitest 범위를 `src/**/*.test.{ts,tsx}`로 고정해 Playwright 명세와 테스트 실행기를 분리
- 요청 cleanup 뒤 stale pending 상태가 복원되던 ref 동기화를 제거

### Verification

- Python unittest 45/45, frontend Vitest 45/45, Playwright 7/7 통과
- ESLint, Next production build, Python compile, harness, `git diff --check` 통과
- 1440px·390px 브라우저 시각 검증과 수평 overflow 0 확인

### Known limits

- Vercel 프로젝트 연결과 실제 Preview의 `/`, `/api/health`, `/api/handover/compare` 검증 전이므로 최종 `0.5.0`은 미확정
- OpenAI live smoke는 provider의 `credit_balance_exhausted`로 deterministic fallback만 검증됨

## [0.3.0-dev.2] - 2026-08-27

### Added

- Vercel 배포 목표와 Next.js + FastAPI 권장 구조 ADR
- Preview·Production 환경, 환경변수와 배포 게이트 관례

### Changed

- 로컬 JSON 쓰기를 배포 영속 저장으로 사용하지 않도록 하네스 강화
- Streamlit을 기준선 구현으로 유지하고 Figma 기반 Next.js를 최종 UI 대상으로 지정

## [0.3.0-dev.1] - 2026-08-27

### Added

- 루트와 디렉터리별 에이전트 하네스
- 아키텍처·문서·버전·구조 드리프트 자동 검사
- 자동 센서의 회귀 테스트와 GitHub Actions 피드백 루프
- ADR, 개발 관례, 도메인 지식, 실패 기록과 작업 감사 문서

### Changed

- 프로젝트 버전과 하네스 버전을 분리해 관리
- 구현 에이전트의 파일 소유권, 완료 보고, 검증과 수정 절차를 명시

## [0.3.0-dev.0] - 2026-08-27

### Baseline

- Streamlit 기반 환자 입력, 환자 목록, 인수인계, 질의 조회 MVP
- JSON 기반 환자 최신본 및 history snapshot 저장
- 활력징후, 투약, 진단, 메모의 deterministic 변화 감지
- 규칙 기반 자연어 질의 조회
