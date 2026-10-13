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
import { GET as health } from "@/app/api/health/route";

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
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/generate", () => {
  it("returns 500 when the API key is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await generate();
    expect(res.status).toBe(500);
    expect(anthropic.create).not.toHaveBeenCalled();
  });

  it("normalizes ten questions out of a chatty reply", async () => {
    anthropic.create.mockResolvedValue(
      textReply(`Sure! Here you go:\n${JSON.stringify({ questions: tenQuestions() })}\nEnjoy.`),
    );
    const res = await generate();
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
    await generate();
    expect(anthropic.create.mock.calls[0][0].model).toBe("claude-sonnet-4-20250514");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-3-haiku-20240307");
    await generate();
    expect(anthropic.create.mock.calls[1][0].model).toBe("claude-3-haiku-20240307");
  });

  it.each([
    ["no JSON at all", "I cannot help with that."],
    ["wrong count", JSON.stringify({ questions: tenQuestions().slice(0, 9) })],
    ["blank answer", JSON.stringify({ questions: tenQuestions({ 2: { answer: "  " } }) })],
  ])("returns 500 with the raw text on %s", async (_label, text) => {
    anthropic.create.mockResolvedValue(textReply(text));
    const res = await generate();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to parse model output");
    expect(body.raw).toBe(text.slice(0, 2000));
  });
});

describe("POST /api/replace", () => {
  const req = (body: unknown) =>
    new Request("http://localhost/api/replace", { method: "POST", body: JSON.stringify(body) });

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

  it("tolerates an unparsable request body", async () => {
    anthropic.create.mockResolvedValue(textReply(JSON.stringify({ question: { question: "q", answer: "a" } })));
    const res = await replace(new Request("http://localhost/api/replace", { method: "POST", body: "not json" }));
    expect(res.status).toBe(200);
  });

  it("returns 500 on a malformed model reply", async () => {
    anthropic.create.mockResolvedValue(textReply(JSON.stringify({ question: { question: "q" } })));
    const res = await replace(req({}));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Bad shape");
  });
});

describe("GET /api/health", () => {
  it("reports ok", async () => {
    const res = await health();
    expect((await res.json()).ok).toBe(true);
  });
});
