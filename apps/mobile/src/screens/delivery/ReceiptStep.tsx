import { Text, View } from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { Card, Heading } from "@/ui/Card";
import { ChipToggle } from "@/ui/ChipToggle";
import { Field } from "@/ui/Field";
import { Icon } from "@/ui/Icon";
import { LinkButton, SecondaryButton } from "@/ui/Button";
import { InfoNote } from "@/ui/Notes";
import { useTheme } from "@/ui/theme";
import { SignaturePad } from "@/pod/SignaturePad";
import type { Stroke } from "@/pod/signatureData";
import { receiptStepHint } from "@/outbox/claims";
import { SummaryCard } from "./CheckItemsStep";
import { PagePreview, PageStrip, TakePhotoCard } from "./PageViews";
import {
  TICKS,
  canAddPage,
  pageCounter,
  selectedPage,
  type PageList,
  type TickKey,
} from "./pages";
import { receiptUnitsCard, type UnitsSummary } from "./units";

export const TICK_EXPLAINER =
  "Tick what you can see. This records what you confirmed; an unticked item is noted on the page and never stops you completing.";

/**
 * Step 2, "Receipt" (R-04 / R-05 / R-08): the receipt photo, page by page, who
 * received the goods, and the unit summary. The chips are the driver's own
 * confirmation; nothing here judges the photograph.
 */
export function ReceiptStep(props: {
  pages: PageList;
  onTake: () => void;
  onRetake: () => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onTick: (id: string, key: TickKey) => void;

  signing: boolean;
  onStartSigning: () => void;
  onCancelSigning: () => void;
  strokes: Stroke[];
  onStrokes: (strokes: Stroke[]) => void;
  onPadSize: (size: { width: number; height: number }) => void;
  onAddSignature: () => void;

  recipient: string;
  onRecipient: (name: string) => void;

  summary: UnitsSummary;
  onEdit: () => void;
  connected: boolean;

  note: string | null;
  disabled?: boolean;
}) {
  const { c, tones } = useTheme();
  const { pages, disabled } = props;
  const selected = selectedPage(pages);
  const counter = pageCounter(pages);
  const units = receiptUnitsCard(props.summary);

  return (
    <>
      <View style={{ gap: space.xs + 4 }}>
        <Heading
          trailing={counter ? <Text style={{ fontSize: 15, color: c.muted }}>{counter}</Text> : undefined}
        >
          {selected?.kind === "SIGNATURE" ? "Signature" : "Receipt photo"}
        </Heading>

        {selected ? (
          <>
            <PagePreview
              page={selected}
              onRetake={props.onRetake}
              onRemove={() => props.onRemove(selected.id)}
              disabled={disabled}
            />
            {selected.kind === "RECEIPT" ? (
              <View style={{ gap: space.xs }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                  {TICKS.map((tick) => (
                    <ChipToggle
                      key={tick.key}
                      label={tick.label}
                      selected={selected.ticks[tick.key]}
                      onPress={() => props.onTick(selected.id, tick.key)}
                      disabled={disabled}
                    />
                  ))}
                </View>
                <Text style={{ fontSize: 13, color: c.muted }}>{TICK_EXPLAINER}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <TakePhotoCard onPress={props.onTake} disabled={disabled} />
        )}

        {props.note ? <InfoNote>{props.note}</InfoNote> : null}

        {selected ? (
          <PageStrip
            pages={pages.pages}
            selectedId={selected.id}
            canAdd={canAddPage(pages)}
            onSelect={props.onSelect}
            onAdd={props.onTake}
            disabled={disabled}
          />
        ) : null}

        {props.signing ? (
          <Card>
            <Text style={{ fontSize: 16, fontWeight: "700", color: c.ink }}>Sign on the phone</Text>
            <SignaturePad
              strokes={props.strokes}
              onChange={props.onStrokes}
              onSize={props.onPadSize}
              disabled={disabled}
            />
            <View style={{ flexDirection: "row", gap: space.xs }}>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  label="Add signature"
                  onPress={props.onAddSignature}
                  disabled={disabled || props.strokes.length === 0}
                />
              </View>
              <LinkButton label="Cancel" onPress={props.onCancelSigning} disabled={disabled} />
            </View>
          </Card>
        ) : canAddPage(pages) ? (
          <LinkButton
            label="No paper receipt? Sign on the phone"
            onPress={props.onStartSigning}
            disabled={disabled}
          />
        ) : null}
      </View>

      <View style={{ gap: space.xs, borderTopWidth: 1, borderTopColor: c.line, paddingTop: space.sm }}>
        <Field
          label="Received by"
          value={props.recipient}
          onChangeText={props.onRecipient}
          placeholder="Name of the person who received the goods"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          editable={!disabled}
        />
      </View>

      <SummaryCard
        tone={units.tone}
        title={units.title}
        body={units.body}
        action={<LinkButton label="Edit" accessibilityLabel="Edit unit counts" onPress={props.onEdit} disabled={disabled} />}
      />

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Icon name="bulb" size={22} color={tones.warn.fg} />
        <Text style={{ flex: 1, fontSize: 14, color: c.muted }}>{receiptStepHint(props.connected)}</Text>
      </View>
    </>
  );
}
