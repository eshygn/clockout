import { handle } from "@/lib/http";
import { refreshPayouts } from "@/lib/payouts";

export async function POST() {
  return handle(() => refreshPayouts());
}
