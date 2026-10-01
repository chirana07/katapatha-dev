import { useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { color } from "@katapatha/tokens/tokens";
import { Screen } from "@/ui/Screen";
import { Card, CardTitle, Muted, SectionHeading } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Numeric } from "@/ui/Numeric";
import { PrimaryButton, SecondaryButton, ThumbBar } from "@/ui/Button";
import { ErrorNote, InfoNote } from "@/ui/Notes";
import { useRunActions, useStop } from "@/state/useStore";
import { deliveryIntent } from "@/outbox/intents";
import { SignaturePad } from "@/pod/SignaturePad";
import { toSignatureDataUrl, type Stroke } from "@/pod/signatureData";
import { capturePhoto } from "@/pod/photo";
import { checkPhoto, checkSignature } from "@/pod/size";

/**
 * Complete the delivery.
 *
 * Units default to what was expected, because a full delivery is the common case
 * and a driver should not have to type six numbers to record a normal stop. The
 * validation mirrors the web console's server action exactly -- a recipient name
 * of at least two characters, whole numbers, and never more than was ordered --
 * so the two clients cannot disagree about what a valid delivery is.
 *
 * The signature is required and the photo optional, which keeps "Complete
 * delivery" the single dominant action in the thumb zone.
 */
export function DeliverScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const stop = useStop(stopId);
  const { store, drain } = useRunActions();

  const orders = stop?.orders ?? [];

  const [units, setUnits] = useState<Record<string, string>>(() =>
    Object.fromEntries(orders.map((order) => [order.orderId, String(order.expectedUnits)])),
  );
  const [recipient, setRecipient] = useState("");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [padSize, setPadSize] = useState({ width: 320, height: 180 });
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!stop) {
    return (
      <Screen>
        <Card>
          <CardTitle>Stop not on this run</CardTitle>
          <Muted>Go back to the run and try again.</Muted>
        </Card>
      </Screen>
    );
  }

  const addPhoto = async () => {
    setPhotoNote(null);
    const result = await capturePhoto();
    switch (result.kind) {
      case "ok": {
        const verdict = checkPhoto(result.dataUrl);
        if (!verdict.ok) {
          setPhotoNote(verdict.message);
          return;
        }
        setPhoto(result.dataUrl);
        return;
      }
      case "denied":
        setPhotoNote(
          "The camera is not allowed for Katapatha on this phone. A photo is optional — you can still complete the delivery.",
        );
        return;
      case "too-large":
        setPhotoNote("That photo is too large to send. Take it again from further back.");
        return;
      case "failed":
        setPhotoNote(result.message);
        return;
      case "cancelled":
        return;
    }
  };

  const submit = async () => {
    if (busy) return;
    setError(null);

    const name = recipient.trim();
    if (name.length < 2) {
      setError(
        "Type the recipient's name before saving. Every delivery is signed off to a real person at the outlet.",
      );
      return;
    }

    const lines: Array<{ orderId: string; expectedUnits: number; deliveredUnits: number }> = [];
    for (const order of orders) {
      const raw = (units[order.orderId] ?? "").trim();
      if (!/^\d+$/.test(raw)) {
        setError("Delivered units must be whole numbers, zero or more.");
        return;
      }
      const delivered = Number(raw);
      if (!Number.isSafeInteger(delivered)) {
        setError("Delivered quantities are too large to save safely. Check the figures.");
        return;
      }
      if (delivered > order.expectedUnits) {
        setError(
          `${delivered} is more than the ${order.expectedUnits} units on ${order.orderRef}. Check the figure before saving.`,
        );
        return;
      }
      lines.push({
        orderId: order.orderId,
        expectedUnits: order.expectedUnits,
        deliveredUnits: delivered,
      });
    }

    const signatureData = toSignatureDataUrl(strokes, padSize);
    if (!signatureData) {
      setError("Ask the recipient to sign before saving.");
      return;
    }
    const signatureVerdict = checkSignature(signatureData);
    if (!signatureVerdict.ok) {
      setError(signatureVerdict.message);
      return;
    }

    setBusy(true);
    await store.submit(
      deliveryIntent({
        stopId: stop.id,
        occurredAt: new Date().toISOString(),
        recipientName: name,
        lines,
        signatureData,
        photoData: photo,
      }),
    );
    void drain();
    setBusy(false);
    router.back();
  };

  const short = orders.some(
    (order) => Number(units[order.orderId] ?? "0") < order.expectedUnits,
  );

  return (
    <View style={{ flex: 1, backgroundColor: color.canvas }}>
      <Screen bottomInset={120}>
        <Card>
          <CardTitle>{stop.outletName ?? stop.outletId}</CardTitle>
          <Muted>Record what actually came off the vehicle.</Muted>
        </Card>

        <SectionHeading>Units delivered</SectionHeading>
        <Card>
          {orders.map((order) => (
            <View key={order.orderId} style={{ gap: 4, paddingVertical: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Numeric style={{ fontSize: 15, fontWeight: "600" }}>
                  {order.orderRef}
                </Numeric>
                <Numeric style={{ fontSize: 14, color: color.muted }}>
                  of {order.expectedUnits}
                </Numeric>
              </View>
              <Field
                label={`Delivered for ${order.orderRef}`}
                value={units[order.orderId] ?? ""}
                onChangeText={(next) =>
                  setUnits((previous) => ({ ...previous, [order.orderId]: next }))
                }
                keyboardType="number-pad"
                editable={!busy}
                style={{ fontVariant: ["tabular-nums"] }}
              />
            </View>
          ))}
          {orders.length === 0 ? (
            <Muted>No order lines on this stop, so there is nothing to count.</Muted>
          ) : null}
        </Card>

        {short ? (
          <InfoNote>
            A short line is recorded as a part delivery, with the figure you entered.
            Report a problem instead if nothing could be delivered at all.
          </InfoNote>
        ) : null}

        <SectionHeading>Proof of delivery</SectionHeading>
        <Card>
          <Field
            label="Recipient's name"
            value={recipient}
            onChangeText={setRecipient}
            placeholder="Who signed for it"
            autoCapitalize="words"
            editable={!busy}
          />
          <SignaturePad
            strokes={strokes}
            onChange={setStrokes}
            onSize={setPadSize}
            disabled={busy}
          />
          <SecondaryButton
            label={photo ? "Retake photo" : "Add a photo (optional)"}
            onPress={() => void addPhoto()}
            disabled={busy}
          />
          {photo ? (
            <Text style={{ color: "#115C3A", fontSize: 14 }}>
              Photo attached.
            </Text>
          ) : null}
          {photoNote ? <InfoNote>{photoNote}</InfoNote> : null}
        </Card>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <Muted>
          The time saved with this delivery is this phone&apos;s clock, and is shown as
          recorded on device.
        </Muted>
      </Screen>

      <ThumbBar>
        <PrimaryButton
          label="Complete delivery"
          busyLabel="Saving…"
          busy={busy}
          onPress={() => void submit()}
        />
      </ThumbBar>
    </View>
  );
}
