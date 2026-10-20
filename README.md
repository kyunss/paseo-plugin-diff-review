# Diff Review

Review unstaged and untracked changes in a Paseo workspace (parent repo and nested
checkouts), leave file and line comments, mark files viewed or ignored, then send the
review to an agent. Viewed files with no comments are staged after send.

Nested checkouts are found recursively (up to 4 levels): submodules, including those
`.gitmodules` hides with `ignore = all`, and tracked symlinks that point at another Git
checkout. Uninitialized submodules are skipped.

When more than one repository has changes, chips above the file list show each one with its
file count; tap a chip to hide or show that repository. Hidden repositories are saved per
workspace directory, so every session on the same checkout shares them. Comments on hidden
files are kept and are not sent.

Requires Paseo `>=0.11.0`. Plugins are unsandboxed: only install sources you trust.

## Install

From this repository on the daemon host:

```bash
npm install
npm run typecheck
paseo plugin install "$(pwd)"
paseo plugin reload diff-review
```

Or install from Git without a local checkout:

```bash
paseo plugin install git:OWNER/paseo-plugin-diff-review
# or a full URL / subdirectory:
# paseo plugin install https://github.com/OWNER/paseo-plugin-diff-review.git
```

Enable plugins under **Settings → Plugins** if needed. Progress and the prompt template are
host settings, so every client on that daemon shares the same review state.

## Use

1. Open the **Diff Review** workspace panel with its header button, or Command Center →
   **Open Diff Review**. The header button is the only quick entry on phones.
2. Pick a file in the left tree (`+` / `−` / `±` = add-only / delete-only / mixed).
3. File header:
   - **Viewed** — mark done and advance to the next unfinished file
   - Comment icon — whole-file note
   - Ignore — skip the file and advance
   - ⋯ — **View file** when the host can open the editor; **Discard changes** to
     revert unstaged worktree changes for that file (staged/index changes are left alone)
4. Inline comments: drag a range on web, or tap two lines on native. Expand context between
   hunks when needed. Ctrl/Cmd+Enter saves a comment.
   - Web keyboard shortcuts (not while typing in a comment box):
     - `j` / `k` (or arrow keys) — move the line marker
     - `Ctrl+F` / `Ctrl+B` — page down / page up
     - `gg` / `G` — jump to the first or last shown line
     - `c` — comment on the marked line
     - `v`, then `j` / `k` to extend, then `c` — comment on a range (`Esc` cancels)
     - `C` — file note
     - `r` — toggle viewed (advances to the next file)
     - `i` — toggle ignored (advances to the next file)
5. **Send** — pick a recent agent or create one, optionally add a note about the review as a
   whole, and choose whether to include viewed/ignored file lists (off by default; only
   comments are sent otherwise). The prompt comes from settings; eligible viewed files (no
   comments) are `git add`ed afterward. File and line comments are cleared after a successful
   send. Viewed and ignored marks stay.
6. Header ⋯ (when the workspace has changes) — **Clear comments**, after a confirmation.
7. Edit the prompt under **Settings → Diff Review**.

## Distribute

Recommended order for sharing this plugin with others:

| Path | When to use | How users install |
| ---- | ----------- | ----------------- |
| **Git** | Default for a public repo like this one | `paseo plugin install git:OWNER/paseo-plugin-diff-review` |
| **npm** | Versioned releases, private scopes, CI pins | `paseo plugin install npm:@scope/paseo-diff-review@1.0.0` |
| **Plugin registry** | Discoverability on [paseo.sh/plugins](https://paseo.sh/plugins) | `paseo plugin add owner/slug` after review |

Details live in Paseo’s [publishing guide](https://paseo.sh/docs/plugins/publishing). Short version:

1. **Ship from Git** — push this repo; users install with `git:` / `github:` / a full Git URL.
   Append `:path` if the plugin is not at the repo root. Optional `build` argv in
   `paseo-plugin.json` runs on install/update (this plugin needs none).
2. **Publish on npm** — set a real package name and version, drop `"private"`, typecheck,
   `npm pack --dry-run`, then `npm publish`. Keep `@getpaseo/plugin` and host modules in
   `devDependencies` only. Test with `paseo plugin install npm:<name>@<version>`.
3. **List in the registry** — add an `OVERVIEW.md` beside `paseo-plugin.json` (required for
   listing; no install commands in that file), optionally `icon` / `media` in the manifest,
   publish via npm or Git, then submit through
   [getpaseo/plugins](https://github.com/getpaseo/plugins). Registry installs pin the approved
   revision; users do not pick a ref.

Local `paseo plugin install /absolute/path` remains the right path while developing.

## Develop

```bash
npm install
npm run typecheck
paseo plugin reload diff-review   # after edits to an already-installed directory source
```

Layout: `client/` UI, `server/` git RPCs, `shared/` contracts. Host modules come from the
daemon; do not add them as runtime dependencies.
