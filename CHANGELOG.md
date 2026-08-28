# Changelog

이 프로젝트는 Semantic Versioning을 사용한다.

## [Unreleased]

### Changed

- 약물 변화 SBAR를 직렬화된 JSON 대신 `약명 · 경로 · 빈도` 임상형 표현으로 변경
- 화면 비교 요청이 서버의 근거 제한 AI 문장화를 기본 시도하도록 변경하고, 결과 출처를 `AI 요약`/`규칙 요약`으로 표시
- AI 키 부재·provider 실패 경고 코드를 사용자용 한국어 대체 안내로 변환
- 임상 작업 화면에서 병동·교대 맥락 배지와 포트폴리오 면책 문구를 제거하고 범위 고지는 README·제품 문서에 유지

### Verification

- Python unittest 55/55, frontend Vitest 48/48, Playwright 8/8 통과
- ESLint, Next production build, harness 통과; 1440×900·390×844 브라우저 시각 검증 완료
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
