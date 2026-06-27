from __future__ import annotations

from typing import Any

import streamlit as st

from services.handover_service import detect_changes, generate_handover_text
from services.patient_service import build_patient_data, patient_to_form_data, summarize_patient_row
from services.storage_service import (
    clear_patient_data,
    get_latest_snapshot,
    load_all_patients,
    load_patient,
    reset_demo_dataset,
    save_patient,
)


def _init_session_state() -> None:
    st.session_state.setdefault("selected_patient_id", None)
    st.session_state.setdefault("handover_result", "")
    st.session_state.setdefault("new_patient_mode", False)


def _bootstrap_demo_data() -> None:
    # Community Cloud containers are ephemeral, so seed the demo dataset when empty.
    if load_all_patients():
        return

    reset_demo_dataset()
    st.session_state.selected_patient_id = "P001"


def _default_form_values() -> dict[str, Any]:
    patient_id = st.session_state.get("selected_patient_id")
    patient = load_patient(patient_id) if patient_id else None
    return patient_to_form_data(patient)


def _render_patient_form() -> None:
    st.subheader("환자 정보 입력")

    patients = load_all_patients()
    options = ["신규 환자"] + [patient["patient_id"] for patient in patients]

    current_selection = "신규 환자"
    if st.session_state.selected_patient_id in options:
        current_selection = st.session_state.selected_patient_id

    selected = st.selectbox("환자 선택", options, index=options.index(current_selection))
    st.session_state.new_patient_mode = selected == "신규 환자"
    st.session_state.selected_patient_id = None if selected == "신규 환자" else selected

    form_data = _default_form_values()

    with st.form("patient_form", clear_on_submit=False):
        st.markdown("### 기본 정보")
        col1, col2, col3 = st.columns(3)
        patient_id = col1.text_input("환자 ID", value=form_data["patient_id"])
        name = col2.text_input("이름", value=form_data["name"])
        room_no = col3.text_input("병실", value=form_data["room_no"])

        col4, col5 = st.columns(2)
        age = col4.number_input("나이", min_value=0, max_value=120, value=form_data["age"], step=1)
        sex = col5.selectbox("성별", ["", "M", "F"], index=["", "M", "F"].index(form_data["sex"]))

        diagnosis = st.text_area(
            "진단명 (줄바꿈으로 구분)",
            value="\n".join(form_data["diagnosis"]),
            height=100,
        )

        st.markdown("### 활력징후")
        col_v1, col_v2, col_v3 = st.columns(3)
        systolic = col_v1.number_input("수축기 혈압", value=form_data["vitals"]["systolic"], step=1)
        diastolic = col_v2.number_input("이완기 혈압", value=form_data["vitals"]["diastolic"], step=1)
        heartrate = col_v3.number_input("심박수", value=form_data["vitals"]["heartrate"], step=1)

        col_v4, col_v5, col_v6 = st.columns(3)
        respiratory = col_v4.number_input("호흡수", value=form_data["vitals"]["respiratory"], step=1)
        saturation = col_v5.number_input("산소포화도", value=form_data["vitals"]["saturation"], step=1)
        body_temperature = col_v6.number_input(
            "체온",
            value=form_data["vitals"]["body_temperature"],
            min_value=30.0,
            max_value=45.0,
            step=0.1,
        )

        st.markdown("### 투약 정보")
        medications = st.data_editor(
            form_data["medications"],
            num_rows="dynamic",
            use_container_width=True,
            column_config={
                "name": st.column_config.TextColumn("약물명"),
                "route": st.column_config.TextColumn("투여 경로"),
                "frequency": st.column_config.TextColumn("빈도"),
            },
        )

        st.markdown("### 간호 메모")
        notes = st.text_area(
            "메모 (줄바꿈으로 구분)",
            value="\n".join(form_data["notes"]),
            height=120,
        )

        submitted = st.form_submit_button("저장")

    if submitted:
        patient_data = build_patient_data(
            {
                "patient_id": patient_id,
                "name": name,
                "room_no": room_no,
                "age": age,
                "sex": sex,
                "diagnosis": diagnosis,
                "vitals": {
                    "systolic": systolic,
                    "diastolic": diastolic,
                    "heartrate": heartrate,
                    "respiratory": respiratory,
                    "saturation": saturation,
                    "body_temperature": body_temperature,
                },
                "medications": medications,
                "notes": notes,
            }
        )

        save_patient(patient_data)
        st.session_state.selected_patient_id = patient_data["patient_id"]
        st.success(f"{patient_data['patient_id']} 환자 정보가 저장되었습니다.")
        st.rerun()


def _render_dataset_controls() -> None:
    st.subheader("데모 데이터 관리")
    col1, col2 = st.columns(2)

    if col1.button("샘플 데이터 다시 생성", use_container_width=True):
        reset_demo_dataset()
        st.session_state.selected_patient_id = "P001"
        st.session_state.handover_result = ""
        st.success("샘플 데이터셋을 기본 상태로 다시 생성했습니다.")
        st.rerun()

    if col2.button("데모 데이터 초기화", use_container_width=True):
        clear_patient_data()
        st.session_state.selected_patient_id = None
        st.session_state.handover_result = ""
        st.success("환자 데이터와 snapshot을 모두 초기화했습니다.")
        st.rerun()


def _render_patient_list() -> None:
    st.subheader("환자 목록")
    patients = load_all_patients()

    if not patients:
        st.info("저장된 환자가 없습니다.")
        return

    rows = [summarize_patient_row(patient) for patient in patients]
    st.dataframe(rows, use_container_width=True, hide_index=True)


def _render_handover_tab() -> None:
    st.subheader("인수인계")
    patients = load_all_patients()

    if not patients:
        st.info("먼저 환자 정보를 저장하세요.")
        return

    options = [patient["patient_id"] for patient in patients]
    default_index = 0
    if st.session_state.selected_patient_id in options:
        default_index = options.index(st.session_state.selected_patient_id)

    patient_id = st.selectbox("환자 선택", options, index=default_index, key="handover_patient")
    st.session_state.selected_patient_id = patient_id

    current_patient = load_patient(patient_id)
    previous_snapshot = get_latest_snapshot(patient_id)

    if previous_snapshot is None:
        st.warning("이전 snapshot이 없어 비교 가능한 인수인계가 없습니다. 환자를 한 번 더 수정 저장해야 합니다.")
        st.json(current_patient)
        return

    if st.button("인수인계 하기", type="primary"):
        changes = detect_changes(previous_snapshot, current_patient)
        st.session_state.handover_result = generate_handover_text(changes)

    if st.session_state.handover_result:
        st.markdown("### 인수인계 요약")
        st.code(st.session_state.handover_result, language="text")

    col_prev, col_curr = st.columns(2)
    with col_prev:
        st.markdown("### 이전 데이터")
        st.json(previous_snapshot)
    with col_curr:
        st.markdown("### 현재 데이터")
        st.json(current_patient)


def main() -> None:
    st.set_page_config(page_title="Nurse Handover Assistant", layout="wide")
    _init_session_state()
    _bootstrap_demo_data()

    st.title("Nurse Handover Assistant")
    st.caption("EMR 스타일 입력, JSON 저장, 인수인계 변화 요약 MVP")
    _render_dataset_controls()

    tab_input, tab_list, tab_handover = st.tabs(["환자 입력", "환자 목록", "인수인계"])

    with tab_input:
        _render_patient_form()
    with tab_list:
        _render_patient_list()
    with tab_handover:
        _render_handover_tab()


if __name__ == "__main__":
    main()
