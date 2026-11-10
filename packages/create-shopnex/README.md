# create-shopnex

Try ShopNex on your machine with one command. It starts the admin (with the API and hosted checkout) and the
storefront on an embedded database ([PGlite](https://pglite.dev)): no PostgreSQL, no Docker, nothing else to install.

```sh
npx create-shopnex
```

It prints where to open the shop and the admin, and opens the setup wizard. Ctrl+C stops everything.

> **Status: scaffold.** Everything below works when you run it from a ShopNex checkout (`--from`). The packaged build
> that lets `npx create-shopnex` run without a checkout is not published yet, so without `--from` it says so.

## Options

| Option                  | What it does                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `--data <folder>`       | Where the database lives. Default `~/.shopnex/data`: the same folder is the same shop |
| `--port <n>`            | Admin, API and checkout. Default `3000`                                               |
| `--storefront-port <n>` | Storefront. Default `4321`                                                            |
| `--no-open`             | Do not open the browser                                                               |
| `--reset --yes`         | Delete the data folder first and start from an empty shop                             |
| `--from <folder>`       | Run from a ShopNex checkout, in development mode (what `pnpm dev` runs)               |
| `--dry-run`             | Show what would run, and exit                                                         |

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

## How the packaged build will work (not built yet)

The release workflow attaches a Node bundle of the built admin app, the built storefront with its themes, and the
database migrations to each GitHub release. `create-shopnex` downloads the one matching its own version into
`~/.shopnex/app/<version>` once, checks its checksum, and runs it with `SHOPNEX_MIGRATIONS_DIR` pointing at the
bundled migrations. The package version follows the ShopNex release (`pnpm bump` sets it with the others).

## Tests

```sh
pnpm --filter create-shopnex test
```
