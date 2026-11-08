import { PageHeader } from "@/components/primitives";
import { getCurrentUser } from "@/server/app-context";
import { policyState } from "@/server/queries";
import { PolicyStudio } from "./policy-studio";

export const metadata = { title: "Policy Studio" };

export default async function PoliciesPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { versions, activeVersion } = await policyState();
  return (
    <>
      <PageHeader
        title="Policy Studio"
        description="Deterministic rules evaluated before every tool call. Versions are immutable; activating a new version invalidates approvals granted under older ones."
      />
      <PolicyStudio
        canEdit={user.role !== "member"}
        activeVersion={activeVersion}
        versions={versions.map((v) => ({
          version: v.version,
          document: v.document,
          changeNote: v.changeNote,
          createdBy: v.createdBy,
          createdAt: v.createdAt.toISOString(),
          hash: v.documentHash,
        }))}
      />
    </>
  );
}
