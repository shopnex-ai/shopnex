// OpenAI (Responses API): one structured-output request per run
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { AiRunRequest, AiRunResponse } from '@shopnex/app'
import { GenerationError, SYSTEM, prompt, type Settings } from './prompts'

// Any model the key can use works (checked on save); this is only what a new setup starts with
export const OPENAI_DEFAULT_MODEL = 'gpt-6.1-sol'

// Shopnex calls with a 60-second budget: answer (or fail) well inside it
const client = (apiKey: string) => new OpenAI({ apiKey, timeout: 50_000, maxRetries: 1 })

/** Checks the key can use the model */
export async function verify(apiKey: string, model: string) {
  await client(apiKey).models.retrieve(model)
}

function explain(error: unknown, model: string): never {
  if (error instanceof OpenAI.AuthenticationError) {
    throw new GenerationError('OpenAI rejected the API key. Enter a new one in the AI app.')
  }
  if (error instanceof OpenAI.PermissionDeniedError || error instanceof OpenAI.NotFoundError) {
    throw new GenerationError(`This API key can't use ${model}. Pick another model in the AI app.`)
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
