#!/usr/bin/env node
// Rebuilds the README hero, docs/images/dashboard.png (the docs site home uses it too): the headline, the three tiles and
// an admin screenshot in a macOS window, rendered by Chromium from hero.html at 1800x1320.
//
//   node scripts/readme-hero/build.mjs <admin-screenshot.png> [out.png]
//
// The screenshot is the admin Home page (dark, about 3000 px wide), shown from the top and cut off at the bottom of the
// window. out.png defaults to docs/images/dashboard.png. Needs Playwright's Chromium (`pnpm exec playwright install
// chromium` in e2e/). To change the text, edit hero.html.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
const [screenshot, out = join(root, 'docs/images/dashboard.png')] = process.argv.slice(2)
if (!screenshot || !existsSync(screenshot)) {
  console.error('Usage: node scripts/readme-hero/build.mjs <admin-screenshot.png> [out.png]')
  process.exit(1)
}

// Playwright is a dependency of e2e/ (a CommonJS entry: its exports sit on `default` when imported)
const playwright = await import(pathToFileURL(createRequire(join(root, 'e2e/package.json')).resolve('@playwright/test')).href)
const { chromium } = playwright.chromium ? playwright : playwright.default

const work = mkdtempSync(join(tmpdir(), 'readme-hero-'))
try {
  copyFileSync(join(here, 'hero.html'), join(work, 'hero.html'))
  copyFileSync(join(root, 'docs/images/logo-dark.svg'), join(work, 'logo.svg'))
  copyFileSync(resolve(screenshot), join(work, 'admin.png'))
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1800, height: 1320 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(join(work, 'hero.html')).href)
  await page.waitForLoadState('load')
  await page.waitForTimeout(500)
  await page.screenshot({ path: resolve(out) })
  await browser.close()
  console.log(`written ${resolve(out)}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
