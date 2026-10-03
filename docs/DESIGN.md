# Katapatha Design System

<!-- impeccable:design-schema 1 -->

## Direction

Katapatha uses Shakil's role-specific operational layout as its structural foundation: a dark desktop rail, focused working surface, contextual details, tablet loading queues, and a single-column driver shell. The approved Katapatha identity replaces the Waypoint rings mark and runtime palette choices.

The product should feel like a calm control surface used during a real delivery day. Brand expression belongs at the public entry, sign-in, empty states, and major milestones. Dense operational screens favour clarity, hierarchy, and fast scanning.

## Brand Assets

- Use the supplied Katapatha lockups and marks from `apps/web/public/logo/` (`katapatha-lockup-light.png` on dark surfaces, `katapatha-lockup-dark.png` on light).
- Use the light lockup on the dark navigation rail and dark lockup on light surfaces.
- Preserve the logo aspect ratio and clear space. Do not redraw, recolour, or place it inside a decorative tile.
- The public landing page may use restrained route-line and mirror motifs derived from the visual identity. Avoid generic logistics stock imagery.

## Colour

| Token | Value | Use |
|---|---:|---|
| Navy | `#20364E` | Navigation, headings, primary brand field |
| Flame | `#F6B723` | Primary actions and active progress |
| Ruby | `#AE0109` | Critical status and destructive actions |
| Ochre | `#FBCD5A` | Warm brand accent and highlights |
| Crimson | `#D80511` | Strong alert accent |
| Ink | `#0F172A` | Primary text |
| Muted | `#526277` | Secondary text with AA contrast |
| Canvas | `#F1F5F9` | Application background |
| Raised | `#F8FAFC` | Secondary surface |
| Surface | `#FFFFFF` | Cards and forms |
| Link | `#2563EB` | Text links and information actions |

Action yellow is reserved for the dominant action and progress. Status colours always appear with a label or icon.

### Night theme

There is exactly one palette. There is also exactly one **night rendering** of
it, for the driver, because a predawn run starts at 03:30 in a dark cab and a
full-brightness white screen is a safety problem rather than a preference.

- Night is the same palette re-mapped onto dark surfaces, not a second palette.
  Flame stays the dominant action; status hues keep their meaning.
- It is defined once, in `packages/tokens`, under
  `@media (prefers-color-scheme: dark)` with a `[data-theme="dark"]` override so
  the driver can pin it. The `tokens.css` and `tokens.ts` mirrors stay in step.
- It applies to the driver surfaces only. Dispatcher, loader and store stay
  light; choosing a theme for them is still not part of the product.

## Typography

- Use the existing Inter/system sans stack for the application.
- Body copy is at least 14px on dense desktop surfaces and 16px on phone forms and task flows.
- Use weight and spacing before size to establish hierarchy. Keep page titles compact and operational.
- Use tabular numerals for capacity, fuel, counts, times, and quantities.

## Shape, Depth, and Spacing

- Controls use 8px corners; cards use 10–14px corners.
- Prefer borders and surface changes to shadows. One restrained shadow may separate a pinned phone action or elevated sign-in panel.
- Use an 8px spacing rhythm with 4px adjustments for dense table content.
- Avoid gradients, glass effects, decorative blobs, and repeated rounded containers.

## Layout

- **Desktop:** persistent 212px rail, fluid primary surface, optional sticky context panel.
- **Tablet:** two-column or master-detail layouts where the task benefits; loading actions use 44px targets.
- **Phone:** one column, no page-wide horizontal scroll, compact header or bottom navigation, status and outcome visible in the first card view.
- Tables may scroll inside an explicitly labelled container on narrow screens, but decision-critical fields should use mobile cards.

## Interaction

- Each view has one visually dominant action.
- Disabled actions explain the unmet condition nearby.
- Mutations show durable state after completion; transient success copy does not substitute for persisted results.
- Touch targets are at least 44 by 44px on tablet and phone.
- Focus rings are visible on every interactive element.
- Animations are brief and functional, and are disabled when reduced motion is requested.

## Status and Connectivity

- Pair status colour with text and an icon or shape where space allows.
- Connectivity labels report verified browser and server reachability: `Checking`, `Connected`, or `Offline`.
- Never imply background sync. The native driver app drains its outbox in the foreground only; no screen may suggest work moves while the app is closed.
- Durable offline storage may be claimed on the native driver app, where it is verified, and never on the web PWA. Route the wording through `apps/mobile/src/outbox/claims.ts` rather than writing it per screen.
- A vehicle position is always rendered with the age of the report behind it. A position without its age is not an acceptable component.
- An estimated arrival is visibly distinct from an observed one, and becomes a range rather than a time once the last report is too old to support a single figure.

## Content

- Use short action labels: `Publish plan`, `Mark loaded`, `Record arrival`, `Confirm receipt`.
- Put the object before supporting detail: order number, outlet, time window, status, then reason.
- Write errors in plain language and place recovery instructions beside the failed action.
- Temporary usernames, passwords, challenge notes, and prototype instructions belong on the development-only `/access` page.

## Responsive Acceptance Criteria

- No document overflow at 390px, 768px, 1024px, 1280px, or 1440px.
- Store managers can see order status and outcome at 390px without horizontal scrolling.
- Sign-in works at 320px and does not reveal credentials.
- Dispatcher exception and publish state remain visible at 1024px.
- Loader and driver primary controls remain at least 44px high.
