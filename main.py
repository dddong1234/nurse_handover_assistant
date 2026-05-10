class InMemoryPatientRepo:

    def __init__(self, data):
        self.data = data

    def get_data(self):
        return self.data

    def update_category(self, category, value):
        self.data[category] = value

    def update_vital(self, key, value):
        self.data["vitals"][key] = value

    def add_medication(self, name, info):
        self.data["medication"][name] = info

    def delete_medication(self, name):
        self.data["medication"].pop(name, None)


def handle_vitals(repo):
    vitals = repo.get_data()["vitals"]
    keys = list(vitals.keys())

    key = input(f"{keys} 선택 (0:취소): ")
    if key == "0" or key not in keys:
        return

    val = input("새 값: ")
    repo.update_vital(key, val)


def handle_medication(repo):
    action = input("add / delete / edit (0:취소): ")

    if action == "0":
        return

    if action == "add":
        name = input("약 이름: ")
        route = input("경로: ")
        freq = input("빈도: ")
        repo.add_medication(name, [route, freq])

    elif action == "delete":
        name = input("삭제할 약: ")
        repo.delete_medication(name)

    elif action == "edit":
        name = input("수정할 약: ")
        route = input("경로: ")
        freq = input("빈도: ")
        repo.add_medication(name, [route, freq])


def handle_list(repo, category):
    data = repo.get_data()[category]

    mode = input("append / overwrite (0:취소): ")

    if mode == "0":
        return

    if mode == "append":
        data.append(input("추가 값: "))
    elif mode == "overwrite":
        repo.update_category(category, [input("새 값: ")])


handlers = {
    "vitals": handle_vitals,
    "medication": handle_medication,
    "diagnosis": lambda repo: handle_list(repo, "diagnosis"),
    "notes": lambda repo: handle_list(repo, "notes"),
    "discharge_date": lambda repo: handle_list(repo, "discharge_date"),
}

def detect_changes(prev, curr):
    changes = []

    # vitals 비교
    for k in prev["vitals"]:
        if prev["vitals"][k] != curr["vitals"][k]:
            changes.append(f"{k} 변화: {prev['vitals'][k]} → {curr['vitals'][k]}")

    # medication 비교
    prev_meds = set(prev["medication"].keys())
    curr_meds = set(curr["medication"].keys())

    added = curr_meds - prev_meds
    removed = prev_meds - curr_meds

    for m in added:
        changes.append(f"{m} 신규 처방")

    for m in removed:
        changes.append(f"{m} 중단")

    return changes

def print_handover(changes):
    print("\n=== 인수인계 ===")
    if not changes:
        print("변화 없음")
    else:
        for c in changes:
            print(f"- {c}")


from copy import deepcopy


def main(patient_data):

    prev_data = deepcopy(patient_data)
    repo = InMemoryPatientRepo(deepcopy(patient_data))

    while True:
        keys = list(repo.get_data().keys())

        category = input(f"{keys} 선택 (0:종료): ")

        if category == "0":
            break

        if category not in handlers:
            print("잘못된 입력")
            continue

        handler = handlers[category]
        handler(repo)

    curr_data = repo.get_data()

    changes = detect_changes(prev_data, curr_data)

    print_handover(changes)


prev_patient_data = {
    "patient_id": "P001",
    "diagnosis": [
        "acute pharyngitis"
    ],
    "vitals": {
        "systolic": 120,
        "diastolic": 80,
        "respiratory": 16,
        "heartrate": 78,
        "saturation": 98,
        "body_temperature": 37.5
    },
    "medication": {
        "이부프로펜 400mg": ["PO", "TID"],
        "광동라푸티딘": ["PO", "BID"]
    },
    "discharge_date": [],
    "notes": []
}

curr_patient_data = {
    "patient_id": "P001",
    "diagnosis": [
        "acute pharyngitis",
    "hypertension"   # 추가됨
    ],
    "vitals": {
        "systolic": 150,      # 상승
        "diastolic": 95,      # 상승
        "respiratory": 18,    # 증가
        "heartrate": 92,      # 증가
        "saturation": 97,     # 약간 감소
        "body_temperature": 38.2  # 발열
    },
    "medication": {
        "이부프로펜 400mg": ["PO", "TID"],   # 유지
        "타세놀정 500mg": ["PO", "TID"],     # 신규 추가
        # "광동라푸티딘" → 삭제됨
    },
    "discharge_date": ["2026-05-10"],  # 새로 입력
    "notes": [
        "환자 인후통 호소",
        "미열 지속"
    ]
}

changes = detect_changes(prev_patient_data, curr_patient_data)
print_handover(changes)
# if __name__ == "__main__":
#     main(prev_patient_data)

