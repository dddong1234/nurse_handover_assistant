# Vercel 배포 관례

## 환경

- `development`: 로컬 개발과 자동 테스트
- `preview`: 브랜치·PR별 Vercel 배포와 기능 검증
- `production`: 감독 검증과 사용자 승인 후 승격

## 목표 디렉터리 구조

```text
app/ 또는 src/app/      Next.js 화면과 컴포넌트
api/                    Python FastAPI 진입점
services/               UI 독립 비교·요약 로직
data/                   배포 시 읽기 전용 가상 fixture
tests/                  오프라인 및 API 계약 테스트
```

실제 구조는 Figma 검토와 구현 설계 승인 후 확정한다.

## 환경변수

- 로컬: `.env` 또는 Vercel CLI가 주입하는 개발 환경변수
- Preview: Vercel Preview 환경에 별도 등록
- Production: Vercel Production 환경에 별도 등록
- `OPENAI_API_KEY`는 서버 함수만 읽고 `NEXT_PUBLIC_` 접두사를 사용하지 않는다.
- 환경변수 변경 후에는 새 배포를 생성해 반영 여부를 검증한다.

## 데이터

- 저장소의 가상 환자 fixture는 읽기 전용이다.
- Vercel Function에서 `data/patients` 또는 `data/history`에 쓰지 않는다.
- 1차 배포의 편집 상태는 브라우저 세션에 둔다.
- 공유 영속성이 필요하면 데이터베이스 선택, 비용, 스키마와 개인정보 범위를 별도 승인한다.

## 배포 게이트

1. 로컬 단위·계약 테스트 통과
2. 하네스 검사 통과
3. Preview 빌드 성공
4. Preview에서 주요 화면과 API smoke test
5. OpenAI 키 없음·정상·실패 상태 검증
6. Figma 대조 검증
7. Production 승격

## 금지

- Preview 검증 없이 Production 직접 배포
- 클라이언트 코드에 API 키 포함
- 배포 Function의 로컬 파일 쓰기를 영속 저장으로 간주
- 실제 환자정보를 Preview 또는 Production에 업로드
- 테스트 실패 상태에서 배포 설정을 완화해 통과시키기
