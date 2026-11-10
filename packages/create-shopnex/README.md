# create-shopnex

Try ShopNex on your machine with one command. It starts the admin (with the API and hosted checkout) and the
storefront on an embedded database ([PGlite](https://pglite.dev)): no PostgreSQL, no Docker, nothing else to install.

```sh
npx create-shopnex
```

It prints where to open the shop and the admin, and opens the setup wizard. Ctrl+C stops everything.

The first run downloads ShopNex (one file of about 15 MB) into `~/.shopnex/app/<version>` and checks its SHA-256;
later runs start straight away. No clone, no build, no `pnpm install`.

## Options

| Option                  | What it does                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `--data <folder>`       | Where the database lives. Default `~/.shopnex/data`: the same folder is the same shop    |
| `--port <n>`            | Admin, API and checkout. Default `3000`                                                  |
| `--storefront-port <n>` | Storefront. Default `4321`                                                               |
| `--no-open`             | Do not open the browser                                                                  |
| `--reset --yes`         | Delete the data folder first and start from an empty shop                                |
| `--app <name>`          | What to start. Only `shop` today; a picker appears once there is more than one           |
| `--verbose`             | Show the servers' output while they start (otherwise only if one fails)                  |
| `--from <folder>`       | Run from a ShopNex checkout in development mode (what `pnpm dev` runs), not the download |
| `--dry-run`             | Show what would run, and exit                                                            |

`--reset` refuses a folder that is not a PGlite database (no `PG_VERSION` inside) and always needs `--yes`, so a wrong
`--data` cannot delete something else.

## Not for production

One process owns the data, so nothing else can open the folder. Use Docker or PostgreSQL for a real shop. There is no
tool yet to move the data from the embedded database to PostgreSQL, so do not keep a real shop on it.

## From a checkout

The source is TypeScript (`src/`). Run it directly:

```sh
pnpm install
pnpm --filter create-shopnex dev -- --from . --data ~/shopnex-try
```

This starts `vite dev` for the admin and `astro dev` for the storefront, with `DATABASE_URL=pglite:<folder>`.

The published package ships one compiled file (`dist/main.mjs`, built with esbuild by `pnpm --filter create-shopnex build`,
which `npm pack` runs first), because Node does not strip types from files under `node_modules`, where `npx` puts it.
After a build, `node packages/create-shopnex/bin/create-shopnex.mjs --from .` runs the compiled version.

## The packaged build

Each release attaches `shopnex-v<version>-node.tgz` and its `.sha256` (built by `scripts/build-node-bundle.mjs`, in
the release workflow's `node-bundle` job). It holds the admin with the API and checkout (bundled into a few files),
the built storefront with its themes, the database migrations and a `manifest.json`: plain JavaScript and
WebAssembly, so one file serves every OS and CPU. `create-shopnex` asks for the build of its **own version** (the
package version follows the ShopNex release; `pnpm bump` sets it with the others), so a version without a release
says so and points at `--from`.

It runs in production mode, bound to `127.0.0.1` only (a fresh install lets whoever reaches it create the owner).
`SHOPNEX_SECRET` is generated once and kept in `<data folder>.secret` (readable by you only), so the same shop keeps
its sessions and stored keys.

The checksum comes from the same place as the file, so it catches a damaged or half-finished download, not a
tampered release: the release itself is what you trust.

Environment: `SHOPNEX_BUNDLE_URL` downloads from somewhere else (a mirror; the `.sha256` sits next to it) and
`SHOPNEX_APP_DIR` changes where builds are unpacked.

To build one yourself:

```sh
pnpm build && pnpm --dir templates/storefront build
node scripts/build-node-bundle.mjs 0.14.0 /tmp/bundle
```

## Tests

```sh
pnpm --filter create-shopnex test
```
