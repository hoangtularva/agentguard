import { hashCanonical } from "./canonical";

/**
 * An approval is valid for exactly ONE concrete action. The binding hash commits to
 * everything that defines that action. Changing any field — arguments, user, agent,
 * session, tool, or the policy version it was evaluated under — changes the hash and
 * invalidates the approval.
 */
export interface ApprovalBindingInput {
  toolCallId: string;
  sessionId: string;
  userId: string;
  agentId: string;
  tool: string;
  args: unknown;
  policyId: string;
  policyVersion: number;
}

export function computeBindingHash(b: ApprovalBindingInput): string {
  return hashCanonical({
    v: 1,
    toolCallId: b.toolCallId,
    sessionId: b.sessionId,
    userId: b.userId,
    agentId: b.agentId,
    tool: b.tool,
    args: b.args,
    policyId: b.policyId,
    policyVersion: b.policyVersion,
  });
}
