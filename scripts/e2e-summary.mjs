#!/usr/bin/env node
// Turns the e2e results of one CI run into the public test report (see docs/e2e-plan.md, section 5):
//   report-site/results.json   what shopnex.ai/testing reads
//   report-site/report/        the Playwright HTML report
//   report-site/index.html     a redirect to the report
// Inputs (a missing file means that suite did not run; it is reported as such, never as passing):
//   e2e/playwright-results.json   Playwright's JSON reporter
//   e2e/api-results.xml           node:test's JUnit reporter (pnpm --filter @shopnex/e2e test:ci)
// Usage: node scripts/e2e-summary.mjs [outDir]   (CI sets GITHUB_* variables for the commit and run link)
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2] ?? 'report-site'

// Plain-language names for the browser flows, by spec file. Unknown files fall back to their file name.
export const FLOW_TITLES = {
  'admin.spec.ts': 'Admin sign-in and first run',
  'checkout.spec.ts': 'Shopper checkout',
  'checkout-payments.spec.ts': 'Checkout payments',
  'shipping-rates.spec.ts': 'Carrier shipping rates',
  'abandoned-cart.spec.ts': 'Abandoned cart emails',
}

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)

/** Playwright JSON report -> per-file counts. A test's status is expected | unexpected | flaky | skipped. */
export function summarizePlaywright(report) {
  if (!report) return null
  const flows = []
  const walk = (suite, counts) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        counts.total++
        if (t.status === 'expected') counts.passed++
        else if (t.status === 'flaky') counts.flaky++
        else if (t.status === 'skipped') counts.skipped++
        else counts.failed++
      }
    }
    for (const child of suite.suites ?? []) walk(child, counts)
  }
  for (const top of report.suites ?? []) {
    const counts = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 }
    walk(top, counts)
    const file = top.file ?? top.title
    flows.push({ id: file.replace(/\.spec\.ts$/, ''), title: FLOW_TITLES[file] ?? file, ...counts })
  }
  const sum = (k) => flows.reduce((n, f) => n + f[k], 0)
  return {
    total: sum('total'),
    passed: sum('passed'),
    failed: sum('failed'),
    flaky: sum('flaky'),
    skipped: sum('skipped'),
    flows,
  }
}

/** node:test JUnit output -> totals. The root element has no counts; the reporter ends with "<!-- tests 3 -->" style comments. */
export function summarizeJunit(xml) {
  if (!xml) return null
  const n = (name) => {
    const m = xml.match(new RegExp(`<!-- ${name} (\\d+) -->`))
    return m ? Number(m[1]) : null
  }
  const total = n('tests')
  if (total === null) return null
  const failed = (n('fail') ?? 0) + (n('cancelled') ?? 0)
  const skipped = (n('skipped') ?? 0) + (n('todo') ?? 0)
  return { total, passed: n('pass') ?? total - failed - skipped, failed, skipped }
}

export function buildResults({ playwright, api, env, now = new Date() }) {
  const suites = [playwright, api]
  const missing = suites.some((s) => !s)
  const failed = suites.some((s) => s && s.failed > 0)
  return {
    generatedAt: now.toISOString(),
    // pass: both suites ran and nothing failed. fail: something failed. incomplete: a suite did not run.
    status: failed ? 'fail' : missing ? 'incomplete' : 'pass',
    commit: env.GITHUB_SHA ?? null,
    runUrl:
      env.GITHUB_SERVER_URL && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
    browser: playwright,
    api,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const playwright = summarizePlaywright(readJson('e2e/playwright-results.json'))
  const api = summarizeJunit(existsSync('e2e/api-results.xml') ? readFileSync('e2e/api-results.xml', 'utf8') : null)
  const results = buildResults({ playwright, api, env: process.env })
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  if (existsSync('e2e/playwright-report')) cpSync('e2e/playwright-report', join(out, 'report'), { recursive: true })
  writeFileSync(
    join(out, 'index.html'),
    '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=report/"><a href="report/">Test report</a>\n',
  )
  console.log(
    `test report: ${results.status}, browser ${playwright?.passed ?? '-'}/${playwright?.total ?? '-'}, api ${api?.passed ?? '-'}/${api?.total ?? '-'}`,
  )
}
