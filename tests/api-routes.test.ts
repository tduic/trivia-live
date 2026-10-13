import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Anthropic client is replaced so no request ever leaves the process.
const anthropic = vi.hoisted(() => ({ create: vi.fn(), ctorArgs: [] as unknown[] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropic.create };
    constructor(opts: unknown) {
      anthropic.ctorArgs.push(opts);
    }
  },
}));

import { POST as generate } from "@/app/api/generate/route";
import { POST as replace } from "@/app/api/replace/route";
import { GET as health, dynamic as healthDynamic } from "@/app/api/health/route";
import { LIMITS, avoidList, resetAiGuard } from "@/lib/aiGuard";

// Firestore's REST endpoint, faked: room ROOM1's host secret is "s3cret"; any other room doesn't exist.
const firestore = vi.hoisted(() => ({ fail: false, calls: [] as string[] }));
const HOST = { roomId: "ROOM1", hostSecret: "s3cret" };
const genReq = (body: unknown = HOST, ip = "203.0.113.7") =>
  new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });

const textReply = (text: string) => ({ content: [{ type: "text", text }] });
const tenQuestions = (overrides: Record<number, object> = {}) =>
  Array.from({ length: 10 }, (_, i) => ({
    question: ` Q${i + 1}? `,
    answer: ` A${i + 1} `,
    category: i === 3 ? "" : `Cat${i + 1}`,
    ...overrides[i],
  }));

