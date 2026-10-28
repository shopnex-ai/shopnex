export * as aiService from './generations'
export * as aiProviderService from './providers'
export * as aiSettingsService from './builtin'
export { BUILTIN } from './providers'
export type { SettingsInput as AiSettingsInput } from './builtin'
export type { ConfigureInput } from './providers'
export type { RunInput } from './generations'
export { AiError, type AiErrorCode } from './errors'
export {
  AI_BUILTIN_PROVIDERS,
  AI_FEEDBACK,
  type AiBuiltinProvider,
  type AiFeedback,
  type AiGeneration,
} from '@shopnex/db/schema'
export {
  AI_CAPABILITIES,
  aiCapabilities,
  type AiCapability,
  type AiInput,
  type AiOutput,
} from '@shopnex/marketplace-sdk/ai'
