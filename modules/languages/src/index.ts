export * as languageService from './languages'
export { LanguageError, type LanguageErrorCode } from './languages.errors'
export type { TranslateInput } from './languages'
export {
  MAX_LANGUAGES,
  TRANSLATABLE_FIELDS,
  isTranslatableField,
  optionNameField,
  optionValueField,
  TRANSLATABLE_RESOURCES,
  type ShopLanguage,
  type TranslatableResource,
  type Translation,
} from './languages.schema'
