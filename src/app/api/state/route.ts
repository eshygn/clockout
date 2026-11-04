import { NextResponse } from "next/server";
import { payouts } from "@/lib/paypal";
import { appState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  await payouts(); // resolves live vs mock once, so the status chip is accurate on first paint
  return NextResponse.json(appState());
}