beforeEach(() => {
  anthropic.create.mockReset();
  anthropic.ctorArgs.length = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  vi.stubEnv("ANTHROPIC_MODEL", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-project");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "public-web-key");
  resetAiGuard();
  firestore.fail = false;
  firestore.calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    firestore.calls.push(String(url));
    if (firestore.fail) return new Response("unavailable", { status: 503 });
    if (String(url).includes("/documents/rooms/ROOM1?")) {
      return Response.json({ fields: { hostSecret: { stringValue: "s3cret" } } });
    }
    return new Response("{}", { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/generate", () => {
  it("returns 500 when the API key is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await generate(genReq());
    expect(res.status).toBe(500);
    expect(anthropic.create).not.toHaveBeenCalled();
  });

  it("normalizes ten questions out of a chatty reply", async () => {
    anthropic.create.mockResolvedValue(
      textReply(`Sure! Here you go:\n${JSON.stringify({ questions: tenQuestions() })}\nEnjoy.`),
    );
    const res = await generate(genReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions).toHaveLength(10);
    expect(body.questions[0]).toEqual({ question: "Q1?", answer: "A1", category: "Cat1", id: "1" });
    expect(body.questions[3].category).toBe("General");
    expect(body.questions[9].id).toBe("10");
  });

  it("uses the default model unless an allowed override is configured", async () => {
    anthropic.create.mockResolvedValue(textReply(JSON.stringify({ questions: tenQuestions() })));
    vi.stubEnv("ANTHROPIC_MODEL", "some-unknown-model");
    await generate(genReq());
    expect(anthropic.create.mock.calls[0][0].model).toBe("claude-sonnet-4-20250514");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-3-haiku-20240307");
    await generate(genReq());
    expect(anthropic.create.mock.calls[1][0].model).toBe("claude-3-haiku-20240307");
  });

  it.each([
    ["no JSON at all", "I cannot help with that."],
    ["wrong count", JSON.stringify({ questions: tenQuestions().slice(0, 9) })],
    ["blank answer", JSON.stringify({ questions: tenQuestions({ 2: { answer: "  " } }) })],
  ])("returns 500 with the raw text on %s", async (_label, text) => {
    anthropic.create.mockResolvedValue(textReply(text));
    const res = await generate(genReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to parse model output");
    expect(body.raw).toBe(text.slice(0, 2000));
  });
});

describe("POST /api/replace", () => {
  const req = (body: unknown) =>
    new Request("http://localhost/api/replace", { method: "POST", body: JSON.stringify({ ...HOST, ...(body as object) }) });

  it("returns a single replacement question and lists questions to avoid", async () => {
    const q = { question: "What is 2+2?", answer: "4", category: "Math" };
    anthropic.create.mockResolvedValue(textReply(JSON.stringify({ question: q })));
    const res = await replace(req({ avoid: ["Old question one", "Old question two"], index: 2 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ question: q });
    const prompt = anthropic.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("- Old question one\n- Old question two");
    expect(prompt).toContain("7/10 difficulty");
  });

  it("asks for a harder question for the final slot", async () => {
    anthropic.create.mockResolvedValue(textReply(JSON.stringify({ question: { question: "q", answer: "a" } })));
    await replace(req({ index: 9 }));
    expect(anthropic.create.mock.calls[0][0].messages[0].content).toContain("8-9/10 difficulty");
  });

  it("treats an unparsable request body as unauthenticated", async () => {
    const res = await replace(new Request("http://localhost/api/replace", { method: "POST", body: "not json" }));
    expect(res.status).toBe(401);
    expect(anthropic.create).not.toHaveBeenCalled();
  });

  it("caps the questions-to-avoid list so a request can't inflate the prompt", async () => {
    anthropic.create.mockResolvedValue(textReply(JSON.stringify({ question: { question: "q", answer: "a" } })));
    const huge = Array.from({ length: 5000 }, (_, i) => `q${i} ` + "x".repeat(10_000));
    await replace(req({ avoid: [...huge, 42, null] }));
    const prompt = anthropic.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt.length).toBeLessThan(50 * 320 + 3000);
    expect(avoidList(["a", 1, "b"])).toEqual(["a", "b"]);
  });

  it("returns 500 on a malformed model reply", async () => {
    anthropic.create.mockResolvedValue(textReply(JSON.stringify({ question: { question: "q" } })));
    const res = await replace(req({}));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Bad shape");
  });
});

describe("who can spend Anthropic credits", () => {
  const ok = () => anthropic.create.mockResolvedValue(textReply(JSON.stringify({ questions: tenQuestions() })));

  it.each([
    ["no room or secret", {}],
    ["a wrong secret", { roomId: "ROOM1", hostSecret: "guess" }],
    ["a room that doesn't exist", { roomId: "NOPE42", hostSecret: "s3cret" }],
    ["a malformed room id", { roomId: "../rooms/ROOM1", hostSecret: "s3cret" }],
  ])("refuses %s without calling the model", async (_label, body) => {
    ok();
    const res = await generate(genReq(body));
    expect(res.status).toBe(401);
    expect(anthropic.create).not.toHaveBeenCalled();
  });

  it("lets the room's host through, checking the room in Firestore", async () => {
    ok();
    const res = await generate(genReq());
    expect(res.status).toBe(200);
    expect(firestore.calls[0]).toContain("projects/demo-project/databases/(default)/documents/rooms/ROOM1?mask.fieldPaths=hostSecret");
  });

  it("answers 503, not 200, when the room can't be checked", async () => {
    ok();
    firestore.fail = true;
    expect((await generate(genReq())).status).toBe(503);
    expect(anthropic.create).not.toHaveBeenCalled();
  });

  it("limits AI calls per room and per address", async () => {
    ok();
    for (let i = 0; i < LIMITS.perRoom; i++) expect((await generate(genReq(HOST, `198.51.100.${i % 200}`))).status).toBe(200);
    expect((await generate(genReq(HOST, "192.0.2.1"))).status).toBe(429);
    resetAiGuard();
    for (let i = 0; i < LIMITS.perIp; i++) await generate(genReq({ roomId: "NOPE42", hostSecret: "x" }, "192.0.2.9"));
    expect((await generate(genReq(HOST, "192.0.2.9"))).status).toBe(429);
  });
});

describe("GET /api/health", () => {
  it("reports ok", async () => {
    const res = await health();
    expect((await res.json()).ok).toBe(true);
  });

  it("reports whether the Anthropic key is set, as a boolean only", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-secret-value");
    const res = await health();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, hasAnthropicKey: true });
    expect(text).not.toContain("sk-ant-secret-value");

    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai");
    expect(await (await health()).json()).toEqual({ ok: true, hasAnthropicKey: false });
    vi.unstubAllEnvs();
  });

  it("is rendered per request, not prerendered at build time", () => {
    expect(healthDynamic).toBe("force-dynamic");
  });
});
