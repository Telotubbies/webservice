# App design system: operator console

This covers the signed-in console only. The public landing page has its own system in `web/DESIGN.md`.
Tokens live in `src/dd-theme.css` (Tailwind v4 `@theme`, so each `--color-x` is also a `bg-x`/`text-x` utility).
Global classes live in `src/index.css`. Owner: design-system lead. Feature pages use these and don't fork them.

## Rules that every page follows

1. **Colour is for abnormal states.** Red and amber only for alarms, faults and stale data, and always with a shape glyph and text. Each meaning owns its shapes:
   - **Priority** (`<SeverityBadge>`): ▲ critical, ◆ warning, ● advisory. Only priority takes the red/amber tints.
   - **Lifecycle** (`<AlarmStateBadge>`, incident status): ○ active/unacked (ink outline, bold), ◐ acknowledged (light outline), ✓ cleared (grey fill). Never the priority colours, so an active warning can't read as critical.
   - **Not current** (stale feed, reconnecting, no data in window): ◌, amber only when it is actual stale data.
   - **Normal running / online / live**: neutral. Green never means running; it is reserved for "within target" on analytics (SLOs, OEE) and for success feedback.
   Demo data is blue and dashed, never amber.
2. **Stale data must not look live.** Use `<Freshness ts>` next to a live value or panel. The shell adds a strip under the topbar when the WebSocket has been down for more than 5 s.
3. **One header per page.** Use `<PageBar>`, or `<ProductHeader>`, which is the same component with a required icon. Don't hand-roll `sticky top-9 h-11` bars.
4. **No hex values in TSX.** Use tokens such as `text-ink-muted`, `bg-neutral-soft` or `var(--color-danger)`. If a token is missing, ask for one.
5. **Thai first.** Body text is 13 px IBM Plex Sans / Anuphan. Never put `uppercase` or `tracking-*` on text that can be Thai. Use `.overline`, which turns both off under `:lang(th)`.
6. **Destructive actions go through `<Confirm>`.** Its body says in one sentence what can't be undone. Destructive buttons use `.btn-danger` (or a ghost button with danger text for the milder one), never the blue primary.
7. **One primary button per view.** Row actions (Acknowledge, Rotate key, Edit) are `.btn-ghost`; the page's main action or the bulk action carries the fill. Segmented controls (`.seg`) are neutral for the same reason.
8. **No decoration standing in for status.** No coloured left stripes on rows, cards or callouts, no solid status blocks, no tinted stat-tile rows: summaries are one bordered strip (see the Devices and SLO pages) and a segment tints only when its count is abnormal and non-zero.

## Page layout: `Page.tsx`

| Primitive | Use |
|---|---|
| `<PageBar title icon? tabs? actions? lede? back? status?/>` | Sticky 44 px header. `tabs` takes `{to,label,end?,count?}[]`. `back={{to:'/alarms'}}` is for detail pages. `status` holds an inline pill or `<Freshness>`. With tabs, `lede` moves to its own non-sticky line under the bar; a page with one view passes no tabs. Below md it wraps: the title truncates and the tabs get their own row that scrolls. |
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

## Console v6 kit (`ConsoleKit.tsx`, `Readout.tsx`, `DataGrid.tsx`)

The engineering-console density pass (docs/console-v6-plan.md §1.2–1.4), for working pages only. Its gallery is `/dev/ui` in a dev build; every component is shown in every state in both languages. Components take their strings as props, so each page brings its own EN/TH keys.

