<!-- HYPRGATE NAPPLET MIRROR NOTICE:START -->
> This repository is a read-only mirror of the `note-viewer` napplet from `hyprgate/gui`.
> Open issues and pull requests in https://github.com/hyprgate/gui.
> Do not push commits to this standalone napplet repository; direct changes are overwritten by Hyprgate's mirror workflow.
<!-- HYPRGATE NAPPLET MIRROR NOTICE:END -->

# Note Reader

Note Reader is tracked in the Hyprgate workspace at `napplets/note`, packaged as
`@hyprgate/napp-note-viewer`. Standalone napplet repositories are generated mirrors.

## Copied references

Load a raw event ID, `note1`, `nevent1`, or `naddr1` reference through the visible
Load button or Enter. Copied event pointers retain input relay hints, then append
unique relay hints actually observed by the runtime. Account relay defaults are
not added merely because they are configured. Replaceable references remain
`naddr` pointers.

Copy uses the browser clipboard with the established copy-command fallback when
an opaque iframe cannot access the Clipboard API. Success is shown only when a
copy succeeds; temporary elements are removed and focus is restored.

## Paja runtime

```bash
pnpm --filter @hyprgate/napp-note-viewer paja
```

This starts Kehto Paja and the napplet's Vite dev server together, using
the port configured in `vite.config.ts`.

## Testing

From the existing Hyprgate parent checkout:

```bash
pnpm --filter @hyprgate/napp-note-viewer test
pnpm --filter @hyprgate/napp-note-viewer type-check
pnpm --filter @hyprgate/napp-note-viewer build
```

`e2e/note-relay-provenance.spec.ts` verifies real local relay delivery, copied
pointer fields, and the actual OS clipboard in the deterministic browser harness.

## Intent delivery

The app receives `napplet:note/open` through the host-injected
`intent.onDelivery` subscription and validates the contract and payload before
applying it. The binding buffers delivery until subscription; no app-specific
INC readiness topic is required. Buffered delivery takes precedence over URL startup state.

The shell target-controller migration is still in progress; see
[package migration status](../../docs/napplet-package-migration.md).
