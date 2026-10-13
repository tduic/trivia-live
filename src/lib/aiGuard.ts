import { NextResponse } from "next/server";

// Who may spend Anthropic credits: only the host of a real room (the room id and host secret from the host link,
// checked against the room in Firestore), at most `LIMITS.perRoom` AI calls per room and `LIMITS.perIp` per address
// an hour. Before this, /api/generate and /api/replace answered anyone on the internet.
//
// The counters live in this server instance's memory, so on Vercel they are per instance (a cold start resets them):
// a brake on runaway or scripted use, not an exact quota.

export const LIMITS = { perRoom: 40, perIp: 80, windowMs: 60 * 60 * 1000 };
const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const hits = new Map<string, number[]>();

function take(key: string, limit: number, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < LIMITS.windowMs);
  const ok = recent.length < limit;
  if (ok) recent.push(now);
  hits.set(key, recent);
  return ok;
}

/** Test hook: forget every counter. */
export function resetAiGuard() {
  hits.clear();
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The room's host secret from Firestore (rooms are publicly readable): null when there's no such room,
 *  undefined when it couldn't be checked. */
export async function roomHostSecret(roomId: string): Promise<string | null | undefined> {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!project) return undefined;
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/rooms/` +
    `${encodeURIComponent(roomId)}?mask.fieldPaths=hostSecret` + (key ? `&key=${encodeURIComponent(key)}` : "");
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    const doc = await res.json();
    const secret = doc?.fields?.hostSecret?.stringValue;
    return typeof secret === "string" ? secret : null;
  } catch {
    return undefined;
  }
}

/** null when the request may use the model; otherwise the response to send instead. */
export async function guardAi(req: Request, body: unknown): Promise<NextResponse | null> {
  const b = (body ?? {}) as { roomId?: unknown; hostSecret?: unknown };
  const roomId = typeof b.roomId === "string" ? b.roomId : "";
  const hostSecret = typeof b.hostSecret === "string" ? b.hostSecret : "";
  if (!ROOM_ID.test(roomId) || !hostSecret || hostSecret.length > 128) {
    return NextResponse.json({ error: "Only a room's host can generate questions" }, { status: 401 });
  }
  const now = Date.now();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  if (!take(`ip:${ip}`, LIMITS.perIp, now)) {
    return NextResponse.json({ error: "Too many requests; try again later" }, { status: 429 });
  }
  const secret = await roomHostSecret(roomId);
  if (secret === undefined) {
    return NextResponse.json({ error: "Couldn't verify the room right now; try again" }, { status: 503 });
  }
  if (secret === null || !sameSecret(secret, hostSecret)) {
    return NextResponse.json({ error: "Only a room's host can generate questions" }, { status: 401 });
  }
  if (!take(`room:${roomId}`, LIMITS.perRoom, now)) {
    return NextResponse.json({ error: "This room has used its AI questions for the hour" }, { status: 429 });
  }
  return null;
}

/** Questions to steer away from, bounded so a request can't inflate the prompt (and the bill). */
export function avoidList(v: unknown, max = 50, len = 300): string[] {
  return (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === "string")
    .slice(0, max)
    .map((s) => s.slice(0, len));
}
