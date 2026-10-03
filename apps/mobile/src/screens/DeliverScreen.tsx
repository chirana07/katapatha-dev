import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, View } from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/ui/Screen";
import { Card, CardTitle, Muted } from "@/ui/Card";
import { BottomBar, PrimaryButton, SecondaryButton } from "@/ui/Button";
import { ErrorNote } from "@/ui/Notes";
import { StepHeader } from "@/ui/Header";
import { useRunActions, useStop } from "@/state/useStore";
import { useConnectivity } from "@/state/connectivity";
import { deliveryIntent, newPageId } from "@/outbox/intents";
import { queuedBlobBytes } from "@/outbox/repo";
import { capturePhoto } from "@/pod/photo";
import { toSignatureDataUrl, strokesToSvg, type Stroke } from "@/pod/signatureData";
import { checkSignature } from "@/pod/size";
import { isTerminal } from "@/driver/stop-state";
import { CheckItemsStep } from "./delivery/CheckItemsStep";
import { ReceiptStep } from "./delivery/ReceiptStep";
import { captureOutcome } from "./delivery/capture";
import {
  EMPTY_PAGES,
  NO_TICKS,
  addPage,
  removePage,
  replacePage,
  selectPage,
  selectedPage,
  toPodPages,
  toggleTick,
  type PageList,
  type TickKey,
} from "./delivery/pages";
import { defaultCounts, stopSubline, summariseUnits, type Counts } from "./delivery/units";
import { draftProblem, headroomProblem, requirementNote } from "./delivery/validation";

/**
 * Complete the delivery: one route, two steps.
 *
 *   Step 1  Check items  - one stepper per order, counts start at what was on the vehicle.
 *   Step 2  Receipt      - photo pages (or an on-phone signature), who received, then Complete.
 *
 * Step 3 ("Confirm") is the Recorded route, which Complete replaces this screen
 * with. Completing never waits on the network: the delivery goes into the outbox
 * (the intent carries every page), a drain is started and not awaited, and the
 * screen moves on. The ids are minted once per page and once per intent, so a
 * repeated tap is a no-op on the outbox as well as on this screen's busy flag.
 *
 * What is pure (the page list, units, validation, wording) lives in ./delivery/*.ts
 * and is tested without a phone; this file holds the state and the navigation.
 */
