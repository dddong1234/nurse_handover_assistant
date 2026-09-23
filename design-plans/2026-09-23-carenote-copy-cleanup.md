# CareNote 문구 밀도 축소

Written against: 82379739. 사용자 요청: “필요없는 문구들 다 삭제”.

## Evidence chain

- Surface: `/`, `/workspace`의 근무 준비·환자 기록·간호기록.
- Problem: 한국어 제목 위에 영어 제목이 반복되고 탭 설명, 본문 설명, 정상 완료 배너가 같은 기능을 설명한다. 간호기록의 외부·내부 소개와 데모 안내도 중복된다.
- Design evidence: 기존 승인된 Figma 기반 화면과 `docs/CARENOTE_PRODUCT.md`. 새 시각 체계를 만들지 않는다.
- Owner: LandingPage, CareWorkspace, ChartingPanel. 담당별 소유 파일을 분리한다.
- Uncertainty: 문구 감소가 실제 사용자 과업 시간을 줄이는지는 미측정이다.

## Design decision

장식 영어, 반복 설명과 정상 완료 배너를 제거한다. 제목·데이터·행동 버튼이 먼저 읽히게 한다. 실패, 불완전 데이터, 실제 원본 시각, 읽음 의미, 페이지 메모리 소실 안내는 없애지 않고 해당 행동 옆에서 짧게 유지한다. 기능·의료적 의미·저장 정책을 변경하지 않는다.

## Reuse

기존 제목, 버튼, 배지, 빈 상태 스타일을 재사용한다. 새 컴포넌트나 토큰은 필요 없다.

## Changes

1. LandingPage: 장식 소제목과 모형의 반복 설명 제거. 주요 제품 설명·CTA·FAQ 사실 관계는 보존.
2. CareWorkspace: 탭 설명과 영어 소제목 제거, 정상 완료 안내 제거. 환자·기간·원본 및 비정상 상태는 보존.
3. ChartingPanel: 소개를 한 번만 노출하고 도움말을 짧게 줄임. 미입력 항목·추가 오류·미서명·새로고침 소실 의미는 보존.

## Scope

- Include: 위 세 화면 및 직접 관련 스타일·테스트.
- Exclude: 기존 `/handover`, 임상 로직, API, 데이터, 추천 어댑터, 저장 정책, 기존 두 배포 서비스.

## Validation

- 실제 API E2E로 환자/모듈 이동, 초안·읽음·메모 분리, 명시 추가·새로고침 초기화 검증.
- 정상 배너 문구에 의존하던 E2E를 실제 응답과 항목 확인으로 변경.
- 390/960/1440 화면과 근거 패널 너비, 간호기록 입력 확인.
- Vitest, ESLint, TypeScript, Next build, Python unittest, harness.

## Stop conditions

문구 정리가 임상 사실이나 기능 계약을 바꾸어야 하면 구현을 중단하고 감독에게 보고한다.

## Design documentation

검증 결과는 `docs/AGENT_WORKLOG.md`와 별도 검증 기록, 기존 Notion 협업 페이지에 남긴다.
