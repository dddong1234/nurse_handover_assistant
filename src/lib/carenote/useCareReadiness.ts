"use client";

import { useEffect,useMemo,useRef,useState } from "react";
import { requestShiftReadiness } from "../shift-readiness-api";
import type { ShiftReadinessResponse } from "../shift-readiness-contracts";
import { createCurrentRecordFingerprint } from "@/components/handover/useReturnHandover";
import { projectSessionRecords } from "./session";
import type { CareScenario } from "./scenario";
import type { CareNote } from "./types";

type Result={key:string;identity:string;response:ShiftReadinessResponse|null;error:boolean;responseKey:string;attempt:number};

export function useCareReadiness(scenario: CareScenario, notes:CareNote[], reviewStartAt:string) {
  const records=useMemo(()=>projectSessionRecords(scenario,notes),[scenario,notes]);
  const identity=`${scenario.version}:${scenario.patient.id}:${scenario.patient.encounterId}`;
  const reviewKey=`${identity}:${reviewStartAt}:${createCurrentRecordFingerprint({records,shift:scenario.shift})}`;
  const [result,setResult]=useState<Result|null>(null);
  const [attempt,setAttempt]=useState(0);
  const resultRef=useRef(result);
  const inputRef=useRef({records,scenario,reviewStartAt});
  useEffect(()=>{resultRef.current=result;},[result]);
  useEffect(()=>{inputRef.current={records,scenario,reviewStartAt};},[records,scenario,reviewStartAt]);
  useEffect(()=>{
    let active=true;
    const controller=new AbortController();
    const input=inputRef.current;
    const timeout=setTimeout(()=>controller.abort(),20_000);
    requestShiftReadiness({records:input.records,reviewStartAt:input.reviewStartAt,shift:input.scenario.shift,coverageGaps:[...input.scenario.coverageGaps]},{signal:controller.signal})
      .then(response=>{
        if (!active) return;
        setResult({key:reviewKey,identity,response,error:false,responseKey:reviewKey,attempt});
      })
      .catch(()=>{
        if (!active) return;
        const previous=resultRef.current;
        setResult({key:reviewKey,identity,response:previous?.identity===identity ? previous.response : null,error:true,responseKey:previous?.identity===identity ? previous.responseKey : "",attempt});
      })
      .finally(()=>clearTimeout(timeout));
    return ()=>{active=false;clearTimeout(timeout);controller.abort();};
  },[reviewKey,identity,attempt]);
  const response=result?.identity===identity ? result.response : null;
  const pending=result?.key!==reviewKey || result?.attempt!==attempt;
  const status: "loading"|"error"|"success"=pending ? "loading" : result?.error ? "error" : "success";
  return {response,status,stale:!!response && (result?.responseKey!==reviewKey || status!=="success"),retry:()=>setAttempt(n=>n+1),reviewKey,records};
}
