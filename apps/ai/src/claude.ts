// Claude (Anthropic API): one structured-output request per run
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { AiRunRequest, AiRunResponse } from '@shopnex/app'
import { GenerationError, SYSTEM, prompt, type Settings } from './prompts'

export const CLAUDE_MODELS = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5: best writing' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5: fast, strong writing' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5: fastest, lowest cost' },
]

// Shopnex calls with a 60-second budget: answer (or fail) well inside it
const client = (apiKey: string) => new Anthropic({ apiKey, timeout: 50_000, maxRetries: 1 })

/** Checks the key can use the model */
export async function verify(apiKey: string, model: string) {
  await client(apiKey).models.retrieve(model)
}

function explain(error: unknown, model: string): never {
  if (error instanceof Anthropic.AuthenticationError) {
    throw new GenerationError('Anthropic rejected the API key. Enter a new one in the AI app.')
  }
  if (error instanceof Anthropic.PermissionDeniedError || error instanceof Anthropic.NotFoundError) {
    throw new GenerationError(`This API key can't use ${model}. Pick another model in the AI app.`)
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
  const { schema, text } = prompt(request, settings)
  let response
  try {
    response = await client(apiKey).beta.messages.parse({
      model: settings.model,
      max_tokens: 16000,
      // Short marketing copy doesn't need deep thinking
      output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
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
