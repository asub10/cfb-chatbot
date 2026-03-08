import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `\
You are a college football assistant. You will receive a user question and a \
JSON object containing verified facts retrieved from an authoritative database.

Your job is to rephrase those facts into a single, concise, natural-language answer.

Rules:
- Use ONLY the information in the provided JSON. Do not add context, stats, or \
  facts from your own knowledge.
- If the JSON signals that data is missing or ambiguous, say so clearly and briefly.
- Keep your answer to 1–3 sentences.
- Do not generate SQL, code, or markdown formatting.
- Do not say "Based on the data" or similar meta-phrases — just answer directly.`;

/**
 * Streams a natural-language answer formatted from structured facts.
 * Yields token strings as they arrive from the model.
 */
export async function* streamFormattedReply(
  question: string,
  data: unknown
): AsyncGenerator<string> {
  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Question: ${question}\n\nFacts: ${JSON.stringify(data, null, 2)}`,
      },
    ],
    max_tokens: 150,
    temperature: 0.2,
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) yield text;
  }
}
