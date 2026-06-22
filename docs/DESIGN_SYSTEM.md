# Massif — Design System

**Binding reference for all UI work.** Any change to `web/` must follow this document. Visual charte
(rendered): https://claude.ai/code/artifact/62275417-0b97-4ae1-a170-6b2c999a2673

Source of truth for token *values*: [`web/src/app/globals.css`](../web/src/app/globals.css) (`@theme`).
Chart/SVG colours are named by meaning in [`web/src/lib/theme.ts`](../web/src/lib/theme.ts).

---

## 0. The one rule

> **Colour encodes physiology — never category.**

| Colour | Token | Meaning |
|---|---|---|
| **Blue — Alpine** | `aerobic` / `alpine-*` | aerobic channel · CTL (fitness) · "fresh" — the cold valley pole |
| **Orange — Summit** | `neuro` / `summit-*` | neuromuscular channel · ATL (fatigue) — the warm summit pole |
| **Green / Amber / Red** | `ready` / `caution` / `rest` | readiness state only (traffic light, TSB & ACWR zones, gauges) |

This maps the logo's blue→orange gradient directly onto the product's two load channels.

**Sports are identified by glyph + name, never by colour** (see `web/src/lib/labels.ts`). A blue/orange
"charge par sport" chart would collide with "charge par canal" — so categorical colour is forbidden. If a
categorical distinction is ever unavoidable, use stone tints + the sport glyph, not hues.

---

## 1. Colour

Two brand ramps + the existing warm neutral. **Never write a raw hex or a `sky-*`/`blue-*` class in a
component** — use the tokens below.

### Brand
- **Alpine** (`alpine-50 … alpine-950`, anchor `alpine-500 #2b7bcc`) — the single brand blue. Replaced the
  old three blues (`sky`, wordmark navy, icon azur). Use for primary actions, links, focus rings, selected
  nav, the aerobic channel.
- **Summit** (`summit-50 … summit-950`, anchor `summit-500 #f3700f`) — the single brand orange. Use for the
  neuromuscular channel / fatigue. Distinct from Strava's red-orange on purpose.

### Channel aliases (CSS vars, dark-mode aware)
`--color-aerobic` (→ alpine-500, brightens to alpine-400 in dark) · `--color-neuro` (→ summit-500 → summit-400).

