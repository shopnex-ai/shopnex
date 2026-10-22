// A theme's own Liquid files for the Shopnex admin's code editor (a ThemeSource; see THEME_SOURCE_PATH).
// Not public: it needs a preview token for a copy of this theme, which only the admin can make.
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { APIRoute } from 'astro'
import { THEME_CODE_FOLDERS, THEME_PREVIEW_PARAM, ThemeFilePath, type ThemeSource } from '@shopnex/storefront-sdk'
import { findTheme } from '../../../../core/theme'
import { shopnex } from '../../../../core/shopnex'

export const GET: APIRoute = async ({ params, url }) => {
  const theme = findTheme(params.theme ?? '')
  const previewToken = url.searchParams.get(THEME_PREVIEW_PARAM)
  if (!theme) return new Response('Not found', { status: 404 })
  const current = previewToken ? await shopnex.theme.current({ previewToken }).catch(() => null) : null
  if (!current?.preview || current.themeId !== theme.id) return new Response('Forbidden', { status: 403 })

  const files: ThemeSource['files'] = {}
  for (const folder of THEME_CODE_FOLDERS) {
    const names = await readdir(join(theme.dir, folder)).catch(() => [] as string[])
    for (const name of names.sort()) {
      const path = `${folder}/${name}`
      if (ThemeFilePath.safeParse(path).success) files[path] = await readFile(join(theme.dir, path), 'utf8')
    }
  }
  return new Response(JSON.stringify({ files } satisfies ThemeSource), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
