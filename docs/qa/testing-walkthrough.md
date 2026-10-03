# Katapatha: testing walkthrough

Everything happens in the browser at **http://localhost:3000** (API on :3001, web started with `ALLOW_DEMO_ACCESS=1` so `/access` has one-click sign-in).

**Fresh start ("reset")** between parts:

```bash
pnpm demo:reset
```

(It asks you to type `yes`. If `pnpm` is unavailable: `echo yes | DATABASE_URL=… node scripts/demo-reset.mjs`.) A reset signs everyone out.

Ticks (✔️ / [x]) record the run on 3 Oct 2026 against the `finish/qa-fixes` branch.

---

## First, what are we testing?

Katapatha runs one delivery day from the Peliyagoda depot. The demo day is **Thursday 9 April 2026**. Four people use it:

| Person | Role | What they do |
|---|---|---|
| **Nimal** | Dispatcher | Plans the day: decides which truck carries which order |
| **Ranjith** | Loader | Loads the trucks at the dock |
| **Sunil** | Driver | Delivers to the shops |
| **Fathima** | Store manager (shop **OUT074**) | Orders goods and sees what's coming |

On a normal day the dispatcher:

1. **Closes the order queue**, so no more orders come in.
2. **Runs auto-plan**, which makes the computer put orders onto trucks.
3. Gets told that **some orders don't fit**. These are called **deferred orders**: they move to the next day.
4. **Picks a reason for each deferred order** in the panel that slides in from the right. That panel is the main new feature you're testing.
5. **Publishes the plan.** The trucks get loaded, and the shop sees why its order moved.

**Which orders get deferred depends on which trucks are working.** If every truck works, only one order (DEMO-012) is deferred, because it's too big for any truck. To get more deferred orders, you put a truck "in the workshop" first. Part B shows you how.

---

## Part A: the simple case (one deferred order) — ✔️ passed 3 Oct

### A1. Sign in as Nimal (dispatcher)  ✔️
1. Open **http://localhost:3000/access**.
2. Find the card titled **Dispatcher** (nimal@waypoint.lk).
3. Click the yellow button **Sign in and open /dispatcher**.

✅ You'll see a page titled **Delivery operations**.

### A2. Switch to the demo day  ✔️
The page opens on today's date, which has no deliveries. Switch to 9 April:

4. Under the **Delivery operations** title there's a **date box** with a dark **Go** button next to it. Click the date box, pick **9 April 2026** (or type `2026-04-09`), then click **Go**.

✅ The date under the title now reads **Thu, 9 Apr 2026**, and a blue chip says **Queue open**.

### A3. Close the queue  ✔️
5. In the box headed **"Close today's order queue"**, click **Close order queue**.

✅ A green message says *"Order queue closed"*. The box now reads **"Build the delivery plan"**.
✅ The address still ends in `?date=2026-04-09`. (If it doesn't, that's a bug; send me a screenshot.)

### A4. Run auto-plan  ✔️
6. Click **Run auto-plan**.

✅ The box now says something like *"6 trips serve 11 of 12 orders; 1 requires a deferral decision"*.

### A5. Open the plan  ✔️
7. Click **Review draft plan**.

✅ A page titled **Planning** opens. Under **Deferral decisions** there is **one row: DEMO-012**, with a red **No vehicle fits** chip and a **Choose reason** button.

### A6. Open the panel and check it  ✔️
8. Click **Choose reason** on DEMO-012.

✅ A white panel slides in from the right. Check, from top to bottom:
- [x] The title reads **DEMO-012 · Ambient goods**.
- [x] A red box reads **"Why it can't go on any day as it stands"**. It explains that no vehicle is big enough for 45 m³.
- [x] Under **"Why this order and not another"**, it says *this was not a choice between orders*.
- [x] Under **Reason**, **"Order too large for any vehicle"** is already selected, with a green **Suggested** chip.
- [x] **Moves to** reads **"No run will fit it as it stands"**.
- [x] The grey box at the bottom shows the message the shop will get. It says the order *could not be delivered today* and does **not** promise a new date.

### A7. Save and publish  ✔️
9. Click the yellow **Defer and notify store** button at the bottom of the panel.

✅ The panel closes. A green message says **"Deferral reasons saved"**. The DEMO-012 row now shows the reason.

10. On the right, under **Publication check**, click **Publish plan**.

✅ A green message says **"Plan published"**.
✅ Opening DEMO-012 again: the panel is read-only and says **"Sent to the store at OUT010"**. The Fleet status on the desk shows a blue **"Locked"** notice.

**Part A is done.** Run a reset before starting Part B.

---

## Part B: lots of deferred orders, including Fathima's shop — ✔️ passed 3 Oct

Here you break both refrigerated trucks, so every chilled order gets deferred. One of them, **DEMO-006**, belongs to Fathima's shop, so you can see what she sees.

### B1. Sign in and go to the demo day  ✔️
1. Open **http://localhost:3000/access**, then click **Sign in and open /dispatcher**.
2. Use the **date box** under the title: pick **9 April 2026** and click **Go**.

### B2. Put two trucks in the workshop  ✔️
3. Scroll down to the section titled **Fleet status**. It has 4 vehicle cards (VEH101 to VEH104). VEH104 is already red ("In workshop").
4. On the **VEH101** card (Truck · Reefer), type `Compressor fault` in the **Reason** box, then click **Mark in workshop**.

✅ A green message says *"Vehicle status saved"*. The VEH101 card turns red and shows *Compressor fault · set by Nimal Perera*.

