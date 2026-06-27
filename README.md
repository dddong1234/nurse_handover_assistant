# Nurse Handover Assistant

`Nurse Handover Assistant` is a Streamlit MVP that summarizes patient changes for nurse handovers by comparing the latest patient record with the previous snapshot.

## What It Does

- Enter or edit patient information in an EMR-style form
- Save the latest patient record as JSON
- Keep the previous version as a history snapshot on overwrite
- Compare previous vs current data
- Generate a handover summary focused on changes only

## Demo Scope

This repository is a workflow-focused MVP.

- Storage: local JSON files
- Interface: Streamlit
- Comparison targets: vitals, medications, diagnosis, notes
- Included dataset: demo-only fictional patient data

This is not a production EMR and does not include authentication, permissions, or persistent cloud storage.

## Tech Stack

- Python 3.12
- Streamlit
- Pandas
- Local JSON storage

## Run Locally

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Or, with the existing local environment in this repo:

```bash
./venv/bin/streamlit run app.py
```

## Streamlit Community Cloud

Entrypoint file: `app.py`

When the app starts with an empty dataset, it automatically restores the bundled demo dataset so the public demo is immediately usable.

Deployment guide:

- [docs/DEPLOY_STREAMLIT_COMMUNITY_CLOUD.md](/mnt/c/dev/nurse_handover_assistant/docs/DEPLOY_STREAMLIT_COMMUNITY_CLOUD.md:1)

## Repository Structure

```text
.
├── app.py
├── data/
├── docs/
├── requirements.txt
└── services/
```

## Demo Data Notice

All patient data in this repository is fictional and included only for demonstration purposes.
