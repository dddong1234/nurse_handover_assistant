import p001Previous from "../../data/history/P001/2026-07-02T070000.json";
import p001Current from "../../data/patients/P001.json";
import p002Previous from "../../data/history/P002/2026-07-02T060000.json";
import p002Current from "../../data/patients/P002.json";
import p003Previous from "../../data/history/P003/2026-07-02T060000.json";
import p003Current from "../../data/patients/P003.json";
import p004Previous from "../../data/history/P004/2026-07-02T060000.json";
import p004Current from "../../data/patients/P004.json";
import p005Previous from "../../data/history/P005/2026-07-02T070000.json";
import p005Current from "../../data/patients/P005.json";

export type DemoMedication = {
  name: string;
  route: string;
  frequency: string;
};

export type DemoPatientRecord = {
  patient_id: string;
  name: string;
  room_no: string;
  age: number;
  sex: string;
  diagnosis: string[];
  vitals: Record<string, number>;
  medications: DemoMedication[];
  notes: string[];
  updated_at: string;
};

export type DemoRecordPair = {
  previous: DemoPatientRecord | null;
  current: DemoPatientRecord;
};

/**
 * Read-only references to the ten fictional records used by the browser demo.
 * The imported JSON objects are passed through unchanged to the API client.
 */
export const DEMO_RECORD_PAIRS: Readonly<Record<string, DemoRecordPair>> = {
  P001: { previous: p001Previous, current: p001Current },
  P002: { previous: p002Previous, current: p002Current },
  P003: { previous: p003Previous, current: p003Current },
  P004: { previous: p004Previous, current: p004Current },
  P005: { previous: p005Previous, current: p005Current },
};

export const demoRecordPairs = DEMO_RECORD_PAIRS;
