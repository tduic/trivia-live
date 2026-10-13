import { NextResponse } from "next/server";

// Evaluate per request: a static (build-time) response would report the
// build environment's key, not the running deployment's.
export const dynamic = "force-dynamic";

export async function GET() {
  // Presence only — never echo the key itself.
  return NextResponse.json({ ok: true, hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY });
}