| Component | Use | Rules |
|---|---|---|
| `<Toolbar>` / `<ToolGroup>` / `<ToolButton>` | Icon over a 12px label, 56px wide, hairline between groups, connection pill on the right. Scrolls sideways at 390px instead of clipping. | Disabled tools turn grey, stay focusable and state the reason (`title` plus screen-reader text). Icons are Lucide (`DdIcon`). |
| `<SectionTag>` | Filled accent panel heading, e.g. "Equipment (8)". | Replaces a large heading inside a panel; text is `--color-on-accent` on `--color-accent`. |
| `<Readout>` | One dark panel: big mono value with unit, three secondary fields and a range bar with limit marks. | Quality and age are part of the panel: `state="stale"` reads "not current" in the warning-on-dark tone and `state="error"` in the critical one. Never show an old value as live. |
| `<DataGrid>` | Grouped two-tier headings, sticky header, 32px rows (28px with `dense`), mono right-aligned numbers, a unit, inline edit, one selected row. Below 768px the same table renders as cards, each cell labelled with its column, and `maxHeight` applies to the table layout only. | Selected row uses `--color-row-selected`; never a status stripe. Keyboard: arrows/Home/End move the row, Enter opens the inspector, Esc cancels an inline edit, focus ring on the row. A field whose value did not change commits nothing. The older `<Table>` keeps its API. |
| `<CommandChip>` | Chip coloured by command TYPE (HOME, MOVE, SET, WAIT, LOOP, END, OTHER). | Colour codes the type, never the status, and the chip always carries its word. An unknown command is OTHER. |
| `<RunBar>` | Run, Step, Pause, Stop queue plus a neutral status line, for the F05 queue only. | Step and Pause are not rendered when the caller passes no handler. Commands still go through `<Confirm>`, a reason and the audit log. |
| `<IoPanel>` / `<IoDot>` | DI/DO tabs and point rows. | On is a solid dot, off is a ring, and each row carries the on/off word: never colour alone. |
| `<InfoBanner>` | Blue strip under the page title. | States the page's scope and the safety limit: this console is not a safety system, interlocks stay in the PLC. |
| `<BottomDock>` | Log/Events tabs, collapsible, fixed heights. | There is no terminal in this app. Collapsing keeps the tab row visible. A drag handle comes with the app-level dock (D8). |
| `<ConnPill>` | Compact connection state beside the toolbar's main action. | Shows the state and the last time data arrived; offline and stale add a Lucide icon plus the word. |
| `Command kind` (`commandKind.ts`) | Maps a command word to its chip type. | Pure and unit-tested; unmapped words are `other`, never a status colour. |

New tokens in `dd-theme.css` (old names unchanged): `--color-readout`, `--color-readout-ink`, `--color-readout-dim`, `--color-row-selected`, `--color-cmd-{home,move,set,wait,loop,end,other}`, `--color-cmd-ink`, `--row-h-compact`, `--row-h`, `--tool-btn-w`. `--font-mono` was already there. Contrast is asserted in `shared/ui/tokens.test.ts`: readout pairs ≥ 7:1, the selected row and every chip ≥ 4.5:1 in both themes.

Not taken from the reference design:

- **No "STOP ALL" button.** This app has no plant-wide halt and is not a safety system; the banner says so and interlocks stay in the PLC.
- **No green "SERVO ON" pill.** Running is normal, so it stays neutral; colour marks abnormal states only (rule 1).
- **No Workspace tab and no hold-to-jog.** The first belongs to another product; the second bypasses the audited command queue.

## Shell (`app/Shell.tsx`), for reference

- 160 px dark rail with hover/focus flyouts. The active group has an inset blue bar.
- 36 px topbar with search (Ctrl K), a critical chip (▲, only while criticals are active), the plant clock, the live pill (●/◆/▲, tinted when not live), the bell and the user menu.
- Under the topbar: the data-link strip when the feed is down, then the red critical banner.
- Dark surfaces carry `.chrome`, so focus rings switch to `--color-focus-dark`. The skip link goes to `#main`.
- Reduced motion: everything inside `.app-shell` drops animations and transitions.
- UAT hooks are kept: `.side-nav`, `.topbar .live-pill`, `.top-clock`, `.user-btn`, `.palette-panel`, `.palette-input`, `.palette-option[data-item]`, `.skeleton`, `.error-state`.
