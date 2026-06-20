# napplet-note

[![CI](https://github.com/hyprgate/napplet-note/actions/workflows/ci.yml/badge.svg)](https://github.com/hyprgate/napplet-note/actions/workflows/ci.yml)

Forkable source repository for the Hyprgate built-in napplet currently packaged as `@hyprgate/napp-note-viewer`.

This repository was split from `hyprgate/gui` and is mounted back into the parent checkout as `napplets/note`.
It still expects the parent workspace when built through Hyprgate because shared `@hyprgate/*` packages remain workspace dependencies.

## Parent checkout

```bash
git clone --recurse-submodules git@github.com:hyprgate/gui.git
cd gui
pnpm install --frozen-lockfile
pnpm --filter @hyprgate/napp-note-viewer build
```

## Testing

Run these checks from a Hyprgate parent checkout so workspace dependencies resolve:

```bash
git clone --recurse-submodules git@github.com:hyprgate/gui.git
cd gui
pnpm install --frozen-lockfile
pnpm --filter @hyprgate/napp-note-viewer conformance
pnpm --filter @hyprgate/napp-note-viewer test
pnpm --filter @hyprgate/napp-note-viewer build
```

The `conformance` script builds the napplet and runs `@napplet/conformance-cli` against `dist/`. CI runs the same conformance, unit test, and build checks for every push and pull request.

CI runs from the standalone napplet repository but checks out `hyprgate/gui` to resolve private `workspace:*` packages. Configure `HYPRGATE_GUI_CHECKOUT_TOKEN` with read access to `hyprgate/gui` before enabling GitHub Actions.
