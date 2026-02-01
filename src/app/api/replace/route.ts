import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON found");
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const body = await req.json().catch(() => ({}));
  const avoid = Array.isArray(body?.avoid) ? body.avoid : [];
  const isFinale = body?.index === 9; // Question 10 is index 9

  const prompt = `Generate ONE trivia question with a short answer.

Difficulty Target: ${isFinale ? "8-9/10 difficulty - difficult and prestigious, require deeper knowledge and be more difficult than regular questions." : "7/10 difficulty - moderately challenging, require solid knowledge but not highly specialized expertise. Focus on interesting facts that aren't common knowledge but are accessible to knowledgeable players."}

Constraints:
- Include some specific details, dates, or lesser-known information, but keep it accessible to intermediate/advanced players
- Answer should be short (ideally 1-5 words). No essays.
- No trick questions, no ambiguity. Answer must be factually verifiable and specific.
- Target intermediate to advanced trivia players - challenging but fair.

Avoid these questions (do not repeat them):
${avoid.map((q: string) => `- ${q}`).join("\n")}

Return ONLY valid JSON with this exact shape:
{ "question": { "question": "...", "answer": "...", "category": "..." } }`;

  const modelEnv = String(process.env.ANTHROPIC_MODEL || "");
  const allowedModels = ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"] as const;
  const model = (allowedModels as readonly string[]).includes(modelEnv) ? modelEnv : "claude-sonnet-4-20250514";

  const resp = await client.messages.create({
    model,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }]
  });

  const textBlock = resp.content.find(block => block.type === "text");
  const text = (textBlock && textBlock.type === "text" ? textBlock.text : "").trim();

  try {
    const data = extractJson(text);
    if (!data?.question?.question || !data?.question?.answer) throw new Error("Bad shape");
    return NextResponse.json({ question: data.question });
  } catch (e: any) {
    console.error("Replace API error:", e);
    console.error("Raw response:", text);
    return NextResponse.json(
      { error: `Failed to parse model output: ${e?.message}`, raw: text.slice(0, 500) },
      { status: 500 }
    );
  }
}
