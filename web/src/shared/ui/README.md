# App design system: operator console

This covers the signed-in console only. The public landing page has its own system in `web/DESIGN.md`.
Tokens live in `src/dd-theme.css` (Tailwind v4 `@theme`, so each `--color-x` is also a `bg-x`/`text-x` utility).
Global classes live in `src/index.css`. Owner: design-system lead. Feature pages use these and don't fork them.

## Rules that every page follows

1. **Colour is for abnormal states.** Red and amber only for alarms, faults and stale data, and always with a shape glyph and text (▲ critical, ◆ warning/stale, ● info, ○ no data). Demo data is blue and dashed, never amber.
2. **Stale data must not look live.** Use `<Freshness ts>` next to a live value or panel. The shell adds a strip under the topbar when the WebSocket has been down for more than 5 s.
3. **One header per page.** Use `<PageBar>`, or `<ProductHeader>`, which is the same component with a required icon. Don't hand-roll `sticky top-9 h-11` bars.
4. **No hex values in TSX.** Use tokens such as `text-ink-muted`, `bg-neutral-soft` or `var(--color-danger)`. If a token is missing, ask for one.
5. **Thai first.** Body text is 13 px IBM Plex Sans / Plex Sans Thai. Never put `uppercase` or `tracking-*` on text that can be Thai. Use `.overline`, which turns both off under `:lang(th)`.
6. **Destructive actions go through `<Confirm>`.** Its body says in one sentence what can't be undone.

## Page layout: `Page.tsx`

| Primitive | Use |
|---|---|
| `<PageBar title icon? tabs? actions? lede? back? status?/>` | Sticky 44 px header. `tabs` takes `{to,label,end?,count?}[]`. `back={{to:'/alarms'}}` is for detail pages. `status` holds an inline pill or `<Freshness>`. Below md it wraps: the title truncates and the tabs get their own row that scrolls. |
| `<PageBody>` / `.page-body` | Standard content padding (16 px, or 12 px on mobile) and vertical rhythm. |
| `<Card title actions pad>` | Bordered panel with an optional 36 px header. |
| `<Table head>` | Dense table with 36 px rows. Header cells use `.overline`. |
| `<ProductHeader>` (`Product.tsx`) | Alias of PageBar. `FacetGroup`, `facetOptions` and `toggleIn` are for explorer pages. |

## States: `Feedback.tsx` and `Status.tsx`

Every data view handles all of these (design 04 §7):

| State | Primitive |
|---|---|
| Loading a whole page | `<PageSkeleton rows?>` under the page's own `PageBar` |
| Loading a card or list | `<SkeletonRows rows? h?>`, or `<Skeleton w h>` for one block |
| Empty | `<EmptyState title body? icon? action? compact?>`. Say what will appear here and how to make it appear. |
| Error | `<ErrorState onRetry? title? detail? compact?>`. The icon is red and the copy stays ink. |
| Stale or offline | `<Freshness ts staleAfterMs?>` inline, or `<StaleNotice age?>` for a whole panel |
| Demo or simulated | `<DemoBadge/>` next to one value, `<DemoNotice/>` at the top of a page |
| No permission | Hide the action and show `<PermissionNotice role="admin"/>` |
| Message | `<Notice tone>` where tone is `info`, `warn`, `error`, `ok`, `demo` or `neutral`, plus an optional `action` |

Status pills, which always combine colour, shape and text:
`<SeverityBadge severity>` (`.sev[data-severity]`), `<AlarmStateBadge state ackedBy?>`, `<StatePill state>` (running/stopped/stale/unknown), and `<QualityMark q stale?>` (`.qmark[data-q]`). The value normalisers are `normSeverity` and `normAlarmState`.

## Controls (classes in `index.css`)

| Class | Use |
|---|---|
| `.btn` | Primary, blue, 28 px. Use one per view. |
| `.btn-ghost` | Secondary or toolbar action. |
| `.btn-danger` | Destructive. Only use it inside or after `<Confirm>`. |
| `.btn-sm` | 24 px, for toolbars and table rows. |
| `.btn-icon` | Square icon-only button. It needs an `aria-label`. |
| `.input`, `.input.num` | 28 px field. `.num` uses the mono font for numbers. `aria-invalid="true"` turns the border red. |
| `.field`, `.field-label`, `.field-hint`, `.field-error` | Label stack. Put `role="alert"` on the error. |
| `.overline` | Small section or column label. Safe for Thai. |
| `<Segmented>` / `.seg` | 2 to 5 mutually exclusive view options |
| `<Toggle>` | On/off setting that applies immediately |
| `<Confirm>` | Destructive confirm. Cancel gets focus first, Esc cancels, and focus is trapped and then restored. |
| `.dialog*` | Native `<dialog>` styling |
| `<DdIcon name>` | Lucide glyph by semantic name (`ddicons.ts`). Decorative unless you pass `label`. |
| `<Sparkline>` | Tiny inline trend. `.spark-limit` draws the dashed threshold line. |

## Shell (`app/Shell.tsx`), for reference

- 160 px dark rail with hover/focus flyouts. The active group has an inset blue bar.
- 36 px topbar with search (Ctrl K), a critical chip (▲, only while criticals are active), the plant clock, the live pill (●/◆/▲, tinted when not live), the bell and the user menu.
- Under the topbar: the data-link strip when the feed is down, then the red critical banner.
- Dark surfaces carry `.chrome`, so focus rings switch to `--color-focus-dark`. The skip link goes to `#main`.
- Reduced motion: everything inside `.app-shell` drops animations and transitions.
- UAT hooks are kept: `.side-nav`, `.topbar .live-pill`, `.top-clock`, `.user-btn`, `.palette-panel`, `.palette-input`, `.palette-option[data-item]`, `.skeleton`, `.error-state`.
