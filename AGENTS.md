# Nurse Handover Assistant Agent Harness

- Harness-Version: `1.2.0`
- Last-Updated: `2026-08-27`
- Project-Version-Source: `VERSION`
- Applies-To: 이 저장소에서 작업하는 모든 에이전트

## 프로젝트 목적

이 프로젝트는 기획과 바이브코딩을 통한 제품 설계·구현 능력을 보여주는 포트폴리오이다.

우선순위:

1. 실제 간호 업무를 연상시키는 완성도 높은 UI
2. 환자 기록의 차이 비교 정확성
3. 검출 결과의 근거 기반 요약과 가독성
4. 시연 가능성과 검증 가능성

현재 범위는 가상 데이터 기반 프로토타입이다. 실제 운영 EMR, 실제 환자정보, EMR 쓰기 연동, 의료적 판단 자동화는 사용자 승인 없이 추가하지 않는다.

## 지시 우선순위

1. 사용자의 최신 명시적 지시
2. 사용자가 승인한 설계와 범위
3. 이 `AGENTS.md`와 현재 파일 경로에 적용되는 하위 `AGENTS.md`
4. 담당 에이전트의 개별 작업 지시
5. 기존 코드 관례

임상 의미, 사용자 경험 또는 승인 범위가 달라지는 충돌은 스스로 결정하지 말고 감독 에이전트에게 보고한다.

## 절대 원칙

- 임상 사실과 변화 검출은 deterministic 로직이 담당한다.
- LLM은 검출된 사실의 문장화, 구조화된 질문 해석, 결과 설명에만 사용한다.
- 모든 요약은 원본 변화로 추적 가능해야 한다.
- Figma MCP 검토 전에는 시각 디자인을 임의로 확정하거나 구현하지 않는다.
- 실제 환자정보를 저장소, 프롬프트, 로그, 테스트에 사용하지 않는다.
- `.env`와 API 키 값을 출력, 복사, 문서화, 커밋하지 않는다.
- 무관한 리팩터링, 기능 확대, 대규모 파일 이동을 하지 않는다.
- 사용자 소유의 미추적·무관한 파일을 수정하거나 커밋하지 않는다.

## 역할과 파일 소유권

### 감독 에이전트

- 설계, 인터페이스, 작업 범위, 통합과 품질 게이트를 관리한다.
- `AGENTS.md`, `VERSION`, `CHANGELOG.md`, `docs/`, 공통 설정과 의존성은 감독 에이전트만 수정한다.
- 검증을 통과한 변경만 다음 단계와 버전 반영 후보로 인정한다.

### 프런트엔드 에이전트

- 모델: `gpt-5.6-luna`, 추론 수준: `max`
- 기준 소스: 감독 에이전트가 MCP로 확인한 Figma
- 소유 범위: `app.py`와 작업 지시에서 명시한 UI 전용 파일
- 서비스 로직, 임상 데이터 의미, 로직 테스트를 변경하지 않는다.

### 핵심 로직 에이전트

- 모델: `gpt-5.6-luna`, 추론 수준: `max`
- 소유 범위: 작업 지시에서 명시한 `services/` 파일과 관련 테스트
- UI 구성, 스타일, 승인되지 않은 스키마를 변경하지 않는다.
- `services/AGENTS.md`를 추가로 따른다.

같은 파일을 두 에이전트가 수정해야 하면 병렬 작업을 중단하고 감독 에이전트가 계약 또는 작업 순서를 조정한다.

## 작업 계약

모든 서브에이전트 지시는 다음을 포함한다.

- 적용할 `Harness-Version`
- 한 문장 목표
- 수정 가능 파일과 수정 금지 파일
- 입력·출력 인터페이스
- 완료 조건과 검증 명령
- 중단·보고 조건

작업 시작 응답:

```text
HARNESS_ACK: 1.2.0
ROLE: <frontend|core-logic>
OWNED_FILES: <paths>
OUT_OF_SCOPE: <summary>
```

완료 응답:

```text
HARNESS_VERSION:
SCOPE_COMPLETED:
FILES_CHANGED:
TESTS_RUN:
TEST_RESULTS:
KNOWN_LIMITATIONS:
OUT_OF_SCOPE_CONFIRMED:
```

