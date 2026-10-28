// OpenAI (Responses API): one structured-output request per run. Loaded on first use (see ./index).
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { AiRunRequest, AiRunResponse } from '@shopnex/marketplace-sdk/ai'
import { GenerationError, SYSTEM, prompt, type Settings } from './prompts'

// Staff are waiting: one attempt that answers (or fails) within a minute; they can press Try again
const client = (apiKey: string) => new OpenAI({ apiKey, timeout: 55_000, maxRetries: 0 })

/** Checks the key can use the model */
export async function verify(apiKey: string, model: string) {
  await client(apiKey).models.retrieve(model)
}

function explain(error: unknown, model: string): never {
  if (error instanceof OpenAI.AuthenticationError) {
    throw new GenerationError('OpenAI rejected the API key. Enter a new one in Settings → AI.')
  }
  if (error instanceof OpenAI.PermissionDeniedError || error instanceof OpenAI.NotFoundError) {
    throw new GenerationError(`This API key can't use ${model}. Pick another model in Settings → AI.`)
  }
  if (error instanceof OpenAI.RateLimitError) {
    throw new GenerationError(
      'OpenAI is rate limiting this API key (or the account is out of credit). Try again later.',
    )
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    throw new GenerationError('OpenAI took too long to answer. Try again.')
  }
  if (error instanceof OpenAI.APIError) {
    throw new GenerationError(`OpenAI API error${error.status ? ` ${error.status}` : ''}: ${error.message}`)
  }
  throw error
}

export async function run(apiKey: string, settings: Settings, request: AiRunRequest): Promise<AiRunResponse> {
  const { name, schema, text } = prompt(request, settings)
  let response
  try {
    response = await client(apiKey).responses.parse({
      model: settings.model,
      instructions: SYSTEM,
      input: text,
      max_output_tokens: 16000,
      text: { format: zodTextFormat(schema, name) },
      // Nothing to keep on OpenAI's side: every run stands alone
      store: false,
    })
  } catch (error) {
    explain(error, settings.model)
  }

  const refused = response.output.some(
    (item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'),
  )
  if (refused) throw new GenerationError('The model declined to write this.')
  if (response.status === 'incomplete' || !response.output_parsed) {
    throw new GenerationError("The model's answer was cut off or incomplete. Try again.")
  }
  return {
    output: response.output_parsed,
    usage: {
      model: response.model,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    },
  } as AiRunResponse
}
