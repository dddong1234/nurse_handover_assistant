# Streamlit Community Cloud Deployment Guide

이 문서는 `Nurse Handover Assistant`를 Streamlit Community Cloud에 공개 데모로 배포하기 위한 실행 가이드다.

## 1. Current Deployment Shape

현재 저장소는 Community Cloud 요구사항에 맞게 아래 구조를 갖는다.

```text
nurse_handover_assistant/
  .streamlit/
    config.toml
  app.py
  requirements.txt
  data/
  services/
```

엔트리포인트는 `app.py`다.

## 2. Community Cloud Assumptions

배포 기준은 Streamlit 공식 문서의 현재 안내를 따른다.

- Community Cloud는 저장소 루트에서 `streamlit run`을 실행한다.
- 설정 파일은 루트의 `.streamlit/config.toml`에 둔다.
- Python 의존성은 루트의 `requirements.txt`에서 읽는다.
- 배포 시 `Repository / Branch / File path`를 선택한다.

공식 문서:

- https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/file-organization
- https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/app-dependencies
- https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy

## 3. Important Behavior for This App

이 앱은 로컬 JSON 파일을 사용한다.

Community Cloud에서는 컨테이너 파일시스템이 영구 저장소가 아니므로:

1. 앱 실행 중 생성된 환자 수정 내용은 영구 보존되지 않을 수 있다
2. 앱이 재시작되면 상태가 초기화될 수 있다
3. 공개 데모 목적에서는 이 제약이 허용 가능하다

이 제약을 보완하기 위해, 현재 앱은 환자 데이터가 비어 있으면 시작 시 샘플 데이터셋을 자동으로 다시 생성한다.

## 4. Deploy Steps

### 4.1 Push the Repository

먼저 GitHub에 현재 저장소를 올린다.

필수 확인:

1. `venv/`는 커밋하지 않는다
2. `app.py`가 저장소 루트에 있어야 한다
3. `requirements.txt`가 저장소 루트에 있어야 한다

### 4.2 Create the App

1. `https://share.streamlit.io`로 이동한다
2. `Create app`을 누른다
3. `Yup, I have an app`을 선택한다
4. GitHub repository를 선택한다
5. Branch를 선택한다
6. File path에 `app.py`를 지정한다
7. 원하는 경우 App URL 서브도메인을 지정한다
8. `Deploy`를 누른다

### 4.3 Python Version

공식 문서상 Community Cloud의 기본 Python 버전은 현재 `3.12`다.
이 프로젝트의 로컬 가상환경도 Python `3.12` 기준이므로 기본값을 유지해도 된다.

필요하면 배포 화면의 `Advanced settings`에서 Python 버전을 직접 지정할 수 있다.

## 5. Recommended Public Demo Positioning

앱 설명에는 아래와 같이 쓰는 편이 정확하다.

`간호 인수인계에서 중요한 변화만 빠르게 정리하는 workflow-focused MVP입니다. 환자 정보를 입력하면 JSON으로 저장하고, 이전 snapshot과 비교해 변동사항을 자동 요약합니다.`

피해야 할 표현:

- `실제 병원 운영용 서비스`
- `데이터가 영구 저장되는 의료 시스템`

## 6. Post-Deploy Checklist

배포 후 바로 확인할 것:

1. 첫 로딩 시 환자 5명이 자동으로 보이는지
2. `환자 입력` 탭에서 수정 저장이 되는지
3. `인수인계` 탭에서 `인수인계 하기` 버튼이 동작하는지
4. `샘플 데이터 다시 생성` 버튼이 동작하는지
5. 새로고침 후 앱이 에러 없이 다시 열리는지

## 7. Local Run Command

로컬에서 Community Cloud와 같은 경로 기준으로 테스트하려면 저장소 루트에서 실행한다.

```bash
./venv/bin/streamlit run app.py
```
