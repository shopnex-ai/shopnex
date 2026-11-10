# Releasing

Releases are cut by pushing a version tag. The `Release` workflow
(`.github/workflows/release.yaml`) runs lint, typecheck and build, publishes
the main ShopNex and Stripe app Docker images to GHCR with the same version
tag, then publishes a GitHub Release with generated notes and both image pull
commands.

## Cadence

Ship a stable release every one to two weeks, on a fixed weekday (Tuesday or Wednesday), not on a weekend.

- **Batch the changes.** Everything merged to `main` since the last tag goes out together as one `minor` release,
  so the notes read as "what's new" instead of one small change. Don't cut a release per merged PR: everyone
  watching the repo for releases gets a notification for each one.
- **Hotfixes ship right away.** A security fix, or a bug that breaks installs or data, goes out as a `patch`
  release as soon as it is on `main`. Everything else waits for the next scheduled release.
- **Try risky changes first.** Tag a release candidate (`v0.14.0-rc.1`, see Notes) and run it before tagging the
  stable version.
- **`main` stays usable in between.** Production installs pin `SHOPNEX_VERSION` to a release tag; only people
  who want the latest changes follow `main` or `latest`.

## Steps

1. Make sure `main` is green in CI and contains everything you want to ship.

   ```sh
   git checkout main && git pull
   ```

2. Bump the version everywhere. This sets `version` in every workspace
   `package.json` (except `@shopnex/storefront-sdk`, which is versioned on its
   own) from the latest tag:

   ```sh
   pnpm bump patch   # or: minor | major | 1.2.3
   ```

   Commit the result, open a PR to `main` and merge it, then
   `git checkout main && git pull`.

3. Tag the merge commit and push. Use the version `pnpm bump` printed:

   ```sh
   git tag v0.10.0
   git push origin v0.10.0
   ```

4. Watch the run in the **Actions** tab, then review the release under
   **Releases**. The notes include the matching image references, for example
   `docker pull ghcr.io/shopnex-ai/shopnex:v0.8.0` and
   `docker pull ghcr.io/shopnex-ai/shopnex-stripe:v0.8.0`. Edit the notes there
   if needed.

## Notes

- The release also attaches `shopnex-v<version>-node.tgz` and its `.sha256` (the `node-bundle` job). That is the
  build `npx create-shopnex` downloads, so the version `pnpm bump` sets in `packages/create-shopnex` must be the
  tag's version: the CLI asks for exactly its own (the `npm` job fails the release's last step if they differ).
  After the bundle is attached, the `npm` job publishes `create-shopnex` to npm (`latest`, or `next` for a
  pre-release) with provenance. It needs the `NPM_TOKEN` repository secret, an npm automation token that can publish
  `create-shopnex`; without it the job only says it skipped.
- `create-shopnex@edge` is the rolling build of `main` (`.github/workflows/edge.yaml`): each push replaces the file of
  the `edge` pre-release, and the CLI is published to the `edge` dist-tag only when `packages/create-shopnex`
  changed. The `edge` release is created once and must not be edited by hand or by a workflow: an edit rebuilds the
  landing (`landing-rebuild.yaml`), and the changelog is built from GitHub Releases.
- The release workflow puts the first image from each pull request's description under its entry in the
  generated notes (`scripts/release-notes-images.mjs`). PRs without an image just list their title, and a failure
  there never fails the release. Ask contributors for a screenshot on visible changes (see `CONTRIBUTING.md`).
- Tags with a suffix (e.g. `v0.8.0-rc.1`) are published as pre-releases.
- Stable releases also move the `latest` GHCR tag, and `docker save` archives of
  both images are attached to the release as assets.
- Every release tag, including pre-releases, gets matching versioned GHCR tags
  for ShopNex and the Stripe app. Both images are multi-arch (`linux/amd64` and `linux/arm64`), built natively
  on each architecture and merged into one tag.
- Fix a bad release by deleting the GitHub Release and tag
  (`git push origin :refs/tags/v0.8.0`), fixing, and tagging again.
- The workflow does not publish to npm. If the `@shopnex/*` packages should be
  published, bump their `version` fields in the release commit and add a
  publish step.
