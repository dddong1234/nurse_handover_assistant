import { CareWorkspace } from "@/components/carenote/CareWorkspace";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string }>;
}) {
  const { module } = await searchParams;
  const initialModule = module === "charting" || module === "records" ? module : "readiness";
  return <CareWorkspace initialModule={initialModule} />;
}
