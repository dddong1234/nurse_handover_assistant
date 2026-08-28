# Changelog

이 프로젝트는 Semantic Versioning을 사용한다.

## [Unreleased]

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
