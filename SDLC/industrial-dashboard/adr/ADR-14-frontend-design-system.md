# ADR-14 — Frontend foundation & design system (custom tokens, no Tailwind)

Status: **Accepted** · Supersedes: doc 03 frontend row "Tailwind + shadcn/ui" (never implemented)

## Decision

| Concern | Choice | Why |
|---|---|---|
| Routing | `react-router` (data router) | deep links, back button, per-org/site URL scope |
| Server state | `@tanstack/react-query` | caching, retries, cache invalidation by org/site |
| Realtime | existing `LiveStore` (rAF flush, ring buffer), keyed by site | already proven; Query is not designed for 1 Hz × N tags |
| Auth | `oidc-client-ts` | PKCE, in-memory tokens (ADR-12) |
| i18n | `i18next` + `react-i18next`, namespaces per feature, `th` + `en` | user requirement |
| Styling | **CSS custom-property tokens + plain CSS modules per component**; no Tailwind, no shadcn | user decision; avoids rewriting all 952 lines of `styles.css` in one go |
| Primitives | our own accessible components on native elements: `<dialog>` (modal + focus return), `<button>`, `<select>`, `popover` attribute where supported, roving-tabindex tables | no Radix dependency; native semantics cover our needs |
| Charts | uPlot (kept) | ADR-11 |
| API types | `openapi-typescript` generated from the backend OpenAPI | removes hand-maintained `types.ts` drift |

## Tokens (acceptance criteria, not preferences)

These come from SDLC 07 and are enforced by a CI check (`web/scripts/check-tokens.mjs` parses `tokens.css` and fails if any floor is broken):

| Token | Value | Floor source |
|---|---|---|
| `--text-body` | 15px | 07 typography |
| `--text-label` | 14px | 07 |
| `--text-value` | 20px (19–24) | 07 |
| `--text-display` | 32px (28–40) | 07 |
| `--text-caption` | 12px (meta only — never values or alarms) | 07 |
| `--touch` | 44px | WCAG / 07 |
| `--touch-control` | 48px (anything that writes to equipment) | 07 GOT style |
| contrast | body/value ≥ 4.5:1, dim ≥ 3:1 on `--bg-panel` | WCAG AA |

- Colours: red/amber stay **reserved** for alarm/warning.
- The accent is a single token; the doc-07 vs `styles.css` drift (violet vs orange) is settled as **violet `--accent`** and documented back into 07.
- Wording in docs and UI copy: "informed by ISA-101 / ISA-18.2 principles". We do not claim compliance.

## Migration strategy (incremental, reviewable)

1. Split `styles.css` into `tokens.css` (variables only, new floors) and `legacy.css` (existing rules). Fix the floors in tokens first. That alone fixes F7 everywhere, and layouts that break get fixed in the same PR.
2. New components live in `web/src/shared/ui/<Component>/{index.tsx,style.css}` and use only tokens.
3. Pages move to `features/*` one at a time: Overview → Alarms → Mimic → Trends → Tags → Commands → Health → Settings. When a page moves, its rules are deleted from `legacy.css`. A PR is done only when `legacy.css` lost the rules for that page.
4. `legacy.css` is deleted when it is empty.

## UI permission gating

- The UI hides or disables controls based on `/api/v1/me` permissions. This is **UX only**; the server enforces every rule (CONTRACT.v2, doc 16).
- When controls are unavailable, the UI shows **why**: role, viewport < 768 px ("Controls require a workstation display"), site control disabled, edge offline, edge clock untrusted.
- Hiding controls on small screens reduces mis-taps. It is **not** a safety control (doc 16 §1).

## Tenant data hygiene on switch

- Query keys start with `[orgId, siteId]`.
- On an org/site change:
  - `queryClient.removeQueries({predicate: other scope})`
  - `live.reset()`
  - close the WS
  - the route subtree is keyed by `orgId:siteId`, so it remounts
- Test: `features/shell/switch.test.tsx` asserts no element from the previous org renders after a switch.
