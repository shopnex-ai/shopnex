# Instructions for Claude

## Screenshots for new features

Every new feature or visibly changed behavior you can see (admin, storefront, checkout, an app's pages) needs
screenshots in the pull request. Take them yourself as part of the work, without being asked: don't finish a feature
without them. Bug fixes, refactors, tests and dependency changes don't need them.

Screenshots live in a separate public repo, **`shopnex-ai/shopnex-screenshots`**, never in this repo (no images or
screenshot branches here). One folder per pull request number, PNG files with short descriptive names
(`161/choose-processor.png`). The first image of a PR is shown under its entry in the release notes, so put the most
representative one first.

### Fast path

1. **Open the PR first** (the folder is named by its number): `gh pr create --base main ...`. Screenshots are added
   to the description afterwards.
2. **Run the change and look at it** with the Chrome tools: load them with one `ToolSearch` call
   (`tabs_context_mcp`, `navigate`, `computer`, `javascript_tool`), open a tab, navigate, put the page in the state
   worth showing (open the dialog, fill the form with demo data, pick the item), and take
   `computer` → `screenshot` with `save_to_disk: true`. The tool result names the saved `.jpg` path. Close your tab
   when done and stop any server you started.
3. **Push them** (one command block; replace `PR` and the names):

   ```sh
   PR=161
   R=$TMPDIR/shopnex-screenshots
   [ -d $R ] && git -C $R pull -q || gh repo clone shopnex-ai/shopnex-screenshots $R
   mkdir -p $R/$PR
   sips -s format png /path/from/tool/screenshot-1.jpg --out $R/$PR/choose-processor.png >/dev/null
   git -C $R add $PR && git -C $R commit -q -m "Add screenshots for #$PR" && git -C $R push -q origin main
   ```

   Check each one answers 200: `curl -s -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/shopnex-ai/shopnex-screenshots/main/$PR/<name>.png`.

4. **Put them in the PR description** under a `## Screenshots` heading, before the long sections, using exactly this
   form (width 700; about 500 for narrow pages such as a card form):

   ```md
   <img src="https://raw.githubusercontent.com/shopnex-ai/shopnex-screenshots/main/161/choose-processor.png" width="700" alt="What it shows">
   ```

   Edit with `gh pr view N --json body -q .body > body.md`, change it, `gh pr edit N --body-file body.md`.

When a follow-up commit changes how it looks, replace the files in the same folder (same names) and push again; the
description needs no edit.

### Rules

- Demo data only: fake names, the `4242…` test card, `localhost` URLs. Never real customers, orders, API keys, tokens
  or emails in a screenshot; look at the image before you push it.
- Show the states a reviewer needs (empty, filled, error, dark mode if it differs), not every page. 2–4 images is
  typical.
- A page that needs a session you can't get (e.g. an admin-embedded app page): render it to a static HTML file with a
  `<base href>` to the running app and screenshot that, and say so in the PR.
- Don't skip it because a feature is "small". Skip it for bug fixes, and for changes with no visual effect (API,
  schema, tests, refactors).
