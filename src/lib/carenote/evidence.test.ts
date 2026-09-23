import { describe,it,expect } from "vitest";
import { getCareScenario } from "./scenario";
import { getReadinessEvidence } from "./evidence";
import type { ShiftReadinessItem } from "../shift-readiness-contracts";

describe("dated readiness evidence",()=>{
  const records=getCareScenario("P001").records;
  const current=records.at(-1)!;
  const item:ShiftReadinessItem={id:"temperature",patientId:"P001",domain:"patient_status",factStatus:"recent_change",title:"체온",detail:"체온 변경",relevantAt:current.updated_at,ruleCode:"STATUS_PERIOD_CHANGE",sourceRefs:[{recordedAt:current.updated_at,path:"vitals.body_temperature",label:"체온 기록",periodEventId:"event"}]};
  it("resolves exact dated previous and current values",()=>{
    const evidence=getReadinessEvidence(records,item);
    expect(evidence[0].currentValue).toBe("38.2 °C");
    expect(evidence[0].previousValue).toBe("37.9 °C");
    expect(evidence[0].recordedAt).toBe("2026-07-02T09:00:00+09:00");
  });
  it("does not resolve another patient's or missing snapshot's evidence",()=>{
    expect(getReadinessEvidence(getCareScenario("P004").records,item)).toEqual([]);
    expect(getReadinessEvidence(records,{...item,sourceRefs:[{...item.sourceRefs[0],recordedAt:"2000-01-01T09:00:00+09:00"}]})).toEqual([]);
  });
  it("renders a direct device source without leaking JSON",()=>{
    const device=current.devices[0];
    const evidence=getReadinessEvidence(records,{...item,domain:"line_device",sourceRefs:[{recordedAt:current.updated_at,path:`devices[id=${encodeURIComponent(device.id)}]`,label:device.type}]});
    expect(evidence[0].currentValue).toContain(device.site);
    expect(evidence[0].currentValue).not.toContain('"status"');
  });
});
