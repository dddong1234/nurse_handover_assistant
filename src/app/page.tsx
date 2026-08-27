import { HandoverWorkspace } from "@/components/handover/HandoverWorkspace";
import { buildDemoWorkspaceData } from "@/lib/demo-adapter";

export default function Home() {
  return <HandoverWorkspace data={buildDemoWorkspaceData()} />;
}
