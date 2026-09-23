import { act,renderHook,waitFor } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";
import { useCareReadiness } from "./useCareReadiness";
import { getCareScenario } from "./scenario";
import { appendSessionNote } from "./session";
import { createValidShiftReadinessResponse } from "@/test/shift-readiness-fixtures";

afterEach(()=>vi.unstubAllGlobals());
describe("CareNote response ownership",()=>{
  it("retains a prior same-patient result as stale when updated notes cannot be compared",async()=>{
    const response=createValidShiftReadinessResponse();
    const fetchMock=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>response}).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch",fetchMock);
    const scenario=getCareScenario("P001");
    const notes=appendSessionNote(scenario,[],{narrative:"새 간호메모",recordedAt:"2026-07-02T10:00:00+09:00",category:"일반",sourceEvidenceIds:[]});
    const {result,rerender}=renderHook(({activeNotes})=>useCareReadiness(scenario,activeNotes,scenario.reviewStartAt),{initialProps:{activeNotes:[] as typeof notes}});
    await waitFor(()=>expect(result.current.status).toBe("success"));
    rerender({activeNotes:notes});
    await waitFor(()=>expect(result.current.status).toBe("error"));
    expect(result.current.stale).toBe(true);
    expect(result.current.response?.patient.id).toBe("P001");
    expect(result.current.records.at(-1)?.notes).toContain("새 간호메모");
  });
  it("hides previous-patient results immediately and ignores the delayed request",async()=>{
    let resolveFirst!:(value:unknown)=>void;
    const fetchMock=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolveFirst=r;})).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch",fetchMock);
    const a=getCareScenario("P001"),b=getCareScenario("P004");
    const {result,rerender}=renderHook(({scenario})=>useCareReadiness(scenario,[],scenario.reviewStartAt),{initialProps:{scenario:a}});
    rerender({scenario:b});
    await act(async()=>resolveFirst({ok:true,json:async()=>createValidShiftReadinessResponse()}));
    await waitFor(()=>expect(result.current.status).toBe("error"));
    expect(result.current.response).toBeNull();
  });
});
