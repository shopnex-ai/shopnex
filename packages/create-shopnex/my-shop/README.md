# Getting started with ShopNex

Run a ShopNex shop on your machine in a few minutes. No PostgreSQL, no Docker, no clone.

When it is running you have:

- the **admin** at http://localhost:3000/admin
- the **storefront** at http://localhost:4321
- a **database** in the shop folder (embedded, for trying things out)

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

## 4. Add your first product

In the admin, add a product (a name and a price are enough), then reload the storefront: it shows up there. That is the
whole loop: you change things in the admin, customers see them in the storefront.

To try a card payment, start the Stripe app next to the shop (`--with stripe`, see below), install it from the admin and
enter your Stripe **test** keys; the test card is `4242 4242 4242 4242`. Stripe cannot reach a `localhost` address, so
payments need a public address for the app or `stripe listen`: the Stripe app's settings page explains it.

## Update

`npm start` runs the version written in the shop's `package.json` (`create-shopnex@<version>`), so it never changes by
itself. To move to a newer version:

1. Stop the shop and copy the folder somewhere as a backup.
2. Change the version in the two scripts of `package.json` (or run `npx create-shopnex@latest my-shop` once).
3. Start it again. The database changes the new version needs are applied on start.

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
- **From trying it to a real shop:** the embedded database is for trying ShopNex out (one process owns it), so move to
  PostgreSQL before you rely on the shop. With the shop stopped, run this in its folder with an empty PostgreSQL database:

  ```sh
  TARGET=postgres://user:password@host:5432/shopnex npx shopnex migrate-db --to-env TARGET
  ```

  It copies the data, keeps a copy of the old data next to it and points the `.env` at PostgreSQL. Then run the shop in
  Docker with the `docker-compose.yml` ([self-hosting docs](https://shopnex.ai/docs/self-hosting/docker)).

- **Every option and how the download is checked:** the [package README](https://github.com/shopnex-ai/shopnex/tree/main/packages/create-shopnex#readme).

## If something goes wrong

- **A port is taken:** the command stops before downloading anything and names the flag to change (`--port`,
  `--storefront-port`).
- **No connection:** the first run needs the network for the download; later runs do not.
- **Servers will not start:** run again with `--verbose` to see their output.
- **Start over:** delete the shop folder.
