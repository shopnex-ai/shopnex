import { ORPCError } from '@orpc/server'
import { z } from 'zod'
import { db } from '@shopnex/db'
import { createProcedures } from '@shopnex/rpc'
import {
  languageInput,
  languagesOutput,
  translationInput,
  translationOutput,
  translationStatusOutput,
  translationStatusQuery,
  translationsQuery,
} from './languages.contract'
import * as languageService from './languages'

const { scoped, shopManager } = createProcedures()

const read = scoped('read_translations')
const write = scoped('write_translations')

// The languages a shop publishes (shaping them is shop settings, so owners and admins only; anyone allowed to read
// translations can see which languages there are) and the translations of its store content
export const languages = {
  list: read
    .route({ method: 'GET', path: '/admin/languages' })
    .output(languagesOutput)
    .handler(({ context }) => languageService.list(context.shop.id, db)),

  publish: shopManager
    .route({ method: 'POST', path: '/admin/languages' })
    .output(languagesOutput)
    .input(languageInput)
    .handler(({ input, context }) => languageService.publish(context.shop.id, input.code, db)),

  // Keeps the translations: publishing the language again brings them back
  unpublish: shopManager
    .route({ method: 'DELETE', path: '/admin/languages/{code}' })
    .output(languagesOutput)
    .input(languageInput)
    .handler(({ input, context }) => languageService.unpublish(context.shop.id, input.code, db)),

  translations: {
    list: read
      .route({ method: 'GET', path: '/admin/translations' })
      .output(z.array(translationOutput))
      .input(translationsQuery)
      .handler(({ input, context }) =>
        languageService.translationsOf(context.shop.id, input.resource, input.resourceId, input.language, db),
      ),

    // Which fields of every record of one kind are translated into a language, by the fingerprint of the text they were
    // translated from (the admin compares it with the record's text now)
    status: read
      .route({ method: 'GET', path: '/admin/translations/status' })
      .output(translationStatusOutput)
      .input(translationStatusQuery)
      .handler(({ input, context }) => languageService.statusOf(context.shop.id, input.resource, input.language, db)),

    // An empty value removes the translation; answers the stored translation, or null when it was removed
    set: write
      .route({ method: 'PUT', path: '/admin/translations' })
      .output(translationOutput.nullable())
      .input(translationInput)
      .handler(async ({ input, context }) => {
        const row = await languageService.translate(context.shop.id, input, db)
        if (!row && input.value.trim() !== '') throw new ORPCError('INTERNAL_SERVER_ERROR')
        return row
      }),
  },
}
