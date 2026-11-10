# create-shopnex

Try ShopNex on your machine with one command. It starts the admin (with the API and hosted checkout) and the
storefront on an embedded database ([PGlite](https://pglite.dev)): no PostgreSQL, no Docker, no clone.

## Run it

```sh
npx create-shopnex@latest
```

This creates the folder `shopnex` in the current folder and keeps the shop's database in it. Want another name?
Add it: `npx create-shopnex@latest my-shop`.

npm asks once whether to install the package: answer `y`. `@latest` makes npx fetch the newest version instead of
reusing an older copy from its cache. With pnpm, which does not ask:

```sh
pnpm create shopnex@latest
```

The first run downloads ShopNex (one file, about 15 MB) into `~/.shopnex/app/<version>` (shared by all your shops) and checks its SHA-256; later
runs start straight away. It prints where to open the shop and the admin and opens the admin's setup wizard (use
`--no-open` to skip that). Ctrl+C stops everything. Nothing is installed globally.

## What it does, and why you can trust it

- **It runs on your machine only.** Both servers listen on `127.0.0.1`, and the data stays in the shop folder (`shopnex/data` by default).
- **It downloads one file.** `create-shopnex` itself fetches only the ShopNex build from this repository's GitHub
  releases, and checks its SHA-256 before it unpacks anything. The checksum comes from the same place as the file, so it
  catches a damaged or half-finished download, not a tampered release: the release itself is what you trust.
- **The source is here.** The package is
  [`packages/create-shopnex`](https://github.com/shopnex-ai/shopnex/tree/main/packages/create-shopnex) in this
  repository, and has no runtime dependencies: what you run is one bundled file built from that source.
- **It is built in the open.** Releases and edge builds are published from GitHub Actions
  ([release](https://github.com/shopnex-ai/shopnex/blob/main/.github/workflows/release.yaml),
  [edge](https://github.com/shopnex-ai/shopnex/blob/main/.github/workflows/edge.yaml)) with npm provenance, so a
  version's page on npmjs.com shows which commit and workflow run built it. The one exception is `0.0.0-edge.init`, the
  first publish, made by hand to create the package. Publishing uses npm trusted publishing, so there is no long-lived
  npm token.

## Options

| Option                  | What it does                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `[name]`                | The shop's folder, created if needed. `shopnex` when left out; the same folder is the same shop           |
| `--port <n>`            | Admin, API and checkout. Default `3000`                                                                   |
| `--storefront-port <n>` | Storefront. Default `4321`                                                                                |
| `--no-open`             | Do not open the browser                                                                                   |
| `--with <apps>`         | Also start optional apps next to the shop: `stripe`, `cj`, `shippo` (comma separated, or repeat the flag) |
| `--app <name>`          | What to start. Only `shop` today; a picker appears once there is more than one                            |
| `--verbose`             | Show the servers' output while they start (otherwise only if one fails)                                   |
| `--dry-run`             | Show what would run, and exit                                                                             |

## Apps: Stripe, CJ Dropshipping and Shippo

```sh
npx create-shopnex@latest --with stripe,cj,shippo
```

Each app runs as its own small server on this machine only (Stripe on port 4600, CJ Dropshipping on 4700, Shippo on 4900) and keeps
its data in `<shop folder>/apps/`. The admin finds them by itself; install them from the admin like any app and enter
your keys there. Stripe cannot reach a `localhost` address, so card payments need a public address for the app or
`stripe listen`: see the Stripe app's settings page.

To start over, delete the shop folder.

## Not for production

One process owns the data, so nothing else can open the folder, and the servers listen on `127.0.0.1` only. Use
Docker or PostgreSQL for a real shop. There is no tool yet to move the data from the embedded database to PostgreSQL.

## Where the build comes from

Each release attaches `shopnex-v<version>-node.tgz` and its `.sha256` (`scripts/build-node-bundle.mjs`, run by the
release workflow). It holds the admin (bundled into a few files), the built storefront with its themes and the database
migrations: JavaScript and WebAssembly, so one file serves every OS and CPU. `create-shopnex` asks for the build of its
own version, so a version without a release says so. The checksum comes from the same place as the file: it catches a
damaged download, not a tampered release.

`SHOPNEX_SECRET` is generated once and kept in `<name>/data.secret` (readable by you only), so the same shop keeps its
sessions and stored keys. `SHOPNEX_BUNDLE_URL` downloads from somewhere else (a mirror; the `.sha256` sits next to it)
and `SHOPNEX_APP_DIR` changes where builds are unpacked.

**Edge:** `npx create-shopnex@edge` (or `pnpm create shopnex@edge`) runs the latest build of `main` (`.github/workflows/edge.yaml` replaces the file of
the `edge` pre-release on every push). It downloads again only when `main` moved. It can be broken: use a release for
anything you want to keep.

## Development

```sh
pnpm --filter create-shopnex dev     # runs src/main.ts (needs a release of this version, or SHOPNEX_BUNDLE_URL)
pnpm --filter create-shopnex test
pnpm build && pnpm --dir templates/storefront build && node scripts/build-node-bundle.mjs 0.14.0 /tmp/bundle
```
