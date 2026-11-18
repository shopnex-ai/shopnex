# {{name}}

A ShopNex shop, started with `npx create-shopnex`.

## Run it

In this folder:

```sh
npm start     # or: npm run dev
```

Nothing to install first: the script fetches `create-shopnex` itself (the version that made this folder) and starts the
shop.

- Admin: http://localhost:3000/admin (the first run opens the setup wizard: create the owner account)
- Storefront: http://localhost:4321
- Ctrl+C stops everything.

## What is here

- `.env`: the shop's settings and secrets. Keep it out of git. Change `DATABASE_URL` to use PostgreSQL.
- `.pglite/`: the embedded trial database. It is for trying ShopNex out, not for production.
- `docker-compose.yml`: for a real shop, see https://shopnex.ai for the self-hosting docs.
