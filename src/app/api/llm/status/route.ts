import { plannerAvailability } from "@/server/agent/planners";
import { json } from "@/server/http";

export const runtime = "nodejs";

/** Which agent planners are usable right now (Ollama health is probed with a 2 s timeout). */
export async function GET() {
  return json(await plannerAvailability());
}
