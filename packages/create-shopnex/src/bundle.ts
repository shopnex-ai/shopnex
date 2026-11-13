import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as p from '@clack/prompts'
import { UnavailableError } from './errors'
import { appCacheDir } from './paths'

/**
 * The packaged build of ShopNex: one file per release, attached by the release workflow
 * (scripts/build-node-bundle.mjs). It holds the bundled admin (with the API and checkout), the built storefront with
 * its themes, the database migrations and a manifest.json. It is plain JavaScript and WebAssembly, so the same file
 * runs on every OS and CPU.
 */
/**
 * `create-shopnex@edge` is published from every push to main as 0.0.0-edge.<sha>. Its build is the one asset of the
 * rolling `edge` release, replaced on every push, so it is looked up by checksum (see resolveBundle) rather than by
 * the version, which would be one push behind.
 */
export const isEdge = (version: string) => /-edge\./.test(version)

export const bundleName = (version: string) => `shopnex-v${version}-node.tgz`

/** SHOPNEX_BUNDLE_URL points somewhere else (a mirror, a test server); the .sha256 file sits next to it */
export const bundleUrl = (version: string) =>
  process.env.SHOPNEX_BUNDLE_URL ??
  (isEdge(version)
    ? 'https://github.com/shopnex-ai/shopnex/releases/download/edge/shopnex-edge-node.tgz'
    : `https://github.com/shopnex-ai/shopnex/releases/download/v${version}/${bundleName(version)}`)

/** Where one build is unpacked, named by its version (an edge build: by its checksum): downloaded once */
export const bundleDir = (key: string) => join(appCacheDir(), key)

export const isInstalled = (key: string) => existsSync(join(bundleDir(key), 'manifest.json'))

const installedEdges = () =>
  existsSync(appCacheDir()) ? readdirSync(appCacheDir()).filter((name) => /^edge-[0-9a-f]{12}$/.test(name)) : []

async function get(url: string, what: string, version: string) {
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    const reason = (error as { cause?: { message?: string } }).cause?.message ?? (error as Error).message
    throw new UnavailableError(`Could not download ${what} (${reason}).\nCheck your connection and try again.`)
  }
  if (response.status === 404) {
    throw new UnavailableError(
      `ShopNex ${version} has no packaged build to download (404 for ${url}).\nUse a released version of create-shopnex.`,
    )
  }
  if (!response.ok) {
    throw new UnavailableError(`Could not download ${what}: ${url} answered ${response.status}.`)
  }
  return response
}

/** "<hash>  <file name>" (what sha256sum prints), or just the hash */
const parseChecksum = (text: string) => text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''

async function download(response: Response, file: string, onProgress: (bytes: number) => void) {
  const hash = createHash('sha256')
  let bytes = 0
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      bytes += chunk.length
      onProgress(bytes)
      done(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    measure,
    createWriteStream(file),
  )
  return hash.digest('hex')
}

/**
 * Makes sure the packaged build for this version is on disk (downloading it the first time, checking its SHA-256,
 * unpacking it into the cache folder) and returns the folder to run from. Nothing is left behind half-done: it is
 * unpacked next to the final place and moved into it as the last step.
 */
export async function resolveBundle({ version }: { version: string }) {
  const edge = isEdge(version)
  if (!edge && isInstalled(version)) return bundleDir(version)

  mkdirSync(appCacheDir(), { recursive: true })
  const spinner = p.spinner()
  const animate = Boolean(process.stdout.isTTY)
  const say = (message: string) => (animate ? spinner.message(message) : undefined)
  const start = edge ? 'Checking for a newer edge build' : `Downloading ShopNex ${version} (once, about 15 MB)`
  if (animate) spinner.start(start)
  else p.log.step(start)
  let work: string | undefined
  try {
    const url = bundleUrl(version)
    const expected = parseChecksum(await (await get(`${url}.sha256`, 'the checksum', version)).text())
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new UnavailableError(`${url}.sha256 does not hold a SHA-256 checksum.`)

    // A release is named by its version. The edge build is replaced on every push, so it is named by its checksum:
    // the same checksum is the same build, and only a changed one downloads again.
    const key = edge ? `edge-${expected.slice(0, 12)}` : version
    const dir = bundleDir(key)
    if (isInstalled(key)) {
      if (animate) spinner.stop('ShopNex edge is up to date')
      return dir
    }
    const label = edge ? 'the latest edge build' : `ShopNex ${version}`
    say(`Downloading ${label}`)

    work = mkdtempSync(join(appCacheDir(), `${key}.tmp-`))
    const file = join(work, 'bundle.tgz')
    const actual = await download(await get(url, 'ShopNex', version), file, (bytes) =>
      say(`Downloading ${label}: ${(bytes / 1e6).toFixed(1)} MB`),
    )
    if (actual !== expected) {
      throw new UnavailableError(
        `The download is damaged: its SHA-256 is ${actual}, expected ${expected}. Nothing was installed; try again.`,
      )
    }

    say('Unpacking')
    const unpacked = join(work, 'app')
    mkdirSync(unpacked)
    const tar = spawnSync('tar', ['-xzf', file, '-C', unpacked], { encoding: 'utf8' })
    if (tar.error || tar.status !== 0) {
      throw new UnavailableError(`Could not unpack the download with tar: ${tar.error?.message ?? tar.stderr.trim()}`)
    }
    const manifestFile = join(unpacked, 'manifest.json')
    const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : undefined
    // An edge build carries the version of the push that built it, which is newer than this CLI: any manifest will do
    if (edge ? !manifest : manifest?.version !== version) {
      throw new UnavailableError(
        `The download is not ShopNex ${version} (its manifest says ${manifest?.version ?? 'nothing'}).`,
      )
    }

    rmSync(dir, { recursive: true, force: true }) // a folder without manifest.json is a leftover, never an install
    renameSync(unpacked, dir)
    // Older edge builds are never used again, and each is about 50 MB
    for (const old of installedEdges()) if (old !== key) rmSync(bundleDir(old), { recursive: true, force: true })
    if (animate) spinner.stop(`${label} downloaded`)
    else p.log.success(`${label} downloaded`)
    return dir
  } catch (error) {
    if (animate) spinner.stop('Download failed', 1)
    throw error
  } finally {
    if (work) rmSync(work, { recursive: true, force: true })
  }
}
