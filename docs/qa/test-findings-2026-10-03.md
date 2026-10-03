# Walkthrough test findings (3 Oct 2026)

> **Status: all 10 issues below are fixed** on `finish/qa-fixes` (commit `af84fe1`), plus #11: when the only reason the right vehicles weren't free is that they're in the workshop, the panel now suggests "Vehicle in the workshop" instead of "capacity full". The walkthrough was re-run afterwards and fully passes. The "smaller observations" at the bottom are **not** fixed yet.

I ran the whole of TESTING-WALKTHROUGH.md (Parts A–D) in the browser pane, on the `finish/qa-fixes` code.

**Most of it works.** These steps passed: date picker, close queue, auto-plan, plan page, every panel opening, suggested reasons, Skipped twice / Protected chips, Moves to, saving reasons, Other + note persisting, the publish gate, publish, the read-only view after publish, Fathima's list and order page (her message matched the preview word for word), the fleet lock after publish, loader, driver, Place an order, focus trap, Escape, backdrop and × close, and bad `?defer=` links.

**10 issues found**, most important first:

| # | Severity | Where | What's wrong | Proposed fix |
|---|---|---|---|---|
| 3 | **High** | Defer panel → "Why this order and not another" | The comparison is misleading. DEMO-006 (chilled) is ranked against ambient orders that never competed for a reefer, and DEMO-007 is labelled "Lowest impact" as if deferring it would help. DEMO-001, 002 and 004 are compared only with orders that were *also deferred*, and DEMO-008 shows a one-item list labelled "Lowest impact". | Only list orders that actually took a vehicle this order could have used: served orders with a matching vehicle type (reefer for chilled, van for van-only). If there are none, say plainly that deferring another order wouldn't free a vehicle. |
| 2 | **High** | Defer panel → red "Why it can't go" box | The wording is wrong. It says *"Every refrigerated vehicle is committed"* / *"Every van is already committed"* when they're actually **in the workshop**. The count lines (*"6 vehicles: vehicle in workshop"*) don't match the 4-vehicle fleet, because they count vehicle-trips. | Say "in the workshop" when that's the cause, naming the vehicles. Replace the count lines with a short list of distinct vehicles and why each couldn't take the order. |
| 8 | **High** | Defer panel → "Other · add a note" | Choosing Other pre-selects *"No van available"*. Saving with only a note records a wrong reason and sends it to the store. | Start the dropdown on "Choose a reason…" and require a choice. |
| 4 | Medium | Store message for permanent deferrals | It always ends *"The dispatcher will contact you about splitting or changing it."* That contradicts the panel ("the store needs to place it as smaller orders") and makes no sense for other reasons, for example *"Reason: ordered after the cutoff… splitting"*. | Tailor the last sentence to the reason. For too-large orders: "Please place it again as smaller orders." |
| 5 | Medium | Store order page (Fathima) | Under "This order moves to the next run", the old box still says *"Dispatch must update this order before delivery can continue."* That contradicts it. | When the deferral carries a moves-to date, show that instead of the generic text. |
| 1 | Medium | Dispatcher desk → Fleet status | The amber *"A draft plan exists… Re-run auto-plan"* warning shows on every draft, even right after auto-plan ran with no vehicle changes. | Only show it when a vehicle's status changed *after* the draft was built. |
| 10 | Medium | Fleet status after publish | The locked state is one line of small grey text. You didn't notice it and thought the buttons were broken. | Show it as a clear notice: "Plan published — fleet changes are locked for this day." |
| 9 | Low | Defer panel after publish | It still says *"The store at OUT010 **will see**"* after the message has gone out. | After publish, say "Sent to the store:". |
| 7 | Low | Dispatcher desk summary | *"1 require deferral decisions"* | Fix the plural: "1 requires a deferral decision". |
| 6 | Low | Driver run | Stops are numbered from zero: *"STOP 0 · TRIP 1"*. | Number stops from 1. |

**Smaller observations (not on the list unless you want them):**
- On a day with no plan, the desk says "No planning day found" without telling you which days do have one.
- When the queue is closed, the header **Generate plan** button duplicates **Run auto-plan**.
- On the plan page, the sidebar's "Planning desk" link goes to today. The in-page back link is correct. The sidebar belongs to WEB1's shell.
- Explanations sometimes read *"routine"* (from the allocator's priority text). That word means nothing to a dispatcher.
- The store order page shows "Requested for 2026-04-09" as a raw date.


