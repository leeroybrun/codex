# Fork maintenance (stable-base workflow)

This fork is maintained on top of **upstream stable Rust release tags** (e.g. `rust-v0.84.0`).
The goal is:

- keep our fork patches small and replayable
- make upgrades predictable (only move when upstream cuts a stable tag)
- keep CI “version labeling” accurate (our builds are based on a real upstream stable release)

## Branch model

- **`mcp-resume-fork/stable`** (stable branch): upstream stable tag + our fork patches on top.
  - This is the branch we build/release from.
- **`fork/patches`** (optional, but recommended): *only* our fork commits (no upstream merges).
  - This branch is the source-of-truth for “our changes” and is what we replay onto new tags.

If you don’t want a separate `fork/patches` branch, you can still upgrade by replaying
`<old_tag>..fork/stable` onto `<new_tag>`, but it’s more error-prone over time.

## Manual update workflow (LLM-friendly, copy/paste)

Assumptions:

- upstream remote is named `upstream` and points to `openai/codex`
- fork remote is named `origin`
- you release from `mcp-resume-fork/stable`

### 1) Fetch upstream tags and refs

```bash
git fetch upstream --tags
git fetch origin
```

### 2) Determine the newest upstream stable tag

```bash
git tag -l 'rust-v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n 1
```

Call this `NEW_TAG` (example: `rust-v0.84.0`).

### 3) Determine the current base tag of `fork/stable`

```bash
git describe --tags --match 'rust-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 origin/mcp-resume-fork/stable
```

Call this `OLD_TAG`.

If `NEW_TAG == OLD_TAG`, you’re already up to date.

### 4) Create an upgrade branch from the new tag

```bash
git switch --detach "$NEW_TAG"
git switch -c "bot/sync-${NEW_TAG}"
```

### 5) Replay our fork patches

**Preferred (if you maintain `fork/patches`):**

```bash
git cherry-pick "origin/fork/patches"
```

**Alternative (replay what’s on `fork/stable` since the old tag):**

```bash
git log --reverse "${OLD_TAG}..origin/mcp-resume-fork/stable" --pretty=%H > /tmp/fork-patch-commits.txt
while read -r sha; do
  git cherry-pick "$sha"
done < /tmp/fork-patch-commits.txt
```

If a cherry-pick conflicts:

- resolve conflicts
- `git add -A`
- `git cherry-pick --continue`

### 6) Validate

Run the same checks used for local development (example; adjust to what you changed):

```bash
cd codex-rs
cargo test -p codex-mcp-server
cargo build -p codex-cli
```

### 7) Push and open a PR

```bash
git push -u origin "bot/sync-${NEW_TAG}"
```

Open a PR to merge `bot/sync-${NEW_TAG}` → `fork/stable`.

## Automation (GitHub Actions)

This repo includes a workflow that can:

- detect a new upstream stable tag
- attempt to replay our patch commits onto it
- open a PR automatically when conflict-free

See `.github/workflows/fork-sync-stable.yml`.

Note: if the upstream tag introduces changes under `.github/workflows/*`, the default `GITHUB_TOKEN` cannot
push the upgrade branch. Configure the Actions secret `FORK_SYNC_PUSH_TOKEN` (PAT classic: `repo` + `workflow`)
to enable fully automated upgrades.

## Fork artifacts + npm publishing

### GitHub Releases (fork builds)

`.github/workflows/fork-artifacts.yml` builds and publishes **unsigned** fork artifacts on every push to:

- `mcp-resume-fork/stable`Releases are named after the upstream stable base version plus the Actions build number, e.g.:- `0.84.0-build-123-a1`

### npm package (optional, gated)

The same workflow can also package and publish an **experimental** npm package for the forked MCP server
(`codex-mcp-server`) that includes resume-from-rollout support.

Publishing is **disabled by default** and is gated behind GitHub Actions repo variables:- `ENABLE_FORK_NPM_PUBLISH`: set to `"true"` to enable publishing
- `FORK_NPM_PACKAGE_NAME`: example `@leeroybrun/codex-mcp-server-resume`

The published npm version is semver and is derived from the upstream base version plus the Actions run, e.g.:

- `0.84.0-resume.123.a1`

#### What you (maintainer) must set up on npm

To actually publish from GitHub Actions without an `NPM_TOKEN`, configure **npm trusted publishing (OIDC)**:

- Create the package under your npm scope (once).
- Configure the package to trust this GitHub repo/workflow as a publisher.

Once configured, enabling the repo variables above will make publishes automatic on pushes to `mcp-resume-fork/stable`.
