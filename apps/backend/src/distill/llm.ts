import { z } from 'zod'
import { SENTIMENTS, SIGNAL_KINDS, type Comment, type Sentiment, type SignalKind } from '@creatorsignal/shared'

const llmResultSchema = z.object({
  results: z.array(
    z.object({
      kind: z.enum(SIGNAL_KINDS),
      topic: z.string().min(1),
      sentiment: z.enum(SENTIMENTS),
    }),
  ),
})

export interface LlmOptions {
  apiKey: string
  baseUrl: string
  model: string
}

/**
 * OpenAI-compatible chat completions client used to distill raw comments into
 * audience signals. When no API key is configured the backend falls back to
 * the deterministic classifier, so the product runs without any external key.
 */
export class LlmClient {
  constructor(private readonly options: LlmOptions) {}

  async classifyBatch(comments: Comment[]): Promise<Array<{ kind: SignalKind; topic: string; sentiment: Sentiment }>> {
    const payload = comments.map((c) => ({
      id: c.id,
      text: c.text,
    }))
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You classify audience comments for a content creator into signals. ' +
              'For each comment return exactly one object: ' +
              '{"kind": "question"|"request"|"topic"|"praise"|"critique", ' +
              '"topic": a short noun phrase (2 to 5 words) naming the subject, ' +
              '"sentiment": "positive"|"negative"|"neutral"}. ' +
              'A question asks something and expects an answer. A request asks for content. ' +
              'Output only a JSON object of the form {"results": [...]} with one entry per comment, in order.',
          },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    })
    if (!response.ok) {
      throw new Error(`llm classify failed: ${response.status} ${await response.text()}`)
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('llm classify returned no content')
    const parsed = llmResultSchema.safeParse(JSON.parse(content))
    if (!parsed.success) throw new Error('llm classify returned malformed JSON')
    return parsed.data.results
  }
}
