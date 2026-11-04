import { z } from "zod";
import { handle } from "@/lib/http";
import { approveAndPay } from "@/lib/payouts";

const body = z.object({ shiftIds: z.array(z.string()).min(1) });

export async function POST(req: Request) {
  return handle(async () => approveAndPay(body.parse(await req.json()).shiftIds, "Approved hours"));
}