export function DeliverScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const stop = useStop(stopId);
  const { store, drain, sql } = useRunActions();
  const { label } = useConnectivity();
  const connected = label === "Connected";

  const orders = useMemo(() => stop?.orders ?? [], [stop]);

  const [step, setStep] = useState<1 | 2>(1);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [pages, setPages] = useState<PageList>(EMPTY_PAGES);
  const [recipient, setRecipient] = useState("");
  const [signing, setSigning] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [padSize, setPadSize] = useState({ width: 320, height: 180 });
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const capturing = useRef(false);

  // Counts start at what was expected, once the stop is known. Held as state (not
  // derived) so that a snapshot refresh mid-count never resets the driver's entries.
  const effectiveCounts = useMemo(() => counts ?? defaultCounts(orders), [counts, orders]);
  const summary = useMemo(() => summariseUnits(orders, effectiveCounts), [orders, effectiveCounts]);

  const goBackFromScreen = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(driver)");
  }, []);

  // Hardware Back: step 2 returns to step 1, step 1 leaves the screen. While a
  // completion is being saved, Back does nothing rather than abandon it halfway.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (submitting.current) return true;
      if (step === 2) {
        setStep(1);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [step]);

  if (!stop) {
    return (
      <Screen>
        <Card>
          <CardTitle>Stop not on this run</CardTitle>
          <Muted>Go back to the trip and try again.</Muted>
          <SecondaryButton label="Back to trip" onPress={() => router.replace("/(driver)")} />
        </Card>
      </Screen>
    );
  }

  // A closed stop has nothing left to complete. While a completion is in flight the
  // projection flips to DONE before the navigation lands; keep the form up until it does.
  if (isTerminal(stop.projection.status) && !busy) {
    const done = stop.projection.status === "DONE";
    return (
      <Screen>
        <Card>
          <CardTitle>{done ? "Delivery already recorded" : "This stop is closed"}</CardTitle>
          <Muted>
            {done
              ? "There is nothing left to complete for this stop."
              : "A problem or skip is already recorded for this stop."}
          </Muted>
          {done ? (
            <PrimaryButton
              label="View the record"
              onPress={() => router.replace(`/(driver)/stops/${stop.id}/recorded`)}
            />
          ) : null}
          <SecondaryButton label="Back to trip" onPress={() => router.replace("/(driver)")} />
        </Card>
      </Screen>
    );
  }

  const takePhoto = async (retakeId: string | null) => {
    if (busy || capturing.current) return;
    capturing.current = true;
    setNote(null);
    setError(null);
    let outcome: ReturnType<typeof captureOutcome>;
    try {
      outcome = captureOutcome(await capturePhoto());
    } finally {
      capturing.current = false;
    }
    if (outcome.kind === "none") return;
    if (outcome.kind === "note") {
      setNote(outcome.message);
      return;
    }
    // A retake swaps the old photo for the new, so the old one does not count against the queue.
    const base = retakeId ? removePage(pages, retakeId) : pages;
    const room = headroomProblem(await queuedBlobBytes(sql), base, outcome.dataUrl.length);
    if (room) {
      setNote(room);
      return;
    }
    setPages((list) =>
      retakeId
        ? replacePage(list, retakeId, { data: outcome.dataUrl, capturedAt: outcome.capturedAt })
        : addPage(list, {
            id: newPageId(),
            kind: "RECEIPT",
            data: outcome.dataUrl,
            capturedAt: outcome.capturedAt,
            ticks: { ...NO_TICKS },
          }),
    );
  };

  const addSignature = () => {
    setNote(null);
    const data = toSignatureDataUrl(strokes, padSize);
    if (!data) {
      setNote("Ask the recipient to sign before adding the signature.");
      return;
    }
    const verdict = checkSignature(data);
    if (!verdict.ok) {
      setNote(verdict.message);
      return;
    }
    setPages((list) =>
      addPage(list, {
        id: newPageId(),
        kind: "SIGNATURE",
        data,
        capturedAt: new Date().toISOString(),
        ticks: { ...NO_TICKS },
        previewXml: strokesToSvg(strokes, padSize),
      }),
    );
    setStrokes([]);
    setSigning(false);
  };

  const submit = async () => {
    if (submitting.current) return;
    setError(null);

    const problem = draftProblem({ recipient, orders, counts: effectiveCounts, pages });
    if (problem) {
      setError(problem);
      return;
    }

    submitting.current = true;
    setBusy(true);
    try {
      const room = headroomProblem(await queuedBlobBytes(sql), pages);
      if (room) {
        setError(room);
        submitting.current = false;
        setBusy(false);
        return;
      }

      const intent = deliveryIntent({
        stopId: stop.id,
        occurredAt: new Date().toISOString(),
        recipientName: recipient.trim(),
        lines: summary.rows.map((row) => ({
          orderId: row.orderId,
          expectedUnits: row.expected,
          deliveredUnits: row.counted,
        })),
        pages: toPodPages(pages),
      });
      await store.submit(intent);
    } catch (thrown) {
      // deliveryIntent throws sentences written for the driver; anything else is
      // a storage failure and must not be dressed up as a network one.
      setError(
        thrown instanceof Error && thrown.message
          ? thrown.message
          : "This phone could not save the delivery. Try again.",
      );
      submitting.current = false;
      setBusy(false);
      return;
    }

    // Safe in the outbox. Send in the background of this screen, never wait for it,
    // and replace (not back) so the driver cannot return to a stale form.
    void drain();
    router.replace(`/(driver)/stops/${stop.id}/recorded`);
  };

  const missing = requirementNote({ recipient, pages });
  const sub = stopSubline({
    accessNote: stop.accessNote,
    orderRefs: orders.map((order) => order.orderRef),
    expectedUnits: summary.expected,
  });

  return (
    <Screen
      header={
        <StepHeader
          stopNumber={stop.seq}
          outletId={stop.outletId}
          subline={sub}
          step={step}
          tracker
          onBack={() => (step === 2 ? setStep(1) : goBackFromScreen())}
          backLabel={step === 2 ? "Back to check items" : "Back"}
        />
      }
      footer={
        step === 1 ? (
          <BottomBar
            secondary={<SecondaryButton label="Back" onPress={goBackFromScreen} disabled={busy} />}
            primary={<PrimaryButton label="Next: receipt photo" onPress={() => setStep(2)} />}
          />
        ) : (
          <BottomBar
            note={
              error || missing ? (
                <View style={{ gap: space.xs }}>
                  {error ? <ErrorNote>{error}</ErrorNote> : null}
                  {missing ? <Muted>{missing}</Muted> : null}
                </View>
              ) : undefined
            }
            secondary={<SecondaryButton label="Back" onPress={() => setStep(1)} disabled={busy} />}
            primary={
              <PrimaryButton
                label="Complete delivery"
                icon="check"
                busyLabel="Saving…"
                busy={busy}
                disabled={!!missing}
                accessibilityHint={missing ?? undefined}
                onPress={() => void submit()}
              />
            }
          />
        )
      }
    >
      {step === 1 ? (
        <CheckItemsStep
          outletId={stop.outletId}
          orders={orders}
          counts={effectiveCounts}
          onCount={(orderId, units) =>
            setCounts((previous) => ({ ...(previous ?? defaultCounts(orders)), [orderId]: units }))
          }
          connected={connected}
          disabled={busy}
        />
      ) : (
        <ReceiptStep
          pages={pages}
          onTake={() => void takePhoto(null)}
          onRetake={() => void takePhoto(selectedPage(pages)?.id ?? null)}
          onRemove={(id) => setPages((list) => removePage(list, id))}
          onSelect={(id) => setPages((list) => selectPage(list, id))}
          onTick={(id: string, key: TickKey) => setPages((list) => toggleTick(list, id, key))}
          signing={signing}
          onStartSigning={() => {
            setNote(null);
            setSigning(true);
          }}
          onCancelSigning={() => {
            setSigning(false);
            setStrokes([]);
          }}
          strokes={strokes}
          onStrokes={setStrokes}
          onPadSize={setPadSize}
          onAddSignature={addSignature}
          recipient={recipient}
          onRecipient={(name) => {
            setRecipient(name);
            setError(null);
          }}
          summary={summary}
          onEdit={() => setStep(1)}
          connected={connected}
          note={note}
          disabled={busy}
        />
      )}
    </Screen>
  );
}
