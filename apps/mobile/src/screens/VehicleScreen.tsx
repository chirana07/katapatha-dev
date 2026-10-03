import { useState } from "react";
import { router } from "expo-router";
import { Screen } from "@/ui/Screen";
import { ScreenHeader } from "./trip/ScreenHeader";
import { Card, CardTitle, Muted } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { PrimaryButton, SecondaryButton } from "@/ui/Button";
import { ErrorNote, SavedNote } from "@/ui/Notes";
import { useRun, useRunActions } from "@/state/useStore";
import { getApi } from "@/api/client";
import { releaseVehicleNote } from "@/outbox/claims";
import { mutationError } from "@/driver/api-errors";

/**
 * Claim or release the vehicle.
 *
 * The run is published against a vehicle, not a person, so a driver must claim
 * one before they have any stops at all -- which is why GET /drivers/me/run
 * answering 403 is a screen state rather than an error.
 *
 * The format is checked here before the call, with the same pattern the web
 * console uses, so a typo on a dock card gets an immediate answer rather than a
 * round trip.
 */
const VEHICLE_ID = /^[A-Z]{2,4}\d{2,5}$/;

export function VehicleScreen() {
  const { snapshot } = useRun();
  const { sql, bootstrap } = useRunActions();

  const [value, setValue] = useState(snapshot.vehicleId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const claim = async () => {
    const vehicleId = value.trim().toUpperCase();
    setError(null);
    setSaved(null);

    if (!VEHICLE_ID.test(vehicleId)) {
      setError(
        "Vehicle id should look like VEH043 (letters then digits). Check the dock card and try again.",
      );
      return;
    }

    setBusy(true);
    try {
      const client = await getApi(sql);
      const result = await client.PUT("/drivers/me/vehicle", { body: { vehicleId } });
      if (!result.response.ok || !result.data) {
        setError(mutationError(result.response.status, "claim this vehicle"));
        return;
      }
      setSaved(`${result.data.vehicleId} claimed.`);
      await bootstrap();
      router.back();
    } catch {
      setError("Katapatha could not be reached. Check the signal and try again.");
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      const client = await getApi(sql);
      const result = await client.DELETE("/drivers/me/vehicle", {});
      if (!result.response.ok) {
        setError(mutationError(result.response.status, "release the vehicle"));
        return;
      }
      setValue("");
      setSaved("Vehicle released.");
      await bootstrap();
    } catch {
      setError("Katapatha could not be reached. Check the signal and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={
        <ScreenHeader
          title={snapshot.vehicleId ? "Change vehicle" : "Claim a vehicle"}
          subtitle={snapshot.vehicleId ? `Now on ${snapshot.vehicleId}` : "No vehicle claimed yet"}
        />
      }
    >
      <Card>
        <CardTitle>Which vehicle are you driving?</CardTitle>
        <Muted>
          The id is on the dock card, next to the loader&apos;s signature.
        </Muted>
        <Field
          label="Vehicle id"
          value={value}
          onChangeText={setValue}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="VEH043"
          editable={!busy}
          style={{ fontVariant: ["tabular-nums"] }}
        />
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {saved ? <SavedNote>{saved}</SavedNote> : null}
        <PrimaryButton
          label="Claim vehicle"
          icon="truck"
          busyLabel="Claiming…"
          busy={busy}
          onPress={() => void claim()}
        />
      </Card>

      {snapshot.vehicleId ? (
        <Card>
          <CardTitle>Finished for the day?</CardTitle>
          <Muted>
            {releaseVehicleNote(snapshot.vehicleId)}
          </Muted>
          <SecondaryButton
            label="Release vehicle"
            tone="critical"
            busy={busy}
            busyLabel="Releasing…"
            onPress={() => void release()}
          />
        </Card>
      ) : (
        <Muted>
          Nothing is claimed on this phone, so there are no stops to show yet.
        </Muted>
      )}
    </Screen>
  );
}
