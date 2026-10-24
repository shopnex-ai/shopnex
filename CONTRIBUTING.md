# Contributing to Shopnex

Thanks for helping. Shopnex is built for merchants first: if a merchant has to touch code, the CLI or `.env` to do
something, that is a product bug.

## Getting started

```sh
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

See [docs/architecture.md](docs/architecture.md) for the repository layout and [docs/development.md](docs/development.md) for setup details. Node version is in `.node-version`.

## Before you open a PR

```sh
pnpm lint
pnpm format:check     # pnpm format to fix
pnpm typecheck
pnpm e2e              # needs `pnpm dev` running; uses the dev database
```

- Keep PRs focused: one change per PR, with a description of what and why.
- Add or update an e2e test in `e2e/tests` for behavior changes in the API or checkout.
- Schema changes need a migration: `pnpm db:generate`, then commit the generated files.
- Domain modules (`catalog`, `customers`, `orders`, …) hold business logic only: no HTTP, oRPC or Hono imports.
  Every service takes `shopId` first, and dependencies point one way.
- Extension points are out-of-process (webhooks, API tokens, apps). Third-party code does not run in the core.

## Reporting bugs and proposing features

Use the issue templates. For larger features, open an issue first so we can agree on the approach before you build it.
For security problems, do not open a public issue: see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
