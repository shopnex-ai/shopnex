// Claude (Anthropic API): one structured-output request per run. Loaded on first use (see ./index).
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { AiRunRequest, AiRunResponse } from '@shopnex/marketplace-sdk/ai'
import { GenerationError, SYSTEM, prompt, type Settings } from './prompts'

// Staff are waiting: one attempt that answers (or fails) within a minute; they can press Try again
const client = (apiKey: string) => new Anthropic({ apiKey, timeout: 55_000, maxRetries: 0 })

/** Checks the key can use the model */
export async function verify(apiKey: string, model: string) {
  await client(apiKey).models.retrieve(model)
}

function explain(error: unknown, model: string): never {
  if (error instanceof Anthropic.AuthenticationError) {
    throw new GenerationError('Anthropic rejected the API key. Enter a new one in Settings → AI.')
  }
  if (error instanceof Anthropic.PermissionDeniedError || error instanceof Anthropic.NotFoundError) {
    throw new GenerationError(`This API key can't use ${model}. Pick another model in Settings → AI.`)
  }
  if (error instanceof Anthropic.RateLimitError) {
    throw new GenerationError('Anthropic is rate limiting this API key. Try again in a minute.')
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    throw new GenerationError('Claude took too long to answer. Try again.')
  }
  if (error instanceof Anthropic.APIError) {
    throw new GenerationError(`Anthropic API error${error.status ? ` ${error.status}` : ''}: ${error.message}`)
  }
  throw error
}

export async function run(apiKey: string, settings: Settings, request: AiRunRequest): Promise<AiRunResponse> {
  const { schema, text, maxTokens, images } = prompt(request, settings)
  let response
  try {
    response = await client(apiKey).beta.messages.parse({
      model: settings.model,
      max_tokens: maxTokens,
      // Short marketing copy doesn't need deep thinking
      output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((url) => ({ type: 'image' as const, source: { type: 'url' as const, url } })),
            { type: 'text' as const, text },
          ],
        },
      ],
      // A declined request is retried on the model Anthropic recommends (Haiku has no server-side fallback)
      ...(!settings.model.startsWith('claude-haiku') && {
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default' as const,
      }),
    })
  } catch (error) {
    explain(error, settings.model)
  }

  if (response.stop_reason === 'refusal') throw new GenerationError('Claude declined to write this.')
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new GenerationError("Claude's answer was cut off or incomplete. Try again.")
  }
  return {
    output: response.parsed_output,
    usage: {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  } as AiRunResponse
}
