import { Fragment } from "react";
import { View } from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { Card, Divider, KeyValueRow, Muted } from "@/ui/Card";
import { unitsLabel } from "@/driver/stop-detail";
import type { CachedItem } from "@/driver/order-items";
import { OrderItemsList } from "../OrderItemsList";

/**
 * The orders on a stop, one row per order, and the expected total. The count is
 * units per order; the products under a row are what the order contains, shown
 * for context when the order was placed from products.
 */
export function OrdersCard({
  orders,
}: {
  orders: ReadonlyArray<{
    orderId: string;
    orderRef: string;
    expectedUnits: number;
    orderedUnits?: number | null;
    items?: readonly CachedItem[];
  }>;
}) {
  if (orders.length === 0) {
    return (
      <Card>
        <Muted>No orders are recorded against this stop.</Muted>
      </Card>
    );
  }
  const total = orders.reduce((sum, order) => sum + order.expectedUnits, 0);
  return (
    <Card flush>
      {orders.map((order) => (
        <Fragment key={order.orderId}>
          <KeyValueRow label={order.orderRef} value={unitsLabel(order.expectedUnits)} />
          {order.items && order.items.length > 0 ? (
            <View style={{ paddingHorizontal: space.sm, paddingBottom: space.xs }}>
              <OrderItemsList orderRef={order.orderRef} order={order} />
            </View>
          ) : null}
          <Divider />
        </Fragment>
      ))}
      <KeyValueRow label="Expected total" value={unitsLabel(total)} />
    </Card>
  );
}