하네스 수용 정보가 없거나 작업 지시와 다르면 결과를 통합하지 않는다. 실행하지 못한 테스트를 통과했다고 표현하지 않는다.

## 품질 게이트

1. 담당 에이전트 구현과 자체 검증
2. 감독 에이전트 코드 리뷰
3. 감독 에이전트 테스트 또는 화면 검증
4. 통과 시 다음 큰 단계 진행
5. 실패 시 같은 담당 에이전트에 수정 지시
6. 수정 후에도 중대한 문제가 남으면 중단하고 사용자에게 보고

감독 검증 전에는 다음 큰 기능을 시작하지 않는다. 상태와 근거는 `docs/AGENT_WORKLOG.md`에 기록한다.

## 자동 검사

작업 완료 전 다음 명령을 실행한다.

```powershell
python scripts/check_harness.py --root .
python -m unittest discover -s tests -v
```

로컬 `python` 명령이 없으면 사용 가능한 명시적 Python 실행 경로를 사용하고 그 경로를 결과에 기록한다. 자동 검사의 세부 목적은 `docs/HARNESS.md`를 따른다.

## API와 보안

- OpenAI 테스트는 로컬 `.env`의 `OPENAI_API_KEY`를 환경 변수로만 읽는다.
- 외부 API payload는 가상 환자의 최소 변화 데이터로 제한한다.
- API 실패, 키 부재, timeout, 잘못된 구조화 출력에 deterministic fallback을 제공한다.
- 외부 API 테스트는 오프라인 테스트와 분리해 표시한다.

## 배포 제약

- 최종 포트폴리오 배포 대상은 Vercel이다.
- 권장 구조는 Figma 기반 Next.js 프런트엔드와 Python FastAPI Vercel Function이다.
- 현재 Streamlit 앱은 동작 기준선과 프로토타입 참고 구현으로 유지하고, Vercel 대상 UI로 간주하지 않는다.
- Vercel Function의 로컬 파일시스템에 영속 데이터를 기록하지 않는다.
- 1차 포트폴리오 배포의 환자 데이터는 번들된 가상 데이터 읽기와 브라우저 세션 상태로 제한한다.
- OpenAI 호출과 `OPENAI_API_KEY` 접근은 서버 함수에서만 수행한다.
- 영속 공유 데이터가 필요해지면 별도 저장소 도입을 설계·승인한 뒤 진행한다.
- 자세한 결정과 배포 단계는 `docs/decisions/002-vercel-deployment-target.md`와 `docs/conventions/deployment.md`를 따른다.

## 버전과 Git

- 프로젝트 버전은 `VERSION`의 SemVer 값을 단일 기준으로 사용한다.
- `VERSION`과 `CHANGELOG.md`는 품질 게이트 통과 시 함께 갱신한다.
- 서브에이전트는 branch, commit, tag, push, reset, checkout을 실행하지 않는다.
- 감독 에이전트가 검증된 변경의 Git 작업을 관리한다.
- 브랜치는 `codex/<milestone>-<topic>`, 커밋은 `feat:`, `fix:`, `test:`, `docs:`, `chore:` 접두사를 기본으로 한다.
- 상세 정책과 마일스톤은 `docs/conventions/agent-workflow.md`를 따른다.

## 지식 저장소

작업 전에 범위에 해당하는 문서를 읽는다.

- 하네스 설계와 근거: `docs/HARNESS.md`
- 기술 결정: `docs/decisions/`
- 작업·검증 기록: `docs/AGENT_WORKLOG.md`
- 개발 규칙: `docs/conventions/`
- 간호 인수인계 용어와 흐름: `docs/domain/`
- 실패와 재시도 금지 근거: `docs/failures/`

## 정리 규칙

- `temp_`, `_new`, `_old`, `_backup`, `_fix` 형태의 임시 파일을 남기지 않는다.
- 사용하지 않는 import, 디버그 코드, 임시 산출물은 작업 범위 안에서 정리한다.
- 자동으로 사용자 파일을 삭제하지 않는다. 센서가 감지한 드리프트는 감독 에이전트가 대상을 확인한 뒤 처리한다.
- 문서와 코드가 달라지면 같은 작업에서 문서를 갱신한다.
