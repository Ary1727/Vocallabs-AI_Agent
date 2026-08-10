export interface LlmCallResult {
  text: string;
  stubbed: boolean;
}

/**
 * Calls Groq's OpenAI-compatible chat completions endpoint if GROQ_API_KEY
 * is set. Otherwise falls back to a stubbed response with an artificial
 * delay — explicitly allowed by the assignment spec ("if you can't get
 * access, a stubbed call with a disclosed artificial delay is fine").
 * The stub is never silently indistinguishable from a real call:
 * `stubbed: true` is returned alongside the text, and callers (see
 * stepExecutor.ts) record that flag into step_runs.output so it's visible
 * in the trace, not hidden.
 */
export async function callLlm(prompt: string): Promise<LlmCallResult> {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    const artificialDelayMs = 800;
    await new Promise((resolve) => setTimeout(resolve, artificialDelayMs));
    return {
      text: `[stubbed response — no GROQ_API_KEY configured] Echoing prompt: ${prompt.slice(0, 200)}`,
      stubbed: true,
    };
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Groq API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('Groq API returned no completion text.');
  }

  return { text, stubbed: false };
}
