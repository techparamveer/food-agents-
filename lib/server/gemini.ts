import "server-only";

/* Minimal Gemini client: one generateContent call with function declarations.
   No SDK, so the demo has no extra dependency and fails soft when the key is missing. */

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";
export const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY);

export async function generate({
  system,
  contents,
  tools,
  timeoutMs = 20_000,
}: {
  system: string;
  contents: GeminiContent[];
  tools?: FunctionDeclaration[];
  timeoutMs?: number;
}): Promise<GeminiPart[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  // GEMINI_BASE_URL is for proxies and local mocks; production talks to Google directly.
  const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
  const res = await fetch(`${base}/v1beta/models/${geminiModel()}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: tools?.length ? [{ functionDeclarations: tools }] : undefined,
      generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: GeminiPart[] } }[] };
  return body.candidates?.[0]?.content?.parts ?? [];
}
