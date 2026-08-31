# ADR-002: Vercel을 포트폴리오 배포 대상으로 사용

## 상태

확정 — 2026-08-27

## 배경

사용자는 완성된 포트폴리오 애플리케이션을 Vercel에 배포할 예정이다. 현재 애플리케이션은 Streamlit UI와 로컬 JSON 쓰기 방식이 결합되어 있어 Vercel Functions의 실행 모델에 그대로 맞지 않는다.

## 결정

목표 구조를 다음과 같이 정한다.

```text
Browser
└─ Next.js UI
   ├─ 번들된 가상 환자 데이터 읽기
   ├─ 브라우저 세션의 데모 편집 상태
   └─ /api 호출
      └─ Python FastAPI Vercel Function
         ├─ deterministic 차이 비교
         ├─ 근거가 제한된 요약
         └─ OpenAI 서버 호출과 fallback
```

- Figma를 Next.js UI의 기준 소스로 사용한다.
- 기존 Python 비교 로직은 UI와 분리해 재사용한다.
- 현재 Streamlit 앱은 기존 기능의 기준선으로 보존한다.
- 1차 배포는 공유 영속 저장소를 사용하지 않는다.
- JSON 환자 데이터는 읽기 전용 fixture로만 사용한다.
- 편집과 시연 상태는 브라우저 세션 범위로 제한한다.
- OpenAI API 키는 Vercel 서버 환경변수로만 사용한다.

## 이유

- Vercel은 Next.js 프런트엔드와 FastAPI Python 백엔드를 결합한 공식 예제를 제공한다.
- Vercel의 FastAPI 애플리케이션은 하나의 Function으로 배포되므로 현재 Python 서비스 계층을 비교적 적은 변경으로 재사용할 수 있다.
- 로컬 JSON 쓰기를 제거하면 배포 환경과 로컬 환경의 상태 불일치를 막을 수 있다.
- 포트폴리오의 핵심 가치는 UI와 차이 비교·요약이므로 초기 DB 구축보다 핵심 경험에 집중할 수 있다.
- API 키를 서버 함수에 두면 브라우저 번들로 노출되지 않는다.

## 제약과 위험

- Vercel Python Runtime은 2026-08-27 기준 Beta이므로 배포 전 preview 환경에서 반드시 검증한다.
- Python Function은 번들 크기와 실행시간 제한을 가진다.
- 브라우저 세션 상태는 새 기기나 새 브라우저에 공유되지 않는다.
- 서버 영속성이 없으므로 다중 사용자 협업이나 장기 기록 보존을 시연하지 않는다.

## 포기한 대안

### Streamlit을 그대로 Vercel에 배포

Vercel의 공식 Python 배포 경로는 FastAPI, Flask, Django와 HTTP handler 중심이다. 최종 Figma UI를 구현하기에도 Streamlit보다 Next.js가 적합해 제외한다.

### 처음부터 외부 Postgres 도입

1차 포트폴리오 핵심 범위보다 운영 복잡성이 크고 UI·비교 기능 검증을 지연시켜 제외한다. 공유 저장이 제품 시나리오에 필요해질 때 별도 ADR로 재검토한다.

### 비교 로직을 TypeScript로 전면 재작성

기존 Python 로직과 평가 자산을 버리게 되고 동작 불일치 위험이 있어 제외한다. 먼저 Python Function으로 재사용하고 배포 문제가 확인될 때만 검토한다.

## 공식 근거

- [Vercel Python Runtime](https://vercel.com/docs/functions/runtimes/python)
- [FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi)
- [Next.js + FastAPI Starter](https://vercel.com/templates/next.js/nextjs-fastapi-starter)
- [Vercel Functions 파일 사용](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions)
- [Vercel 환경변수](https://vercel.com/docs/environment-variables)
- [Vercel Functions 제한](https://vercel.com/docs/functions/limitations)

## 결과

- 프런트엔드 에이전트는 Figma MCP 검토 후 Next.js 범위에서만 구현한다.
- 핵심 로직 에이전트는 UI와 무관한 Python 함수 및 API 계약을 구현한다.
- 배포 Function은 무상태로 설계한다.
- 데이터베이스, 인증, 실제 환자정보 처리는 현재 범위에 추가하지 않는다.