### Readiness state — the traffic light
Readiness/status (good→warn→bad) **is the Tailwind `emerald` / `amber` / `red` ramp** — these are first-class
and sanctioned, not off-system:
- **In markup, use the Tailwind classes directly** with their tints: `bg-emerald-500` (dot), `text-emerald-700
  dark:text-emerald-400` (text), `bg-emerald-50 dark:bg-emerald-950/40` (soft pill) — and the amber / red
  equivalents. (A single-value `--color-ready` token can't generate `-700`/`-50` tints, so the ramp lives in
  the Tailwind classes; that's by design.)
- **In SVG / canvas** (no Tailwind classes), use `STATE.*` from `theme.ts`. The tokens
  `--color-ready`/`--color-caution`/`--color-caution-soft`/`--color-rest` **point at**
  `emerald-500`/`amber-500`/`yellow-500`/`red-500` (locked by `var()`, identical values) — one source of truth
  across both layers. Retune readiness in exactly one place: override the Tailwind ramp in `@theme`.

Use the traffic light for: training readiness, TSB/ACWR zones, recovery scores, connection freshness. It also
covers conventional **success / error / destructive** affordances (a green "Enregistré ✓", a red delete button,
form-validation errors) — those are not part of the physiology contract and legitimately use emerald/red. Never
use this ramp to encode a sport or a load channel.

### Neutral & ink
**Stone** (Tailwind default) — surfaces & most text. Warm grey, matches the icon's cream ground.
`--color-page #f7f5f1` (warm paper, the app canvas; dark → `#0c0a09`) / cards `bg-white` (dark `stone-900`).
`--color-ink #1b2330` — charcoal-navy (the wordmark colour; dark → `#f5f5f4`); set as the default body text
colour in `globals.css` `body{}`. Components may still set explicit `text-stone-*` where a specific weight is wanted.

### Partner
`--color-strava #fc4c02` (`text-strava`, `border-strava`), `--color-garmin #007cc3` (`text-garmin`).
Used only for the respective integration's mark/CTA.

---

## 2. Typography

- **Geist Sans** (`font-sans`) — all UI & body. Loaded in `web/src/app/layout.tsx`.
- **Geist Mono** (`font-mono`) — formulas, codes, data dumps.
- No decorative/serif display face: hierarchy comes from **weight + size + tight tracking**, fitting an
  instrument app (Strava/Garmin/Whoop are all sans).
- **Every number uses `tabular-nums`** so metric columns don't jitter. This is mandatory for CTL/ATL/TSB,
  durations, dates, loads.

---

## 3. Shape & elevation

- **Radii:** `rounded-md` (buttons/chips) · `rounded-xl` / `--radius-card` (cards) · `rounded-2xl` /
  `--radius-hero` (hero sections) · `rounded-full` (pills, dots, gauges).
- **Bordered, not shadowed.** Default surface = `border border-stone-200 bg-white dark:border-stone-800
  dark:bg-stone-900`, no shadow (faithful to the logo's clean line). `shadow-sm` on buttons; `shadow-lg`
  reserved for floating overlays (help tooltips, popovers).
- **Navigation** (`nav.tsx`): desktop = top app-bar — `massif.` wordmark left, three text tabs right, active
  tab marked by a 2 px **Alpine** baseline indicator (the logo's rising line). **Mobile carries almost no
  chrome:** a fixed **floating frosted island** at the bottom (rounded-full, hairline border, soft `shadow-lg`)
  with two labelled tabs — **Accueil / Profil** (active = soft `bg-alpine-100` pill, `animate-nav-pop` +
  `active:scale-95`). A top bar appears on **the home screen only** (`massif.` wordmark + a discreet
  **gradient-stroke coach icon**, no fill). Every other screen leads with its own title instead:
  - **Profil** → `Profil — Parle-nous de toi` (no coach icon).
  - **Coach** → an ultra-simple **back arrow** (top-left → home) + the **coach's name** (`personaName`), no
    wordmark — maximises chat space.
  - **UX rule:** never put a fixed bottom nav under a text-entry view (keyboard conflict). Coach is reached
    from the home coach icon, and the **coach page has no nav bar on mobile at all** (focused chat).
- **Home (dashboard)** has no "Tableau de bord" title: it leads with a **primary-goal recap** (`GoalBadge` +
  a "Personnaliser mes objectifs" link → `/profil`), then the **coach section**, which stacks the **coach's
  name + recommended-readiness pill + date/confidence** beside the avatar, sized to **exactly the avatar's
  height** (`items-stretch` + `justify-between`).
- **Mobile titles & safe areas:** mobile page titles use the **wordmark scale** (`text-lg font-bold`), not the
  big desktop heading. `viewport-fit=cover` is on, and every page wrapper pads `pt-[env(safe-area-inset-top)]`
  (bottom island pads `pb-[env(safe-area-inset-bottom)]`) so content clears the notch/camera and home indicator.

---

## 4. Charts & gauges

Import colours from `@/lib/theme` (`VIZ`, `STATE`, `AXIS`, `MUTED`) — **never inline hex**.
- Line series: 2 px stroke, `strokeLinejoin/Linecap="round"`. `VIZ.aerobic` (CTL/fitness) · `VIZ.neuro`
  (ATL/fatigue & neuromuscular channel).
- Zone bands: `STATE.ready` @ ~0.08, `STATE.rest` @ ~0.07 opacity. Baseline: `AXIS`, dashed `3 3`.
- Gauges: zones from `STATE.*`, but **only the active zone is tinted** (~0.6) — the others sit as a faint
  context backdrop (~0.16). One colour accent per gauge (the current state), not a full rainbow. The dark
  needle (`stone-900 / white`) marks the value; value number + label carry the active-zone colour.

**Restraint:** colour earns its place. Don't paint every threshold/zone at once — let the *current* state be
the single accent and keep the rest quiet. This is how the dashboard stays calm despite being data-dense.

---

## 5. The brand gradient

`--gradient-massif` (valley blue → summit orange) via the `bg-massif` utility. **The gradient means "coach":**
the primary "Discuter avec le coach" CTA (dashboard, filled) and the mobile top-bar coach icon (as a *stroke*,
no fill). Don't sprinkle it elsewhere — it's the coach signature, not a background.

The athlete's own chat bubbles use `bg-message` (`--gradient-message`) — a **readability-tuned** variant
anchored on the dark halves (`alpine-600 → summit-700`) so white text stays ≥5:1 (AA) across the whole blend.
**Never put white text on a gradient that reaches the vivid `summit-500`** (fails contrast). Gradient surfaces
with light text must keep both endpoints dark enough; verify contrast before shipping a new one.

---

## 6. Do / Don't

✅ `bg-alpine-600`, `text-summit-500`, `VIZ.neuro`, `STATE.rest`, `bg-emerald-500`/`text-amber-700` (readiness),
`bg-page`, `text-stone-*`, `tabular-nums`, `font-sans`.
❌ `sky-*` / `blue-*` / `orange-*` classes (the aerobic/neuro families — use `alpine-*`/`summit-*`) · raw
`#rrggbb` in a component · colouring anything by sport · **emerald/amber/red for a sport or load channel**
(they're the readiness ramp only) · a second display font · a gradient anywhere but the primary coach CTA ·
`font-family` overrides in CSS.

When unsure, read the token values in `web/src/app/globals.css` and the meanings in `web/src/lib/theme.ts`.
