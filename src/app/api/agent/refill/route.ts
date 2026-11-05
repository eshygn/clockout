import { z } from "zod";
import { dropAndRefill } from "@/lib/agent";
import { handle } from "@/lib/http";

const body = z.object({ shiftId: z.string() });

/** Owner right-clicks a booked shift: drop the worker and let the agent find cover. */
export async function POST(req: Request) {
  return handle(async () => dropAndRefill(body.parse(await req.json()).shiftId));
}
