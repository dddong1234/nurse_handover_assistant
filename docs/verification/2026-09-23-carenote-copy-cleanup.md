# CareNote 1.0.1 문구 정리 검증

기준일: 2026-09-23. 기준 커밋82379739 이후 새 CareNote 화면만 정리했다. 기존 `/handover`, API, 임상 규칙, 추천 어댑터, 저장 정책, 합성 환자 수는 변경하지 않았다.

## 감독 직접 검증

| 검사 | 명령 또는 방법 | 결과 |
|---|---|---|
| 전체 프런트 테스트 | `node node_modules/vitest/vitest.mjs run` | 32파일429건 통과 |
| 실제 API E2E | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3017`에서 `node node_modules/@playwright/test/cli.js test e2e/carenote.spec.ts --workers=1` | 6/6 통과 |
| 빌드 | `node node_modules/next/dist/bin/next build` | 통과 |
| Python | `.venv/carenote/Scripts/python.exe -m unittest discover -s tests -q` | 155건 통과 |
| 정적 검사 | TypeScript noEmit, ESLint 전체, git diff check | 통과; CRLF 정규화 안내만 있음 |
| 하네스 | `.venv/carenote/Scripts/python.exe scripts/check_harness.py --root .` | 1.0.1 버전 반영 후 통과 |

실제 API E2E는 환자·모듈별 초안 유지, 명시 기록 추가 및 재조회, 새로고침 초기화, 근거 포커스, 390/960/1440 폭, 기간별 읽음·메모 분리를 확인한다. 성공 안내 문장에 의존하던 검사는 API 응답과 실제 항목 검사로 바꿨다. 첫 수정 때 상세 패널과 목록의 동명 제목으로 테스트 선택자 오류가 발생하여 목록에 한정하고 재실행했다.

화면 이미지: 로컬 `artifacts/carenote/copy-workspace-1440.png`, `copy-landing-1440.png`, `copy-landing-390.png`와 E2E 근거/차팅 이미지. 삭제한 문구에 따른 제목·버튼·원본 데이터 누락이나 가로 넘침이 없는지 확인했다. 이미지는 Git 커밋 대상이 아니다.

## 유지한 의미

- 정상 안내만 삭제하며 로딩·오류·이전 결과·일부 데이터·비교 기준 없음 안내는 유지한다.
- available 응답에 원본 범위 경고가 있으면 중복 정상 배너 없이 경고를 유지한다.
- `확인 = 읽음`은 수행·인계 완료가 아니다. 검토 메모는 화면 메모이며 공식 기록이 아니다.
- 미입력 SOAP 항목은 직접 작성해야 한다. 자동 서명·공식 저장·임상 판단 기능이 추가되지 않았다.

## 한계와 배포

자동 테스트·화면 검증 결과이며 사용자 과업 시간, 임상 효과를 측정한 결과가 아니다. Vite 설정 미래 변경 예고와 Starlette/httpx deprecation 안내가 있으나 검사는 통과했다. 기존 인수인계 E2E68건은 이번 좁은 UI 작업에서는 재실행하지 않았다.

## 배포 확인

- 제품 코드: `95c778e385bf8869a2620be519b354e5967f03c5`, 별도 `codex/1.0-carenote-suite` 브랜치에 푸시.
- Preview `dpl_8WcXXWxGVqnJA4hreoofFUwqX1TY` READY. 랜딩/차팅 HTTP 성공 및 삭제 문구 부재, 입력기·초기화 안내 확인. 합성 P001 readiness POST: available, 16항목.
- 해당 Preview 승격으로 Production `dpl_2hcUF9UPSqZKu5DpDbgeeZxB2t9F` READY.
- 공개 주소 `https://carenote-suite.vercel.app`에서 로그인·인증 우회 없는 Chromium으로 정리된 제목/정상 배너 부재를 확인하고 실제 API E2E6/6 통과(10.9초).
- 기존 두 서비스와 원격 main은 변경하지 않았다. 추가 화면 자료는 로컬 artifacts에만 보관한다.
