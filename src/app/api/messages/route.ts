import { z } from "zod";
import { handle } from "@/lib/http";
import { addMessage, getWorker, now } from "@/lib/repo";

const body = z.object({ workerId: z.string(), body: z.string().trim().min(2).max(500) });

/** A worker's text arriving (in the demo, typed by the owner on the worker's behalf). */
export async function POST(req: Request) {
  return handle(async () => {
    const input = body.parse(await req.json());
    if (!getWorker(input.workerId)) throw new Error("Unknown worker");
    const id = `m_${Date.now().toString(36)}`;
    addMessage({ id, workerId: input.workerId, body: input.body, receivedAt: now(), processedAt: null, summary: null });
    return { id };
  });
}
