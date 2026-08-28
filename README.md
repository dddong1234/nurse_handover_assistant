# Nurse Handover Assistant

가상 환자의 이전·현재 기록을 비교해 변화와 근거를 연결하고, 간호사가 SBAR 초안을 검토하도록 돕는 포트폴리오 프로토타입입니다.

핵심은 세 가지입니다.

- deterministic 비교 엔진이 활력징후·투약·진단·간호 메모의 변화를 검출합니다.
- 모든 요약 항목은 원본 변화 ID와 이전·현재 값으로 되돌아갈 수 있습니다.
- LLM은 검출된 사실의 제한된 문장화에만 사용하며, 키 부재·provider 실패·검증 실패 시 deterministic 요약으로 돌아갑니다.

실제 EMR이나 의료기기가 아니며, 실제 환자정보·의료적 판단 자동화·EMR 쓰기 연동을 포함하지 않습니다.

## 현재 구현

- Next.js 16 + React 19 기반 3영역 인수인계 작업공간
- 환자 검색·선택, Shift Seam 이전/현재 비교, 중요도별 변화 검토
- 근거 링크에서 대응 변화 카드로 이동·focus
- SBAR 근거 포함률, 간호사 직접 Recommendation, 원본 확인 후 검토 잠금
- Python FastAPI `/api/health`, `/api/handover/compare`
- OpenAI Responses API 기반 선택적 문장화와 서버 전용 키 사용
- Vitest, Python unittest, Playwright E2E, 하네스·아키텍처 검사
- Vercel 배포를 전제로 한 무상태 API와 읽기 전용 가상 fixture

기존 Streamlit `app.py`는 기능 기준선으로 보존하며 최종 포트폴리오 UI는 아닙니다.

## 기술 스택

- Frontend: Next.js 16, React 19, TypeScript, CSS
- API: FastAPI, Python 3.12
- AI: OpenAI Responses API, Structured Outputs, deterministic fallback
- Test: Vitest, Testing Library, Playwright, Python unittest
- Deploy target: Vercel Preview → 승인 후 Production

## 로컬 실행

### 1. 의존성 설치

```powershell
python -m pip install -r requirements.txt
pnpm install --frozen-lockfile
```

### 2. 프런트엔드

```powershell
pnpm dev
```

표시된 로컬 URL을 브라우저에서 엽니다. Next 개발 서버만 실행하면 Python Function route는 404가 되며, UI는 이를 감지해 검증된 demo fallback을 표시합니다. 프런트엔드와 Python Function을 같은 origin에서 확인하는 최종 통합 환경은 Vercel Preview입니다.

### 3. Python API 단독 실행

```powershell
python -m uvicorn api.index:app --host 127.0.0.1 --port 8000
```

OpenAI 문장화를 시험할 때만 저장소에 커밋되지 않는 `.env`의 `OPENAI_API_KEY`를 사용합니다. 키 값과 환자 payload를 로그에 출력하지 않습니다.

## 검증

```powershell
python scripts/check_harness.py --root .
python -m unittest discover -s tests -v
pnpm test
pnpm lint
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

이미 실행 중인 개발 서버를 E2E에 재사용하려면:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3001'
pnpm test:e2e
```

## Vercel 배포 게이트

1. 위 로컬 전체 검증을 통과합니다.
2. Vercel 프로젝트를 연결하고 Preview를 생성합니다.
3. Preview에서 `/`, `/api/health`, `/api/handover/compare`를 확인합니다.
4. 키 없음·provider 실패의 deterministic fallback과, Preview 전용 키가 있을 때 AI 문장화를 각각 확인합니다.
5. 사용자 승인 후에만 Production으로 승격합니다.

Vercel 환경에서 `OPENAI_API_KEY`는 서버 환경변수로만 등록하며 `NEXT_PUBLIC_` 접두사를 사용하지 않습니다.

## 주요 구조

```text
src/app/                 Next.js 진입점과 전역 스타일
src/components/handover/ 인수인계 작업공간 UI
src/lib/                 TypeScript 계약·fixture adapter·API client
api/                     FastAPI Vercel Function
services/                비교·요약·OpenAI 검증 로직
data/                    읽기 전용 가상 환자 fixture
tests/                   Python 단위·API 계약 테스트
e2e/                     Playwright 핵심 시연 흐름
docs/                    제품 명세·ADR·하네스·작업 기록
```

## 안전 범위

- 저장소와 테스트에는 가상 환자 데이터만 사용합니다.
- LLM 출력은 새로운 임상 사실을 만들 수 없고 기존 evidence ID 범위에서만 허용됩니다.
- 이 프로토타입은 간호사의 원본 기록 확인을 대체하지 않습니다.
