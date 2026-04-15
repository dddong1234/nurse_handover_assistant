from copy import deepcopy

patient_data_template = {
    "patient_id": None,
    "diagnosis": [],
    "vitals":{
        "systolic":None,
        "diastolic":None,
        "respiratory":None,
        "heartrate":None,
        "saturation":None,
        "body_temperature":None
    },
    "medication":{},
    "퇴원예정일": None,
    "notes":[]
}

patients = ("POO1")

patient_data = {
    "patient_id": "P001",
    "diagnosis": [
        "acute pharyngitis"
    ],
    "vitals":{
        "systolic":120,
        "diastolic":80,
        "respiratory":16,
        "heartrate":80,
        "saturation":99,
        "body_temperature":37.7
    },
    "medication":{
        "이부프로펜 400mg":["PO","TID"],
        "광동라푸티딘":["PO","BID"],
        "타세놀정이알 500mg":["PO","TID"]
    },
    "퇴원예정일": None,
    "notes":[]
}

def get_input_data():
    repeat = True
    prev_patient_data = patient_data
    keys = list(prev_patient_data.keys())
    curr_patient_data = deepcopy(prev_patient_data)
    while repeat:
        category = input(f"카테고리 : {keys} \n 변경할 카테고리를 선택하세요(취소: 0) :")
        if category == "0":
            print("취소되었습니다.")
            break
        if category not in keys:
            print("카테고리가 잘못되었습니다, 다시 입력해주세요(취소: 0)")
            continue
        tmp_keys =prev_patient_data[category].items()
        print(tmp_keys)





def detect_changes(prev_data,curr_data):
    handover_list = []

    return handover_list

def print_handover(handover_list:list):
    pass

get_input_data()

