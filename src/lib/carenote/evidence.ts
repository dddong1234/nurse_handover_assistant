import type { ShiftReadinessItem, ShiftReadinessRecord } from "../shift-readiness-contracts";
import { formatCareTime, VITAL_LABELS } from "./scenario";

export type CareSourceDetail = {id:string;title:string;recordedAt:string;previousValue:string|null;currentValue:string;path:string};

function field(record: ShiftReadinessRecord | undefined, path:string): string | null {
  if (!record) return null;
  if (path.startsWith("vitals.")) {
    const key=path.slice(7), value=record.vitals[key];
    return typeof value === "number" ? `${value} ${VITAL_LABELS[key]?.unit ?? ""}`.trim() : null;
  }
  const direct=/^(investigations|devices|medications|handoffRequests)\[(id|name)=([^\]]+)\]$/.exec(path);
  if (direct) {
    let selector:string;
    try { selector=decodeURIComponent(direct[3]); } catch { return null; }
    if (direct[1]==="investigations") {
      const value=record.investigations.find(v=>v.id===selector);
      return value ? [value.name,value.resultSummary ?? "결과 기록 없음",value.scheduledAt ? `예정 ${formatCareTime(value.scheduledAt,true)}`:null,value.resultedAt ? `결과 ${formatCareTime(value.resultedAt,true)}`:null].filter(Boolean).join(" · ") : null;
    }
    if (direct[1]==="devices") {
      const value=record.devices.find(v=>v.id===selector);
      return value ? [value.type,value.site,{active:"유지 중",removal_ordered:"제거 지시",removed:"제거 기록"}[value.status],value.changeDueAt ? `교체 예정 ${formatCareTime(value.changeDueAt,true)}`:null].filter(Boolean).join(" · ") : null;
    }
    if (direct[1]==="medications") {
      const value=record.medications.find(v=>v.name===selector);
      return value ? [value.name,value.route,value.frequency,{planned:"예정",active:"적용 중",stopped:"중단"}[value.orderStatus],value.effectiveFrom ? `적용 ${formatCareTime(value.effectiveFrom,true)}`:null].filter(Boolean).join(" · ") : null;
    }
    const value=record.handoffRequests.find(v=>v.id===selector);
    return value ? [value.topic,{open:"전달 요청",communicated:"전달 기록 있음",cancelled:"취소"}[value.status],formatCareTime(value.requestedAt,true)].join(" · ") : null;
  }
  const quoted=/^(notes|diagnosis|medications)\[("(?:[^"\\]|\\.)*")\]$/.exec(path);
  if (!quoted) return null;
  let key:string;
  try { key=JSON.parse(quoted[2]); } catch { return null; }
  if (quoted[1]==="notes") return record.notes.includes(key) ? key : null;
  if (quoted[1]==="diagnosis") return record.diagnosis.includes(key) ? key : null;
  const med=record.medications.find(value=>value.name===key);
  return med ? `${med.name} · ${med.route} · ${med.frequency}` : null;
}

export function getReadinessEvidence(records: ShiftReadinessRecord[], item: ShiftReadinessItem): CareSourceDetail[] {
  if (!records.length || records.some(r=>r.patient_id!==item.patientId)) return [];
  const sorted=[...records].sort((a,b)=>Date.parse(a.updated_at)-Date.parse(b.updated_at));
  return item.sourceRefs.flatMap((source,index)=>{
    const at=sorted.findIndex(r=>Date.parse(r.updated_at)===Date.parse(source.recordedAt));
    if (at<0) return [];
    const currentValue=field(sorted[at],source.path);
    const previousValue=source.periodEventId ? field(sorted[at-1],source.path) : null;
    if (currentValue===null && previousValue===null) return [];
    return [{id:`${item.id}:source:${index}`,title:source.label,recordedAt:source.recordedAt,previousValue:source.periodEventId ? previousValue ?? "이전 기록 없음" : null,currentValue:currentValue ?? "현재 기록 없음",path:source.path}];
  });
}
