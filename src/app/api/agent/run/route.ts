import { runAgent } from "@/lib/agent";
import { handle } from "@/lib/http";

export const maxDuration = 60;

export async function POST() {
  return handle(() => runAgent());
}
