import { z } from "zod";
import { jumpTo } from "@/lib/clock";
import { handle } from "@/lib/http";

const body = z.object({ step: z.number().int().min(0) });

export async function POST(req: Request) {
  return handle(async () => jumpTo(body.parse(await req.json()).step));
}
