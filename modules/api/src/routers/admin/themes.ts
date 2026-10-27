import { ORPCError } from '@orpc/server'
import {
  MAX_THEME_FILES,
  MAX_THEME_FILE_BYTES,
  THEME_DEFINITION_PATH,
  THEME_PREVIEW_PARAM,
  ThemeDocument,
  ThemeFilePath,
  ThemeSource,
  parseThemeManifest,
  themeSourcePath,
  withoutCodeSettings,
} from '@shopnex/storefront-sdk/theme'
import { DraftConflictError } from '@shopnex/drafts'
import { checkLiquid, createPreviewToken, themeService, type ShopTheme } from '@shopnex/theme'
import { z } from 'zod'
import { admin } from '../../orpc'

const id = z.object({ id: z.uuid() })
const themeId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const name = z.string().trim().min(1).max(100)
// A homepage with dozens of sections is a few KB; this only stops abuse
const MAX_DOCUMENT_BYTES = 256 * 1024

const document = ThemeDocument.refine((d) => Buffer.byteLength(JSON.stringify(d)) <= MAX_DOCUMENT_BYTES, {
  message: 'The theme document is too large',
})

const found = <T>(row: T | null) => {
  if (!row) throw new ORPCError('NOT_FOUND')
  return row
}

// The theme the shop's storefront includes with this id: its definition, from what it serves at
// THEME_DEFINITION_PATH (the admin's theme pages read the same)
async function storefrontTheme(storefrontUrl: string | null, themeId: string) {
  if (!storefrontUrl) {
    throw new ORPCError('PRECONDITION_FAILED', { message: 'Set your storefront URL under Settings first' })
  }
  const unreachable = () =>
    new ORPCError('PRECONDITION_FAILED', { message: 'Your storefront can’t be reached. Is it running?' })
  let json: unknown
  try {
    const res = await fetch(new URL(THEME_DEFINITION_PATH, storefrontUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw unreachable()
    json = await res.json()
  } catch {
    throw unreachable()
  }
  const parsed = parseThemeManifest(json)
  const definition = parsed.success ? parsed.themes.find((d) => d.id === themeId) : undefined
  if (!definition) {
    throw new ORPCError('CONFLICT', { message: `Your storefront doesn’t include the ${themeId} theme` })
  }
  return definition
}

// The theme's original Liquid files, from the storefront (it wants a preview token for a copy of the theme)
async function storefrontSource(storefrontUrl: string | null, shopId: string, copy: ShopTheme) {
  if (!storefrontUrl) {
    throw new ORPCError('PRECONDITION_FAILED', { message: 'Set your storefront URL under Settings first' })
  }
  const url = new URL(themeSourcePath(copy.themeId), storefrontUrl)
  url.searchParams.set(THEME_PREVIEW_PARAM, createPreviewToken(shopId, copy.id).token)
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new ORPCError('PRECONDITION_FAILED', { message: 'Your storefront can’t be reached. Is it running?' })
  }
  if (res.status === 404) {
    throw new ORPCError('CONFLICT', {
      message: `Your storefront doesn’t include the ${copy.themeId} theme’s code, so it can’t be edited here`,
    })
  }
  const parsed = res.ok ? ThemeSource.safeParse(await res.json().catch(() => null)) : null
  if (!parsed?.success) {
    throw new ORPCError('PRECONDITION_FAILED', { message: `Your storefront answered ${res.status} for its code` })
  }
  return parsed.data.files
}

// A library entry without its documents and code (`list` entries also say whether the draft differs)
const summary = ({ shopId: _, draft: __, published: ___, files: ____, ...entry }: ShopTheme) => entry

// Theme library (Online store → Themes) and its editor. Each theme is a copy the merchant customizes; one
// is live. Staff only for now; read_themes / write_themes scopes for apps can come later.
export const themes = {
  list: admin
    .route({ method: 'GET', path: '/admin/themes' })
    .handler(({ context }) => themeService.list(context.shop.id)),
  get: admin
    .route({ method: 'GET', path: '/admin/themes/{id}' })
    .input(id)
    .handler(async ({ input, context }) => {
      const { files: _, ...theme } = found(await themeService.get(context.shop.id, input.id))
      return theme
    }),
  // Edit code: the theme's own Liquid files (from the storefront) and the copy's edits of them, drafts included
  // (`edited`; `changed` are the paths not yet published). A path in `edited` but not `original` is a snippet
  // the merchant added. `rev` is the draft's, to say which one is being published.
  files: admin
    .route({ method: 'GET', path: '/admin/themes/{id}/files' })
    .input(id)
    .handler(async ({ input, context }) => {
      const copy = found(await themeService.get(context.shop.id, input.id))
      const original = await storefrontSource(context.shop.storefrontUrl, context.shop.id, copy)
      const { files, changed, rev } = await themeService.codeDraft(context.shop.id, copy)
      return { original, edited: files, changed, rev }
    }),
  // Autosaves one file to the draft (a null source puts the theme's own back). Liquid that doesn't parse is
  // refused with where it went wrong.
  saveFile: admin
    .route({ method: 'PUT', path: '/admin/themes/{id}/files' })
    .input(
      id.extend({
        path: ThemeFilePath,
        source: z
          .string()
          .refine((s) => Buffer.byteLength(s) <= MAX_THEME_FILE_BYTES, { message: 'The file is too large' })
          .nullable(),
      }),
    )
    .handler(async ({ input, context }) => {
      const copy = found(await themeService.get(context.shop.id, input.id))
      if (input.source !== null) {
        const { files } = await themeService.codeDraft(context.shop.id, copy)
        if (!(input.path in files) && Object.keys(files).length >= MAX_THEME_FILES) {
          throw new ORPCError('BAD_REQUEST', { message: `A theme can have at most ${MAX_THEME_FILES} edited files` })
        }
        const problem = checkLiquid(input.source)
        if (problem) {
          throw new ORPCError('BAD_REQUEST', { message: `Liquid error: ${problem.message}`, data: problem })
        }
      }
      return found(await themeService.saveFile(context.shop.id, input.id, input.path, input.source))
    }),
  // Back to the theme's own file, or deletes an added snippet, in the draft
  deleteFile: admin
    .route({ method: 'DELETE', path: '/admin/themes/{id}/files' })
    .input(id.extend({ path: ThemeFilePath }))
    .handler(async ({ input, context }) =>
      found(await themeService.saveFile(context.shop.id, input.id, input.path, null)),
    ),
  // The code draft goes live when this copy is (buyers get it right away on the live theme). The design
  // draft isn't touched, and this never changes which theme is live. `rev`: the draft the editor saw.
  publishCode: admin
    .route({ method: 'POST', path: '/admin/themes/{id}/files/publish' })
    .input(id.extend({ rev: z.number().int().nonnegative().optional() }))
    .handler(async ({ input, context }) => {
      try {
        return found(await themeService.publishCode(context.shop.id, input.id, input.rev))
      } catch (error) {
        if (error instanceof DraftConflictError) throw new ORPCError('CONFLICT', { message: error.message })
        throw error
      }
    }),
  // Throws the unpublished code edits away
  discardCode: admin
    .route({ method: 'POST', path: '/admin/themes/{id}/files/discard' })
    .input(id)
    .handler(async ({ input, context }) => found(await themeService.discardCode(context.shop.id, input.id))),
  // Adds a copy of the storefront's theme when the library has none (the first one goes live). Null: one exists.
  ensure: admin
    .route({ method: 'POST', path: '/admin/themes/ensure' })
    .input(z.object({ themeId, name, document }))
    .handler(async ({ input, context }) => {
      const row = await themeService.ensure(context.shop.id, {
        themeId: input.themeId,
        name: input.name,
        draft: input.document,
      })
      return row && summary(row)
    }),
  // The Theme Store: styles from the connected marketplace, for themes storefronts include
  store: admin.route({ method: 'GET', path: '/admin/themes/store' }).handler(() => themeService.listStore()),
  // A copy of a Theme Store style, ready to customize. Its `code` settings (custom CSS/HTML) are dropped:
  // a marketplace style never ships code.
  addFromStore: admin
    .route({ method: 'POST', path: '/admin/themes/store/{id}' })
    .input(id)
    .handler(async ({ input, context }) => {
      const style = found(await themeService.getStoreTheme(input.id))
      const definition = await storefrontTheme(context.shop.storefrontUrl, style.baseThemeId)
      const draft = withoutCodeSettings(definition, ThemeDocument.parse(style.document))
      const row = await themeService.create(context.shop.id, {
        themeId: style.baseThemeId,
        name: style.name,
        draft,
        marketplaceThemeId: style.id,
      })
      return summary(row)
    }),
  rename: admin
    .route({ method: 'PATCH', path: '/admin/themes/{id}' })
    .input(id.extend({ name }))
    .handler(async ({ input, context }) =>
      summary(found(await themeService.rename(context.shop.id, input.id, input.name))),
    ),
  duplicate: admin
    .route({ method: 'POST', path: '/admin/themes/{id}/duplicate' })
    .input(id.extend({ name: name.optional() }))
    .handler(async ({ input, context }) =>
      summary(found(await themeService.duplicate(context.shop.id, input.id, input.name))),
    ),
  delete: admin
    .route({ method: 'DELETE', path: '/admin/themes/{id}' })
    .input(id)
    .handler(async ({ input, context }) => {
      const row = found(await themeService.get(context.shop.id, input.id))
      if (row.role === 'live') {
        throw new ORPCError('CONFLICT', { message: 'The live theme can’t be deleted. Publish another theme first.' })
      }
      return found(await themeService.remove(context.shop.id, input.id))
    }),
  saveDraft: admin
    .route({ method: 'PUT', path: '/admin/themes/{id}/draft' })
    .input(id.extend({ document }))
    .handler(async ({ input, context }) => {
      const row = found(await themeService.saveDraft(context.shop.id, input.id, input.document))
      return { updatedAt: row.updatedAt }
    }),
  // The draft goes live and this copy replaces the shop's live theme
  publish: admin
    .route({ method: 'POST', path: '/admin/themes/{id}/publish' })
    .input(id)
    .handler(async ({ input, context }) => {
      const row = found(await themeService.publish(context.shop.id, input.id))
      return { publishedAt: row.publishedAt! }
    }),
  discardDraft: admin
    .route({ method: 'POST', path: '/admin/themes/{id}/discard' })
    .input(id)
    .handler(async ({ input, context }) => {
      const row = await themeService.discardDraft(context.shop.id, input.id)
      if (!row) throw new ORPCError('NOT_FOUND', { message: 'This theme was never published' })
      return { draft: row.draft, updatedAt: row.updatedAt }
    }),
  // For the editor's preview iframe (valid for an hour)
  previewToken: admin
    .route({ method: 'POST', path: '/admin/themes/{id}/preview-token' })
    .input(id)
    .handler(async ({ input, context }) => {
      found(await themeService.get(context.shop.id, input.id))
      return createPreviewToken(context.shop.id, input.id)
    }),
}
