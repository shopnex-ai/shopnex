<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/logo-light.svg">
    <img src="docs/images/logo.svg" alt="Shopnex logo" width="72">
  </picture>
</p>

<h1 align="center">Shopnex</h1>

<p align="center">
  <img src="docs/images/dashboard.png" alt="Shopnex admin dashboard with sales analytics" width="900">
</p>

<p align="center">
  <a href="https://github.com/shopnex-ai/shopnex/actions/workflows/ci.yaml"><img src="https://github.com/shopnex-ai/shopnex/actions/workflows/ci.yaml/badge.svg" alt="CI"></a>
  <a href="https://github.com/shopnex-ai/shopnex/releases"><img src="https://img.shields.io/github/v/release/shopnex-ai/shopnex?include_prereleases" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/shopnex-ai/shopnex" alt="License: MIT"></a>
  <a href=".node-version"><img src="https://img.shields.io/badge/node-%E2%89%A522.22-339933?logo=nodedotjs&logoColor=white" alt="Node"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome"></a>
</p>

Open-source, self-hosted e-commerce. Run your own shop with an admin, a themeable storefront, hosted checkout,
a typed API and webhooks, and extend it with out-of-process apps. No code or CLI needed for day-to-day selling.

- **Admin**: products, collections, orders, discounts, shipping, taxes, staff and settings in the browser
- **Storefront**: a bundled Astro storefront with Liquid themes, or bring your own through the Storefront API (aligned with Shopify's)
- **Hosted checkout**: shipping rates, payment methods, discount codes, order confirmation
- **Extensible**: scoped API tokens, signed webhooks, embedded apps and an app marketplace. No third-party code in the core
- **Multi-tenant underneath**: one shop by default, many shops by flipping `TENANCY_MODE`

## Quick start

Requires [Docker](https://docs.docker.com/get-docker/).

```sh
curl -fsSLO https://raw.githubusercontent.com/shopnex-ai/shopnex/main/deploy/docker-compose.yml
docker compose up
```

Open http://localhost:3000 once the logs settle and follow the setup wizard to create the owner account.
Ctrl+C stops it; add `-d` (`docker compose up -d`) to keep it running in the background.
Anyone who reaches a fresh install can claim it, so finish setup right after deploying.

No `.env` needed. For a public server, set `APP_URL` and `STRIPE_APP_URL`, and pin
`SHOPNEX_VERSION` to a release tag; see the [self-hosting guide](apps/docs/content/docs/self-hosting/install.mdx).

## Development

Requires Node (see `.node-version`), [pnpm](https://pnpm.io) and PostgreSQL.

```sh
pnpm install
cp .env.example .env        # set the database URL and app secret
pnpm db:migrate
pnpm dev                    # admin on :3000, storefront on :4321
```

## Documentation

Guides live in `apps/docs` (`pnpm dev:docs`, http://localhost:3400). Developer reference is in [`docs/`](docs):

| Doc                                      | Covers                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| [Development](docs/development.md)       | Env setup, `pnpm dev` options, local ports, OAuth sign-in, end-to-end tests |
| [Architecture](docs/architecture.md)     | Repository layout, API layout, admin routes, tenancy                        |
| [Storefront API](docs/storefront-api.md) | Building an external storefront with `@shopnex/storefront-sdk`              |
| [Apps and marketplace](docs/apps.md)     | API tokens, building apps with `@shopnex/app`, embedded apps, marketplace   |
| [Webhooks](docs/webhooks.md)             | Topics, signatures, delivery and retries                                    |
| [Roadmap](docs/roadmap.md)               | What's done and what's next                                                 |
| [Releasing](RELEASING.md)                | How to cut a release                                                        |

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately,
as described in [SECURITY.md](SECURITY.md).

See [`@shopnex/app`](packages/app) for building apps with no database or OAuth code: authenticate,
Admin API, per-shop data, signed requests (`@shopnex/app/store`), and admin-styled UI (`@shopnex/app/ui`).

## License

[MIT](LICENSE)
