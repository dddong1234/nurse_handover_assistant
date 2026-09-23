# CareNote 1.0.0 — 구현·검증·배포 기록

기준일: 2026-09-23 KST. 기준 커밋 `2610a017`, 브랜치 `codex/1.0-carenote-suite`.

## 감독 검증

| 검사 | 실행/대상 | 결과 |
|---|---|---|
| 프런트엔드 | `node node_modules/vitest/vitest.mjs run`, 17:54:59 실행 | 32파일423건 통과 |
| lint | `node node_modules/eslint/bin/eslint.js . --max-warnings=0` | 통과 |
| TypeScript | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | 통과 |
| 배포 빌드 | `node node_modules/next/dist/bin/next build` | /, /handover, /workspace 생성 통과 |
| Python | 격리 환경 Python3.12, `-m unittest discover -s tests -q` | 155건 통과 |
| 하네스 | `python scripts/check_harness.py --root .` | 통과 |
| 기존 브라우저 회귀 | handover-workspace.spec.ts + onboarding.spec.ts | 68건 통과, 기존 API 응답 제어 포함 |
| 새 실제 API 브라우저 | carenote.spec.ts, 실제 로컬 FastAPI8017+Next3017 | 6건 통과, readiness API mock 없음 |
| 독립 계약 재리뷰 | 공통+차팅 scoped132건과 기존 실패사례 직접 재현 | Important3건 해결 |
| 독립 UI 재리뷰 |390/960/1440, 근거 clipping·focus·메모/읽음·기간분리 | 미해결 Important 없음 |

Node 실행 경로: `C:\Program Files\nodejs\node.exe`.
Python 실행 경로: 이 작업폴더의 `.venv\carenote\Scripts\python.exe`. 기존 사용자 가상환경을 덮어쓰지 않고 별도 환경 생성.

### 재현하고 수정한 실패

- Vitest/tsc는 통과했으나 Next가 포팅된 `.js` 내부 import를 해결하지 못함 → 통합 복사본만 extensionless import로 수정.
- 원본 차팅 규칙의 부분 매칭/고정 문구가 입력에 없는 사실이나 잘못된 횟수를 만듦 → 전체 단문만 허용, 원문 보존, 미제공 SOAP 수기 작성.
- 미래 기록의 ID가 과거 기록 근거로 저장됨 → UI/adapter/공통 추가 경계에서 시각 검증.
- 작은 글씨 확대 뒤 근거 패널48px 가로넘침 → intrinsic sizing과 줄바꿈 수정, overflow 숨김 없이 실제값 전체 표시.
- 랜딩의 예시가 실제 시나리오/지원기능과 달랐음 → P001 실제 fixture 및 좁은 차팅 동작으로 교체.

### 해석 제한

위 검사는 기술적 구현과 화면 동작 확인이다. 현직 간호사 과업 테스트, 시간 절감 실측, 임상 안전성 또는 병원 도입 검증이 아니다. 새 제품에 대한 추가 사용자 실험은 하지 않았다. 외부 OpenAI API를 호출하지 않았으며 새로운 배포에 키를 자동 복사하지 않는다.

기존 Vitest 설정의 향후 ESM 경고 및 Starlette/httpx deprecation 경고가 있으나 이번 실행 실패는 없었다. 전체 dependencies 업그레이드는 이번 범위가 아니다.

## 배포

- 대상: 기존 서비스와 분리한 Vercel `carenote-suite` 프로젝트.
- 현재 단계: 로컬 감독 게이트 통과, Preview 배포 및 원격 스모크 확인 대기.
- 기존 인수인계/차팅 Production과 원격 main은 변경하지 않는다.
- 새 배포가 실패하면 기존 서비스로 돌아갈 수 있으며, 새 프로젝트의 Production alias만 이전 검증 배포로 되돌린다. 최초 배포 전에는 기존 CareNote Production이 없다.
- 배포에 `.env*`, 개발 가상환경, 사용자 artifacts, docs 등은 업로드하지 않는다. 인증 토큰·실제 환자정보를 커밋하지 않는다.
