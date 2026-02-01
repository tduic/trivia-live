import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON found");
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Generate 10 trivia questions with answers. Question 10 will be used as the Final Jeopardy question.

Difficulty Target:
- Questions 1-9: 7/10 difficulty - moderately challenging, require solid knowledge but not highly specialized expertise. Focus on interesting facts that aren't common knowledge but are accessible to knowledgeable players.
- Question 10 (Final Jeopardy): 8-9/10 difficulty - difficult and prestigious, require deeper knowledge and be more difficult than regular questions.

Constraints:
- Diverse categories: history, geography, sports, pop culture, science, literature, movies/TV, music, academia.
- Include some specific details, dates, or lesser-known information, but keep it accessible to intermediate/advanced players
- Each answer should be short (ideally 1-5 words). No essays.
- No trick questions, no ambiguity. Answers must be factually verifiable and specific.
- Do NOT repeat the same category more than once.
- Target intermediate to advanced trivia players - challenging but fair.
- IMPORTANT: Question 10 should have a SPECIFIC subject category (like "American History", "World Geography", "Classical Music", etc.), NOT a generic category like "Final Jeopardy" or "General Knowledge".

Return ONLY valid JSON with this exact shape:
{
  "questions": [
    { "question": "...", "answer": "...", "category": "..." },
    ... (10 total, with question 10 being the Final Jeopardy)
  ]
}`;

  const modelEnv = String(process.env.ANTHROPIC_MODEL || "");
  const allowedModels = ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"] as const;
  const model = (allowedModels as readonly string[]).includes(modelEnv) ? modelEnv : "claude-sonnet-4-20250514";

  const resp = await client.messages.create({
    model,
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }]
  });

  const textBlock = resp.content.find(block => block.type === "text");
  const text = (textBlock && textBlock.type === "text" ? textBlock.text : "").trim();

  try {
    const data = extractJson(text);
    const qs = data?.questions;
    if (!Array.isArray(qs) || qs.length !== 10) throw new Error("Bad questions array");
    const normalized = qs.map((q: any, i: number) => ({
      question: String(q.question ?? "").trim(),
      answer: String(q.answer ?? "").trim(),
      category: String(q.category ?? "").trim() || "General",
      id: String(i + 1)
    }));
    if (normalized.some((q: any) => !q.question || !q.answer)) throw new Error("Empty question/answer");
    return NextResponse.json({ questions: normalized });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to parse model output", raw: text.slice(0, 2000), details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
