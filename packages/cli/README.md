# shopnex

Look after a ShopNex shop that you started with [`create-shopnex`](../create-shopnex). One command today:
`migrate-db`, which moves the shop's data from the embedded database to PostgreSQL.

```sh
cd my-shop                      # the folder create-shopnex made (it has the .env)
# stop the shop (Ctrl+C where it runs), then:
npx shopnex@latest migrate-db --to postgres://user:password@host:5432/shopnex
```

The new database must exist and be empty. To keep the password out of your shell history, put the address in an
environment variable and give its name: `--to-env SHOPNEX_TARGET`.

## What it does

1. Checks that the shop is stopped (nothing answers on the admin's port, 3000; use `--port` if you started it on
   another) and that its database is at the schema of this version.
2. Keeps a copy of `.pglite/` next to it (`.pglite.bak-<date>`).
3. Runs `admin/migrate-db.mjs` from the packaged build of the same version: it creates the tables in PostgreSQL,
   copies every table in foreign-key order inside **one transaction**, and checks every table's row count before it
   commits.
4. Only then changes `DATABASE_URL` in the `.env`. The old line stays above it as a comment, and `.pglite/` stays
   where it is: going back is one edit.

If anything fails, PostgreSQL is left as empty as it was found, the `.env` is not touched, and the extra copy is
removed. The old data is only ever read.

## What it does not do

- **The optional apps' data** (`apps/<name>/.pglite`: Stripe, CJ Dropshipping, Shippo) is not moved. They start empty
  on PostgreSQL, and the command names the ones that had data.
- It never merges into a database that already has tables.
- It does not move data back, or between two PostgreSQL servers (use `pg_dump` for that).

## The version rule

Like `create-shopnex`, this CLI runs the packaged build of **its own version** (downloaded once into
`~/.shopnex/app/<version>`, shared with `create-shopnex`). A shop last started by an older version must be started once
with this one first: it updates the database at start, and `migrate-db` refuses to copy until then. A database from a
newer version is refused too.

## Development

```sh
pnpm --filter shopnex dev migrate-db --help    # runs src/main.ts
pnpm --filter shopnex test                     # the command, against a stub in place of the build's script
pnpm --filter @shopnex/db test                 # the copier itself (modules/db/src/move-data.ts) on two PGlite databases
```

The code that is not about this command (downloading and unpacking the build, the `.env`, ports) is
[`@shopnex/cli-core`](../cli-core), shared with `create-shopnex`.
