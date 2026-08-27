# Changelog

이 프로젝트는 Semantic Versioning을 사용한다.

## [Unreleased]

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
