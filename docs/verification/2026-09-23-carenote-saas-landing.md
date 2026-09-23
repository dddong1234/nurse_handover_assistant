# CareNote 1.0.2 랜딩 검증

기준일: 2026-09-23. 기준 커밋 `c6f3c928`. 구현 담당은 LandingPage 3파일, 감독은 별도 E2E 및 문서·버전·배포를 담당했다. 기존 작업공간/임상 코드/환자 데이터/API/저장 정책은 변경하지 않았다.

## 검증 과정

1. 신규 제품 미리보기 탭 검사 RED: 변경 전 해당 탭이 없어 실패했다.
2. 첫 구현의 Vitest 428건과 E2E 80건 통과 이후에도 실제 화면과 독립 코드 리뷰에서 CTA 대비 회귀를 발견했다.
3. 감독이 브라우저 대비 검사 RED를 추가했다. 흰 글자 규칙이 링크 reset에 덮여 대비가 1.151:1이었다.
4. 동일 담당 수정 1회: CTA/skip link 우선순위, 미리보기 텍스트, 모바일 문장 공백, sticky/앵커. 새 대비 검사 GREEN, 기본 및 hover 상태 4.5:1 이상.
5. 독립 정적 재검토에서 미해결 사항 없음. 이후 전체 화면에서 발견한 제목의 한 글자 줄바꿈은 짧은 동의 문구로 조정했다.

CSS 교체 중 실행한 초기 legacy 검사는 일부 성공 후 timeout으로 중단했다. 불완전 파일 상태의 실행을 제품 통과로 계산하지 않았고, 파일 동결 후 전체 검사를 다시 수행했다.

## 감독 검사

| 검사 | 범위/명령 | 결과 |
|---|---|---|
| Vitest | `node node_modules/vitest/vitest.mjs run` | 32파일 428건 통과 |
| 브라우저 전체 | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3017`, `node node_modules/@playwright/test/cli.js test --workers=1` | 81건 통과: 랜딩 7, CareNote 실제 API 6, 기존 인수인계·안내 68 |
| Python | `.venv/carenote/Scripts/python.exe -m unittest discover -s tests -q` | 155건 통과 |
| 정적/빌드 | 전체 ESLint, TypeScript noEmit, Next production build | 통과 |
| 하네스 | `.venv/carenote/Scripts/python.exe scripts/check_harness.py --root .` | 1.0.2 버전 반영 후 재확인 통과 |
| 실제 화면 | CUA 1440 데스크톱 전체, 375 모바일 3개 패널, 직접 CTA/앵커 전환 | 대비·글자·가로 경계 확인 |

랜딩 E2E는 375/768/1024/1440에서 가로 넘침·컨트롤 경계·유효 미리보기 글자 최소 12px, 키보드 탭, 실제 경로, FAQ, sticky 위치와 CTA 대비를 확인한다. 전 제품의 포괄적 접근성 인증을 의미하지 않는다.

마지막 제목 문구 조정 후 Vitest 428건, 랜딩+CareNote E2E 13건, Next build, 하네스를 다시 실행해 통과했다. 데스크톱에서 제목이 의도한 두 줄로 표시됨을 직접 확인했다. 기존 인수인계 E2E 68건은 그 직전 전체 실행의 결과이며 마지막 랜딩 제목 변경 후 별도 재실행하지 않았다.

이 숫자는 기술적 검증 결과다. 전환율, 근무 준비 시간, 실제 사용자 효과는 측정하지 않았다. 새 LLM 테스트는 하지 않았고 OpenAI 키를 사용하거나 이동하지 않았다. Vite 미래 설정 및 Starlette/httpx deprecation 안내는 비실패 경고로 남는다.

## 배포

- 제품 커밋: `f9b30bb98de6f8fe6b12cd5adaab728d774c131e`, `codex/1.0-carenote-suite`에 푸시.
- Preview `dpl_4mCQGC3VKKNLsFnfQtKin3EMxsgc` READY. 새 제목·제품 탭·최종 제목 문구·workspace 링크 및 차팅 입력기 응답 확인. 합성 P001 readiness POST는 available, 16항목.
- Preview 확인 후 승격한 Production `dpl_GnSk2BpYzFuJ66Sjg89k5SQgWVNH` READY. 공개 별칭은 `https://carenote-suite.vercel.app`.
- 공개 사이트에서 인증 우회나 로그인 없이 랜딩 7건과 실제 API CareNote 6건, 합계 13건 모두 통과(16.9초). CUA로 공개 랜딩 표시도 직접 확인했다.
- 기존 인수인계/차팅 서비스와 원격 main은 변경하지 않았다. 사용자의 기존 미추적 artifacts는 커밋하지 않았다.
