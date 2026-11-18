# Getting started with ShopNex

Run a ShopNex shop on your machine in a few minutes. No PostgreSQL, no Docker, no clone.

## You need

- Node.js 22.22 or newer
- Free ports `3000` (admin, API, checkout) and `4321` (storefront). Other ports: `--port` and `--storefront-port`.

## 1. Start the shop

```sh
npx create-shopnex@latest my-shop
```

This creates the folder `my-shop`, downloads ShopNex once (about 15 MB, kept in `~/.shopnex/app` and shared by all
your shops), starts the admin and the storefront, and opens the admin in your browser. The first start takes a minute.
Leave the terminal open: Ctrl+C stops the shop.

## 2. Create the owner account

The admin opens the setup wizard on the first run. Create the owner account right away: until you do, whoever reaches
the admin can. Both servers listen on your machine only (`127.0.0.1`).

Then open the storefront at http://localhost:4321 and the admin at http://localhost:3000/admin.

## 3. Run it again

```sh
cd my-shop
npm start
```

`npm run dev` does the same. Nothing to install first: the script runs `npx --yes create-shopnex@<version> .` with the
version that made the folder. The shop's data stays in the folder, so the same folder is the same shop.

## What is in the folder

| File                 | What it is                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `.env`               | The shop's settings and secrets. Keep it out of git; a lost `SHOPNEX_SECRET` means a new shop                    |
| `.pglite/`           | The embedded trial database                                                                                      |
| `docker-compose.yml` | For running the shop in Docker instead: see the [self-hosting docs](https://shopnex.ai/docs/self-hosting/docker) |
| `README.md`          | How to run this shop again                                                                                       |

## Next

- **Payments and shipping:** start the optional apps next to the shop with
  `npx create-shopnex@latest my-shop --with stripe,cj,shippo`, then install them from the admin and enter your keys.
- **PostgreSQL:** set `DATABASE_URL=postgres://user:password@host:5432/shopnex` in the shop's `.env` and start again.
- **Not for production.** One process owns the embedded data. Use Docker or PostgreSQL for a real shop.
- **Every option and how the download is checked:** the [package README](https://github.com/shopnex-ai/shopnex/tree/main/packages/create-shopnex#readme).

## If something goes wrong

- **A port is taken:** the command stops before downloading anything and names the flag to change (`--port`,
  `--storefront-port`).
- **No connection:** the first run needs the network for the download; later runs do not.
- **Servers will not start:** run again with `--verbose` to see their output.
- **Start over:** delete the shop folder.