5. On the **VEH103** card (Van · Reefer), click **Mark in workshop**. The reason is optional.

✅ The header now says **"1 of 4 available"**.

### B3. Plan the day  ✔️
6. Scroll up and click **Close order queue**.
7. Click **Run auto-plan**.

✅ It now says something like *"2 trips serve 5 of 12 orders; 7 require deferral decisions"*.

8. Click **Review draft plan**.

✅ **Deferral decisions** lists **7 rows**: DEMO-001, 002, 004, 006, 008, 010 and 012.

### B4. Open DEMO-006 (Fathima's order)  ✔️
9. On the **DEMO-006** row, click **Choose reason**.

✅ Check the panel:
- [x] The title reads **DEMO-006 · Chilled goods**, with **OUT074 · Puttalam** underneath.
- [x] The red box reads **"Why it can't go today"**: *"No refrigerated vehicle is free today — VEH101 and VEH103 are in the workshop. It fits as soon as one returns."*
- [x] **"Why this order and not another"** says *no order was served on a refrigerated vehicle that could have taken this one*. Both reefers are off the road, so nothing could have been swapped.
- [x] **"Vehicle in the workshop"** is selected, with a **Suggested** chip. That's the true cause, not "capacity full".
- [x] **Moves to** reads **Fri 10 Apr · 05:30 – 10:00**, with an orange **First on the run** chip.
- [x] The grey box starts with **"Fathima Rizvi (OUT074) will see"** and reads *"Your order DEMO-006 moves to Fri 10 Apr, 05:30–10:00. Reason: vehicle in the workshop. It will be planned first on that run."* **Copy that message** into a note; you'll compare it later.
- [x] *(Extra)* **DEMO-002** is compared only with the predawn orders that rode the one working truck (DEMO-005, DEMO-011, DEMO-007). It's lowest priority (#4 of 4), which is why it was the one deferred.

10. Click **Defer and notify store**.

### B5. Give every other order a reason  ✔️
11. For each remaining row showing **Needs reason**, click **Choose reason**, then **Defer and notify store**. Keep the suggested reason each time.

✅ When all 7 are done, the header says *"Every deferral carries a reason"*, and **Publication check** says **Ready to publish**.

12. Click **Publish plan**.

### B6. Check what Fathima sees  ✔️
13. Sign out: the button is at the top right, or go to **http://localhost:3000/sign-out**.
14. Open **http://localhost:3000/access** and click **Sign in and open /store** on the **Store manager** card.

✅ You'll see **My orders**, with **DEMO-006** marked red **Deferred** and *"Moves to Fri 10 Apr"* underneath.

15. Click **DEMO-006**.

✅ A red box at the top reads **"This order moves to the next run"**. Its text must match the message you copied in step 9 **exactly, word for word**.
✅ There's no "Dispatch must update this order" box contradicting it.

**Part B is done.**

---

## Part C: extra things to try (any time a panel is open) — ✔️ passed 3 Oct

Run a reset and set up Part B up to step 8 first. Then try:

- [x] **Change your mind.** *(✔️ 3 Oct: "Other" starts on "Choose a reason…" and saving is blocked until you pick one. With Weekly fuel quota and a note saved, reopening shows both.)* Open any order and pick **"Other · add a note"**. Choose a reason from the dropdown, type a note, and click **Defer and notify store**. Open it again: your choice and note are still there.
- [x] **Changing a truck after the draft.** *(✔️ 3 Oct)* With a draft already built, mark another truck **in the workshop**. An amber note says the draft needs **Re-run auto-plan**, and the plan's Publication check is **blocked** ("VEH102 is in the workshop").
- [x] **Keyboard.** *(✔️ verified in the first run.)* Press **Tab** repeatedly; it should stay inside the panel. Press **Escape** to close it.
- [x] **Closing.** *(✔️ verified in the first run.)* Clicking the dark area on the left closes the panel. So do the **×** button and the browser's **Back** button.
- [x] **Publishing too early.** *(✔️ blocked: "1 deferral has no reason recorded".)* Leave some orders without a reason, then try **Publish plan**. It should be blocked.
- [x] **After publishing.** *(✔️ 3 Oct: read-only, says "Sent to the store at OUT010", only a Close button.)* Open an order. The panel is read-only (greyed out) and only has a **Close** button.

## Part D: check the other roles still work (after a publish) — ✔️ passed 3 Oct

- [x] **Loader:** at `/access`, click **Sign in and open /loader**, then go to `http://localhost:3000/loader?date=2026-04-09`. Trucks are listed. Opening a trip shows **"Delivery stop 1 / 2"**, counting from 1.
- [x] **Driver:** at `/access`, click **Sign in and open /driver**, then go to `http://localhost:3000/driver?date=2026-04-09`. Claim **VEH102**, then the route shows **"Stop 1 · Trip 1"**, **"Stop 2 · Trip 1"** and **"Stop 1 · Trip 2"**, counting from 1.
- [x] **Store:** as Fathima, the **Place an order** page loads and shows a delivery date of **Mon, Oct 5, 2026**.

---

## Not bugs (expected for now)

- An order Fathima places goes to **5 October**, not the 9 April demo day, so it won't show up in Nimal's plan.
- The dispatcher's note is private. Fathima sees the reason and the date, not the note.
- Running **Re-run auto-plan** clears any reasons you've already chosen.

## Found something wrong?

Note the part and step (for example *"B4, the chip says Protected instead of Skipped twice"*) with a screenshot, and add it to `test-findings-*.md` or an issue.
