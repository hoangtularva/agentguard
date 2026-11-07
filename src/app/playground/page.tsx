import { PageHeader } from "@/components/primitives";
import { llmConfigured } from "@/server/agent/claude-planner";
import { listCorpus } from "@/server/queries";
import { Playground } from "./playground";

export const metadata = { title: "Agent Playground" };

export default async function PlaygroundPage() {
  const corpus = await listCorpus();
  return (
    <>
      <PageHeader
        title="Agent Playground"
        description="Give the agent a task and a mandate. Every tool call it proposes is checked by the Policy Enforcement Point before anything runs. Tools are mocks: nothing leaves the sandbox."
      />
      <Playground corpus={corpus} llmAvailable={llmConfigured()} />
    </>
  );
}
