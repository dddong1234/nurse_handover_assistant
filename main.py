from copy import deepcopy

from numpy.random.mtrand import beta

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
    "퇴원예정일": [],
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
    "discharge_date": [],
    "notes":[]
}

#cli를 통해 변경원하는 카테고리를 입력받는 함수
def get_category_input(keys) -> str:
    category =  input(
        f"카테고리 : {keys} \n 변경할 카테고리를 선택하세요(취소: 0) :"
    )
    return category

#입력받은 카테고리 유효성 검사를 위한 함수
# 0 입력시 취소(break), 오타 or 없는거 입력하면 (continue)
def validate_category(category,keys) -> bool:
    if category == "0":
        print("취소되었습니다.")
        return False
    if category not in keys:
        print("카테고리가 잘못되었습니다, 다시 입력해주세요(취소: 0)")
        return False

# def get_subkey(data, category):
#     subkey = data[category]
#     if isinstance(subkey,dict):
#         return list(subkey.keys())
#     elif


def get_input_data():
    repeat = True
    prev_patient_data = patient_data
    keys = list(prev_patient_data.keys())
    curr_patient_data = deepcopy(prev_patient_data)

    while repeat:
        category = input(
            f"카테고리 : {keys} \n 변경할 카테고리를 선택하세요(취소: 0) :"
        )

        if category == "0":
            print("취소되었습니다.")
            break

        if category not in keys:
            print("카테고리가 잘못되었습니다, 다시 입력해주세요(취소: 0)")
            continue

        value = prev_patient_data[category]
        edited_value = curr_patient_data[category]
        if isinstance(value,dict):
            subkeys = list(value.keys())
            while True:
                category_dict = input(
                    f"카테고리 : {subkeys} \n 변경할 카테고리를 선택하세요(취소: 0) :"
                )
                if category_dict not in subkeys:
                    print("입력이 잘못되었습니다. 다시 입력해주세요.")
                    continue
                elif category_dict == "0":
                    print("취소되었습니다.")
                    break
                else:
                    print(f"변경하실 category는 '{category_dict}' 입니다 계속하시겠습니까?")
                    y_or_n = input("(y/n):")
                    if y_or_n == "y":
                        category_value = input("")
        else:
            while True:
                append_or_overwrite = input("추가하시겠습니까? 덮어씌우시겠습니까?\n입력(append/overwrite/0):")
                if append_or_overwrite == "0":
                    break
                if append_or_overwrite == "append":
                    data_append = input("추가하실 내용을 입력해주세요:")
                    edited_value.append(data_append)
                    break
                elif append_or_overwrite == "overwrite":
                    data_overwrite = input("덮어 씌울 내용을 입력해주세요:")
                    curr_patient_data[category] = [data_overwrite]
                    break
                else:
                    print("입력이 잘못되었습니다. 다시입력해주세요.")
                    continue
        print(prev_patient_data)
        print(curr_patient_data)






def detect_changes(prev_data,curr_data):
    handover_list = []

    return handover_list

def print_handover(handover_list:list):
    pass

get_input_data()
