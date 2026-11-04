import { seed } from "@/lib/db";
import { handle } from "@/lib/http";

export async function POST() {
  return handle(() => seed());
}
