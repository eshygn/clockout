import { z } from "zod";
import { handle } from "@/lib/http";
import { retryPayout } from "@/lib/payouts";

const body = z.object({ itemId: z.string(), email: z.string().email().optional() });

export async function POST(req: Request) {
  return handle(async () => {
    const input = body.parse(await req.json());
    return retryPayout(input.itemId, input.email);
  });
}
