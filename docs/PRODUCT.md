# Product

<!-- impeccable:product-schema 1 -->

## Platform

Responsive web application built with Next.js, React, Prisma, and PostgreSQL.

## Users

- **Dispatcher:** plans confirmed orders on desktop, manages capacity and deferrals, publishes trips, and monitors exceptions.
- **Loader:** works from a shared dock tablet, follows stop order, records shortages or damage, and releases loaded vehicles.
- **Driver:** works from a phone in changing network conditions, selects an assigned vehicle, completes stops, and records delivery problems.
- **Store manager:** works from a phone or counter computer, places orders, follows delivery status, and confirms outcomes for one assigned outlet.
- **Operations leads and reviewers:** use a separate development access page for temporary accounts and evaluate the complete plan-to-receipt workflow.

## Product Purpose

Katapatha is Waypoint Group's delivery coordination product. It carries each operational decision, its reason, and its outcome from ordering and planning through loading, delivery, and store receipt. Success means every role can identify the next action relevant to them while the organisation keeps one understandable delivery record.

## Positioning

Katapatha presents one delivery operation through four role-specific workspaces. It reduces handoff gaps between dispatch, dock, road, and store teams while making delays, shortfalls, and uncertain connectivity explicit.

## Operating Context

- Planning starts in a dense desktop workspace and moves through a warehouse dock, an early-morning vehicle cab, and a receiving store.
- Orders depend on vehicle capacity, temperature compatibility, outlet delivery windows, loading order, fuel allowances, and depot constraints.
- Chilled goods, loading shortfalls, route problems, and failed stops need visible reasons and durable status changes.
- Drivers can encounter weak connectivity. The interface must report observed connection state honestly and must not claim offline durability until the outbox is implemented and verified.
- The product is run locally for development and design review. This branch also targets a repeatable Docker setup using a synthetic fixture.

## Implemented Capabilities

- Server-backed accounts, opaque cookie sessions, and role-based route guards.
- Persistent PostgreSQL models for users, outlets, vehicles, orders, plans, trips, stops, events, problems, fuel entries, and capacity actions.
- Allocation and validation services for operational planning.
- Role-specific dispatcher, loader, driver, and store workflows.
- CSV import and submission export paths used by the challenge workflow.
- Responsive desktop, tablet, and phone shells.

## Constraints and Boundaries

- Offline synchronization and a durable driver outbox are incomplete. Connectivity messaging must describe current browser reachability only.
- Temporary development accounts belong on `/access` and must be unavailable in production unless an operator explicitly enables them.
- Dataset-derived values and exported derivatives are confidential. The committed fixture must remain synthetic.
- Operational state, estimates, and locally recorded actions must be distinguishable in the interface.
- No production deployment metrics, testimonials, customer claims, or research findings are available. Do not invent them.

## Brand Commitments

- Product name: **Katapatha**, meaning mirror. The Sigiriya Mirror Wall metaphor expresses one delivery story visible from several perspectives.
- Preserve the approved Katapatha logo family and palette.
- Use the Sri Lankan visual identity as an expressive layer while keeping operational screens calm and task focused.
- Voice is direct, operational, calm under pressure, and explicit about uncertainty.
- The four-role structure remains central to the product.

## Product Principles

1. Carry the reason with every operational decision.
2. Show each role the next useful action without hiding shared delivery state.
3. Represent uncertainty honestly during shortages, delays, and signal loss.
4. Preserve a recoverable record across the plan-to-receipt loop.
5. Put sensitive development aids outside the production workflow.
6. Enforce ownership and assignment on every server mutation.

## Accessibility and Inclusion

- Dispatcher views remain scannable at desktop density and work at narrower widths without silent clipping.
- Loader controls use large targets suitable for a shared tablet and gloved interaction.
- Driver controls are readable and reachable with one hand and keep the dominant action in the thumb zone.
- Store views use plain language and surface status and outcome without requiring horizontal scrolling.
- Status, focus, and action treatments meet WCAG AA text contrast and never rely on colour alone.
- Motion follows `prefers-reduced-motion`, and every interactive control has a visible keyboard focus state.

## Evidence

- Application: `prototype-shakil/src/`
- Database model and seed: `prototype-shakil/prisma/`
- Automated checks: `prototype-shakil/src/**/*.test.ts` and `prototype-shakil/tests/`
- Brand assets: `prototype/public/logo/` and `design logo and colours/`
- Comparative audit: `notes/BRANCH-COMPARISON-AUDIT-2026-09-28.md`
