-- Placing an order never created the depot's PlanningDay for its date (only the
-- seed did), so orders for any other day could be listed but not closed or
-- planned. Placement now opens the day; this opens it for orders already
-- waiting. Only QUEUED orders: history on past days is left alone.
INSERT INTO "PlanningDay" ("id", "date", "depotCode")
SELECT gen_random_uuid()::text, o."requestedDate", o."depotCode"
FROM "Order" o
WHERE o."status" = 'QUEUED'
GROUP BY o."requestedDate", o."depotCode"
ON CONFLICT ("date", "depotCode") DO NOTHING;
