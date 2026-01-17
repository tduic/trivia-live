import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON found");
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
  }

  const prompt = `Generate 10 medium-difficulty trivia questions with answers.

Constraints:
- Diverse categories: history, geography, sports, pop culture, science, literature, movies/TV, music.
- Each answer should be short (ideally 1-5 words). No essays.
- No trick questions, no ambiguity.
- Do NOT repeat the same category more than 2 times.

Return ONLY valid JSON with this exact shape:
{
  "questions": [
    { "question": "...", "answer": "...", "category": "..." },
    ... (10 total)
  ]
}
`;

  const resp = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: prompt,
    max_output_tokens: 1200
  });

  const text = (resp.output_text || "").trim();

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
