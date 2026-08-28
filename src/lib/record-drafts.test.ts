import { describe, expect, it } from "vitest";

import type { DemoPatientRecord } from "./demo-records";
import {
  RECORD_DRAFTS_STORAGE_KEY,
  isDemoPatientRecord,
  loadRecordDrafts,
  persistRecordDraft,
  removeRecordDraft,
} from "./record-drafts";

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map(Object.entries(initial));

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function createValidRecord(): DemoPatientRecord {
  return {
    patient_id: "P001",
    name: "홍길동",
    room_no: "301",
    age: 67,
    sex: "M",
    diagnosis: ["acute pharyngitis", "hypertension"],
    vitals: {
      systolic: 150,
      diastolic: 95,
      heartrate: 92,
      respiratory: 18,
      saturation: 97,
      body_temperature: 38.2,
    },
    medications: [
      {
        name: "이부프로펜 400mg",
        route: "PO",
        frequency: "TID",
      },
      {
        name: "타세놀정 500mg",
        route: "PO",
        frequency: "TID",
      },
    ],
    notes: ["인후통 호소", "미열 지속"],
    updated_at: "2026-07-02T09:00:00+09:00",
  };
}

function createSecondRecord(): DemoPatientRecord {
  return {
    patient_id: "P002",
    name: "김영희",
    room_no: "302",
    age: 54,
    sex: "F",
    diagnosis: ["community acquired pneumonia"],
    vitals: {
      systolic: 128,
      diastolic: 76,
      heartrate: 88,
      respiratory: 22,
      saturation: 92,
      body_temperature: 37.8,
    },
    medications: [
      {
        name: "세프트리악손 2g",
        route: "IV",
        frequency: "QD",
      },
    ],
    notes: ["기침과 객담 지속"],
    updated_at: "2026-07-02T09:10:00+09:00",
  };
}

describe("record draft session boundary", () => {
  it("loads only complete fictional record drafts from session storage", () => {
    const validRecord = createValidRecord();
    const storage = memoryStorage({
      [RECORD_DRAFTS_STORAGE_KEY]: JSON.stringify({ P001: validRecord, P999: { patient_id: "P999" } }),
    });

    expect(loadRecordDrafts(storage)).toEqual({ P001: validRecord });
  });

  it("rejects malformed JSON and incomplete or non-numeric record fields", () => {
    const validRecord = createValidRecord();
    const invalidRecord = {
      ...validRecord,
      vitals: { ...validRecord.vitals, body_temperature: "38.2" },
      medications: [{ name: "이부프로펜 400mg", route: "PO", frequency: 3 }],
      notes: ["인후통 호소", null],
    };
    const storage = memoryStorage({
      [RECORD_DRAFTS_STORAGE_KEY]: JSON.stringify({ P001: validRecord, P999: invalidRecord }),
    });

    expect(isDemoPatientRecord(invalidRecord)).toBe(false);
    expect(loadRecordDrafts(storage)).toEqual({ P001: validRecord });
    expect(
      loadRecordDrafts(
        memoryStorage({ [RECORD_DRAFTS_STORAGE_KEY]: "{not valid json" }),
      ),
    ).toEqual({});
  });

  it("rejects blank identity and clinical fields, incomplete or extra vitals, extra keys, and invalid timestamps", () => {
    const validRecord = createValidRecord();
    const recordWithCustomPrototype = Object.assign(Object.create({ inherited: true }), validRecord);
    const incompleteVitals = { ...validRecord.vitals };
    delete incompleteVitals.body_temperature;
    const invalidRecords: unknown[] = [
      { ...validRecord, patient_id: "   " },
      { ...validRecord, name: "" },
      { ...validRecord, room_no: "  " },
      { ...validRecord, sex: "" },
      { ...validRecord, age: Number.NaN },
      { ...validRecord, diagnosis: ["acute pharyngitis", "  "] },
      { ...validRecord, notes: ["인후통 호소", ""] },
      {
        ...validRecord,
        medications: [{ ...validRecord.medications[0]!, route: " " }],
      },
      { ...validRecord, vitals: { ...validRecord.vitals, body_temperature: Number.POSITIVE_INFINITY } },
      { ...validRecord, vitals: incompleteVitals },
      { ...validRecord, vitals: { ...validRecord.vitals, extra_vital: 1 } },
      { ...validRecord, updated_at: "not-a-date" },
      { ...validRecord, updated_at: "2026-07-02" },
      { ...validRecord, updated_at: "July 2, 2026 09:00:00" },
      { ...validRecord, updated_at: "2026-07-02T09:00:00" },
      { ...validRecord, updated_at: "2026-07-02T09:00:00+24:00" },
      { ...validRecord, updated_at: "2026-02-31T09:00:00+09:00" },
      { ...validRecord, extra_field: true },
      recordWithCustomPrototype,
    ];

    for (const invalidRecord of invalidRecords) {
      expect(isDemoPatientRecord(invalidRecord)).toBe(false);
    }

    expect(isDemoPatientRecord({ ...validRecord, updated_at: "2026-07-02T00:00:00Z" })).toBe(true);
    expect(isDemoPatientRecord({ ...validRecord, updated_at: "2026-07-01T19:00:00-05:00" })).toBe(true);
  });

  it("persists a deep copy without changing sibling patient drafts", () => {
    const validRecord = createValidRecord();
    const storage = memoryStorage();

    persistRecordDraft(storage, validRecord);
    validRecord.notes.push("mutated later");
    validRecord.vitals.body_temperature = 39.1;

    expect(loadRecordDrafts(storage).P001?.notes).toEqual(["인후통 호소", "미열 지속"]);
    expect(loadRecordDrafts(storage).P001?.vitals.body_temperature).toBe(38.2);
  });

  it("removes only the requested patient draft", () => {
    const validRecord = createValidRecord();
    const secondRecord = createSecondRecord();
    const storage = memoryStorage({
      [RECORD_DRAFTS_STORAGE_KEY]: JSON.stringify({ P001: validRecord, P002: secondRecord }),
    });

    removeRecordDraft(storage, "P001");

    expect(Object.keys(loadRecordDrafts(storage))).toEqual(["P002"]);
    expect(loadRecordDrafts(storage).P002).toEqual(secondRecord);
  });
});
