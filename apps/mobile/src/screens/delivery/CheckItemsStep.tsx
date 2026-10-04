import { Text, View } from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { Card, Divider, Muted } from "@/ui/Card";
import { Icon } from "@/ui/Icon";
import { Numeric } from "@/ui/Numeric";
import { Pill } from "@/ui/Pill";
import { Stepper } from "@/ui/Stepper";
import { useTheme } from "@/ui/theme";
import { countStepStatusCopy } from "@/outbox/claims";
import { OrderItemsList } from "../OrderItemsList";
import {
  countSubtitle,
  countSummaryCard,
  orderRefLabel,
  rowOfLabel,
  summariseUnits,
  type CountOrder,
  type Counts,
  type OrderRow,
} from "./units";

/**
 * Step 1, "Check items" (R-07): one row per ORDER with a stepper, because an
 * order carries units, not SKUs. The counts start at what was on the vehicle.
 * A short row is flagged by its icon and its words, not by colour alone.
 */
export function CheckItemsStep({
  outletId,
  orders,
  counts,
  onCount,
  connected,
  disabled,
}: {
  outletId: string;
  orders: readonly CountOrder[];
  counts: Counts;
  onCount: (orderId: string, units: number) => void;
  connected: boolean;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  const summary = summariseUnits(orders, counts);
  const statusChip = countStepStatusCopy(connected);
  const refLabel = orderRefLabel(orders.map((order) => order.orderRef));
  const card = countSummaryCard(summary, outletId);

  return (
    <>
      <View style={{ gap: space.xs }}>
        {/* Wraps rather than shrinking: with the offline chip beside it the heading
            was cut to "Count with the s…" at 390 wide. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: space.xs, rowGap: 4 }}>
          <Text
            accessibilityRole="header"
            style={{ fontSize: 20, fontWeight: "700", color: c.ink }}
          >
            Count with the store
          </Text>
          {statusChip ? <Pill tone="warn" label={statusChip} /> : null}
        </View>
        <Muted>
          {countSubtitle(
            orders.length,
            summary.expected,
            orders.length === 1 && refLabel ? refLabel : "this stop",
          )}
        </Muted>
      </View>

      <Card flush>
        {summary.rows.map((row, index) => {
          const order = orders.find((candidate) => candidate.orderId === row.orderId);
          return (
            <View key={row.orderId}>
              {index > 0 ? <Divider /> : null}
              <ItemRow
                row={row}
                value={counts[row.orderId] ?? row.expected}
                onChange={(next) => onCount(row.orderId, next)}
                disabled={disabled}
              />
              {order?.items && order.items.length > 0 ? (
                // Under the row, level with its text: a long order must not push the
                // stepper out of reach, and the stepper still counts the order's units.
                <View style={{ paddingLeft: space.sm + 28 + space.xs, paddingRight: space.sm, paddingBottom: space.xs }}>
                  <OrderItemsList orderRef={row.orderRef} order={order} />
                </View>
              ) : null}
            </View>
          );
        })}
        {orders.length === 0 ? (
          <View style={{ padding: space.sm }}>
            <Muted>No order lines on this stop, so there is nothing to count.</Muted>
          </View>
        ) : null}
      </Card>

      <SummaryCard tone={card.tone} title={card.title} body={card.body} />
    </>
  );
}

function ItemRow({
  row,
  value,
  onChange,
  disabled,
}: {
  row: OrderRow;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const { c, tones } = useTheme();
  const short = row.short > 0;
  const tone = short ? tones.warn : tones.good;
  const sub = rowOfLabel(row);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingVertical: space.xs + 2,
        paddingHorizontal: space.sm,
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: tone.surface,
          borderWidth: 1,
          borderColor: tone.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={short ? "warning" : "check"} size={15} color={tone.fg} strokeWidth={2.6} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Numeric style={{ fontSize: 17, fontWeight: "700" }}>{row.orderRef}</Numeric>
        <Numeric style={{ fontSize: 14, color: c.muted }}>{sub}</Numeric>
        {short ? (
          <Text style={{ fontSize: 14, fontWeight: "700", color: tones.warn.ink }}>
            {row.short} short
          </Text>
        ) : null}
      </View>
      <Stepper
        value={value}
        onChange={onChange}
        min={0}
        max={row.expected}
        label={`units received for ${row.orderRef}`}
        disabled={disabled}
      />
    </View>
  );
}

/** The green / amber card under the rows (and its twin on the Receipt step). */
export function SummaryCard({
  tone,
  title,
  body,
  action,
}: {
  tone: "good" | "warn";
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  const { c, tones } = useTheme();
  const style = tones[tone];
  return (
    <Card tone={tone} style={{ flexDirection: "row", alignItems: "center", gap: space.xs + 4 }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: style.fg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={tone === "good" ? "check" : "warning"} size={24} color={c.surface} strokeWidth={2.6} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Numeric style={{ fontSize: 17, fontWeight: "700" }}>{title}</Numeric>
        <Text style={{ fontSize: 14, color: c.muted }}>{body}</Text>
      </View>
      {action}
    </Card>
  );
}
