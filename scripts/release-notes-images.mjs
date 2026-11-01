#!/usr/bin/env node
// Puts each pull request's screenshot under its entry in the release notes:
//
//   * Add a setup wizard by @someone in https://github.com/owner/repo/pull/123
//     <img src="…">          <- the first image in PR #123's description
//
//   node scripts/release-notes-images.mjs <notes.md>     rewrites the file in place
//
// Needs the `gh` CLI (GH_TOKEN in CI). The image is whatever the author put in the PR description: a pasted
// or dragged screenshot, a Markdown image or an <img> tag. Badges are ignored, and a PR without an image, or
// one that can't be read, keeps its plain entry: this never fails a release.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const IMAGE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)[^)]*\)|<img\b[^>]*?\bsrc=["'](https?:\/\/[^"']+)["']/gi
const SCREENSHOT_LINE = /^ {2}<br><img src="[^"]*" width="480" alt="Screenshot from #\d+">$/
const NOT_A_SCREENSHOT = /shields\.io|badge|\.svg(\?|$)/i

/** First screenshot in a PR description, or null */
export function firstImage(body) {
  for (const match of body.matchAll(IMAGE)) {
    const url = match[1] ?? match[2]
    if (url && !NOT_A_SCREENSHOT.test(url)) return url
  }
  return null
}

/** The PR number of a generated-notes entry ("... in https://github.com/o/r/pull/123" or "... in #123") */
export function pullNumber(line) {
  const match = /^\s*[*-] .*(?:\/pull\/|#)(\d+)\s*$/.exec(line)
  return match ? Number(match[1]) : null
}

/** Inserts `<br><img>` under every entry whose PR has an image; `imageFor(number)` returns a URL or null */
export function addImages(notes, imageFor) {
  const out = []
  // A re-run of the release workflow starts from notes that already have the images: don't add them twice
  for (const line of notes.split('\n').filter((l) => !SCREENSHOT_LINE.test(l))) {
    out.push(line)
    const number = pullNumber(line)
    const image = number ? imageFor(number) : null
    if (image) out.push(`  <br><img src="${image}" width="480" alt="Screenshot from #${number}">`)
  }
  return out.join('\n')
}

function prImage(number) {
  try {
    const body = execFileSync('gh', ['pr', 'view', String(number), '--json', 'body', '--jq', '.body'], {
      encoding: 'utf8',
    })
    return firstImage(body)
  } catch (error) {
    console.error(`#${number}: could not read the pull request (${error.message.split('\n')[0]})`)
    return null
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node scripts/release-notes-images.mjs <notes.md>')
    process.exit(1)
  }
  const notes = readFileSync(file, 'utf8')
  let found = 0
  const result = addImages(notes, (number) => {
    const image = prImage(number)
    if (image) found++
    console.log(`#${number}: ${image ? 'image added' : 'no image'}`)
    return image
  })
  writeFileSync(file, result)
  console.log(`${found} screenshot${found === 1 ? '' : 's'} added`)
}
