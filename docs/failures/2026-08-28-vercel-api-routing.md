# Vercel Next.js + FastAPI API 라우팅 실패

## 목적

Next.js 화면과 `api/index.py` FastAPI를 하나의 Vercel 프로젝트로 배포하고 `/api/health`, `/api/handover/compare`를 같은 origin에서 제공한다.

## 최초 증상

- 첫 배포와 Next.js 화면 빌드는 성공했다.
- 배포 산출물에는 Python 3.12 `api/index` Function이 존재했다.
- `/api/index` 직접 호출은 FastAPI의 JSON 404를 반환했지만 `/api/health`는 Next.js 404 HTML을 반환했다.

## 근본 원인

Vercel이 Python Function을 생성했으나 이 혼합 Next.js 프로젝트에서는 `/api/*` 요청을 `api/index` Function으로 보내는 catch-all route가 생성되지 않았다. 따라서 FastAPI 앱이 요청을 받기 전에 Next.js not-found 경로가 응답했다.

## 수정

루트 `vercel.json`에 `/api/:path*`를 `/api/index`로 전달하는 rewrite를 명시했다. `tests/test_vercel_config.py`가 이 배포 계약을 고정한다.

## 검증

- 수정 전 배포: `/api/health` 404
- 수정 후 Preview와 Production: `/` 200, `/api/health` 200
- 가상 최소 기록 POST: `ready`, 변화 1건, 요약 근거 1건, deterministic mode
- Production Playwright: 9/9 통과

## 재시도 금지 및 후속 지침

- 명시적 rewrite 없이 혼합 Next.js + FastAPI 자동 라우팅에만 의존하지 않는다.
- API route를 Next.js 쪽에 중복 구현하지 않는다.
- 실제 환자정보 또는 API 키를 배포 smoke payload에 사용하지 않는다.
- Vercel routing 변경 시 `tests.test_vercel_config`와 Preview API smoke를 먼저 통과시킨다.
