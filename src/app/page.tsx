import { HandoverWorkspace } from "@/components/handover/HandoverWorkspace";
import { buildDemoWorkspaceData } from "@/lib/demo-adapter";
import { demoRecordPairs } from "@/lib/demo-records";

export default function Home() {
  return <HandoverWorkspace data={buildDemoWorkspaceData()} recordPairs={demoRecordPairs} />;
}
