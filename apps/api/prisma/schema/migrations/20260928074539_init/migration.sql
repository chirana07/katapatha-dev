-- CreateEnum
CREATE TYPE "Brand" AS ENUM ('Fresh', 'Style', 'Tech');

-- CreateEnum
CREATE TYPE "TempRequirement" AS ENUM ('chilled', 'ambient');

-- CreateEnum
CREATE TYPE "VehicleTemp" AS ENUM ('reefer', 'ambient');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('truck', 'van');

-- CreateEnum
CREATE TYPE "DockType" AS ENUM ('rear_dock', 'street', 'mall_bay');

-- CreateEnum
CREATE TYPE "ParkingConstraint" AS ENUM ('normal', 'van_only', 'mall_dock');

-- CreateEnum
CREATE TYPE "RoadClass" AS ENUM ('urban', 'suburban', 'highway', 'hill');

-- CreateEnum
CREATE TYPE "Wave" AS ENUM ('PREDAWN', 'DAYTIME');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DISPATCHER', 'LOADER', 'DRIVER', 'STORE_MANAGER');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'IN_WORKSHOP');

-- CreateEnum
CREATE TYPE "PlanningDayStatus" AS ENUM ('OPEN', 'CLOSED', 'PLANNING', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PLACED', 'QUEUED', 'PLANNED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'PART_DELIVERED', 'FAILED', 'DEFERRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'LOADING', 'READY', 'DEPARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StopStatus" AS ENUM ('PENDING', 'ARRIVED', 'UNLOADING', 'DONE', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('SERVED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "LoadCondition" AS ENUM ('OK', 'SHORT', 'DAMAGED', 'MISSING');

-- CreateEnum
CREATE TYPE "ShortfallStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ShortfallResolution" AS ENUM ('SEND_SHORT', 'HOLD_ORDER', 'MOVE_TO_TRIP_2', 'CANCEL_LINE');

-- CreateEnum
CREATE TYPE "StopEventType" AS ENUM ('ARRIVED', 'UNLOAD_START', 'DELIVERED', 'PART_DELIVERED', 'FAILED', 'SKIPPED', 'POD_CAPTURED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('ONLINE', 'OUTBOX');

-- CreateEnum
CREATE TYPE "ConflictState" AS ENUM ('NONE', 'STALE_ASSIGNMENT', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ProblemKind" AS ENUM ('OUTLET_CLOSED', 'ROAD_BLOCKED', 'VEHICLE_BREAKDOWN', 'ACCESS_DENIED', 'GOODS_DAMAGED', 'DELIVERY_REFUSED', 'OTHER');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReassignmentStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FuelEntryKind" AS ENUM ('PLANNED', 'ACTUAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CapacityActionKind" AS ENUM ('RECALL_FROM_WORKSHOP', 'HIRE_RELIEF_VEHICLE', 'SHIFT_BRAND_DAY', 'RAISE_FUEL_QUOTA', 'PRE_BUILD_ORDERS', 'SPLIT_LARGE_ORDER');

-- CreateEnum
CREATE TYPE "CapacityActionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'APPLIED', 'REJECTED');

-- CreateTable
CREATE TABLE "Depot" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Depot_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "District" (
    "name" TEXT NOT NULL,
    "depotCode" TEXT NOT NULL,
    "roadClass" "RoadClass" NOT NULL,
    "freeFlowKmh" DOUBLE PRECISION NOT NULL,
    "depotToDistrictKm" DOUBLE PRECISION NOT NULL,
    "depotToDistrictFreeflowMin" INTEGER NOT NULL,
    "interStopKm" DOUBLE PRECISION NOT NULL,
    "interStopFreeflowMin" INTEGER NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "districtName" TEXT NOT NULL,
    "depotCode" TEXT NOT NULL,
    "dockType" "DockType" NOT NULL,
    "parkingConstraint" "ParkingConstraint" NOT NULL,
    "mallWindowOpen" TEXT,
    "mallWindowClose" TEXT,
    "windowOpen" TEXT NOT NULL,
    "windowClose" TEXT NOT NULL,
    "displayName" TEXT,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "temp" "VehicleTemp" NOT NULL,
    "weightCapKg" INTEGER NOT NULL,
    "volumeCapM3" DOUBLE PRECISION NOT NULL,
    "fuelType" TEXT NOT NULL,
    "kmPerL" DOUBLE PRECISION NOT NULL,
    "weeklyFuelQuotaL" INTEGER NOT NULL,
    "depotCode" TEXT NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAllowance" (
    "brand" "Brand" NOT NULL,
    "dockType" "DockType" NOT NULL,
    "minutes" INTEGER NOT NULL,

    CONSTRAINT "ServiceAllowance_pkey" PRIMARY KEY ("brand","dockType")
);

-- CreateTable
CREATE TABLE "CalendarDay" (
    "date" DATE NOT NULL,
    "dow" INTEGER NOT NULL,
    "dowName" TEXT NOT NULL,
    "isWeekend" BOOLEAN NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "isPayday" BOOLEAN NOT NULL,
    "festival" TEXT,
    "festivalRamp" DOUBLE PRECISION NOT NULL,
    "isHoliday" BOOLEAN NOT NULL,
    "monsoon" BOOLEAN NOT NULL,
    "isOperating" BOOLEAN NOT NULL,

    CONSTRAINT "CalendarDay_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "TrafficSpeed" (
    "districtName" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "monsoon" BOOLEAN NOT NULL,
    "speedIndex" INTEGER NOT NULL,

    CONSTRAINT "TrafficSpeed_pkey" PRIMARY KEY ("districtName","hour","monsoon")
);

-- CreateTable
CREATE TABLE "RoadCondition" (
    "districtName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "disruptionIndex" INTEGER NOT NULL,

    CONSTRAINT "RoadCondition_pkey" PRIMARY KEY ("districtName","date")
);

-- CreateTable
CREATE TABLE "VehicleDayStatus" (
    "date" DATE NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "status" "VehicleStatus" NOT NULL,
    "note" TEXT,
    "setByUserId" TEXT,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleDayStatus_pkey" PRIMARY KEY ("date","vehicleId")
);

-- CreateTable
CREATE TABLE "WeeklyDemandHistory" (
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "depotCode" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "totalVolumeM3" DOUBLE PRECISION NOT NULL,
    "chilledVolumeM3" DOUBLE PRECISION NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "deferredCount" INTEGER NOT NULL,

    CONSTRAINT "WeeklyDemandHistory_pkey" PRIMARY KEY ("isoYear","isoWeek","depotCode","brand")
);

-- CreateTable
CREATE TABLE "DailyDemandHistory" (
    "date" DATE NOT NULL,
    "depotCode" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "temp" "TempRequirement" NOT NULL,
    "orders" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "volumeM3" DOUBLE PRECISION NOT NULL,
    "deferred" INTEGER NOT NULL,
    "notRun" INTEGER NOT NULL,

    CONSTRAINT "DailyDemandHistory_pkey" PRIMARY KEY ("date","depotCode","brand","temp")
);

-- CreateTable
CREATE TABLE "DemandForecast" (
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "depotCode" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "predTotalVolumeM3" DOUBLE PRECISION NOT NULL,
    "predChilledVolumeM3" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandForecast_pkey" PRIMARY KEY ("isoYear","isoWeek","depotCode","brand")
);

-- CreateTable
CREATE TABLE "ServiceObservation" (
    "id" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "dockType" "DockType" NOT NULL,
    "districtName" TEXT NOT NULL,
    "monsoon" BOOLEAN NOT NULL,
    "n" INTEGER NOT NULL,
    "meanActualMin" DOUBLE PRECISION NOT NULL,
    "p90ActualMin" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ServiceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalLeg" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "routeId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "districtName" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "seq" INTEGER NOT NULL,
    "fromPoint" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "plannedDepart" TEXT NOT NULL,
    "plannedArrival" TEXT NOT NULL,
    "actualDepart" TEXT,
    "arrivalTime" TEXT,
    "leaveOutletTime" TEXT,

    CONSTRAINT "HistoricalLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "depotCode" TEXT,
    "outletId" TEXT,
    "defaultVehicleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reasonCode" TEXT,
    "note" TEXT,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "outletId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningDay" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "depotCode" TEXT NOT NULL,
    "status" "PlanningDayStatus" NOT NULL DEFAULT 'OPEN',
    "cutoffAt" TEXT NOT NULL DEFAULT '16:00',
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "queueSnapshot" JSONB,

    CONSTRAINT "PlanningDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "brand" "Brand" NOT NULL,
    "districtName" TEXT NOT NULL,
    "depotCode" TEXT NOT NULL,
    "tempRequirement" "TempRequirement" NOT NULL,
    "units" INTEGER NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "volumeM3" DOUBLE PRECISION NOT NULL,
    "windowOpen" TEXT NOT NULL,
    "windowClose" TEXT NOT NULL,
    "requestedDate" DATE NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placedByUserId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "deferredYesterday" BOOLEAN NOT NULL DEFAULT false,
    "daysSinceLastServed" INTEGER NOT NULL DEFAULT 1,
    "rolledFromOrderId" TEXT,
    "clientRequestId" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "planningDayId" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "allocatorVersion" TEXT,
    "objectiveSummary" JSONB,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "tripNo" INTEGER NOT NULL,
    "brand" "Brand" NOT NULL,
    "districtName" TEXT NOT NULL,
    "wave" "Wave" NOT NULL,
    "plannedDepartAt" TEXT NOT NULL,
    "plannedMinutes" DOUBLE PRECISION NOT NULL,
    "plannedDistanceKm" DOUBLE PRECISION NOT NULL,
    "plannedFuelL" DOUBLE PRECISION NOT NULL,
    "sumWeightKg" DOUBLE PRECISION NOT NULL,
    "sumVolumeM3" DOUBLE PRECISION NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "loadConfirmedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripStop" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "outletId" TEXT NOT NULL,
    "status" "StopStatus" NOT NULL DEFAULT 'PENDING',
    "plannedArrivalAt" TEXT NOT NULL,
    "etaAt" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripStopOrder" (
    "tripStopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "TripStopOrder_pkey" PRIMARY KEY ("tripStopId","orderId")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tripStopId" TEXT,
    "decision" "Decision" NOT NULL,
    "reasonCode" TEXT,
    "explanation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StopReassignment" (
    "id" TEXT NOT NULL,
    "tripStopId" TEXT NOT NULL,
    "fromTripId" TEXT NOT NULL,
    "toTripId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byUserId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "status" "ReassignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledReason" TEXT,

    CONSTRAINT "StopReassignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deferral" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "rolledToDate" DATE,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storeNotifiedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "Deferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoadCheck" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "expectedUnits" INTEGER NOT NULL,
    "loadedUnits" INTEGER NOT NULL,
    "condition" "LoadCondition" NOT NULL DEFAULT 'OK',
    "checkedByName" TEXT NOT NULL,
    "checkedByUserId" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientRequestId" TEXT,

    CONSTRAINT "LoadCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shortfall" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "loadCheckId" TEXT,
    "kind" "LoadCondition" NOT NULL,
    "missingUnits" INTEGER NOT NULL,
    "raisedByUserId" TEXT,
    "raisedByName" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ShortfallStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "ShortfallResolution",
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "reasonCode" TEXT,
    "note" TEXT,
    "blocksDeparture" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Shortfall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StopEvent" (
    "id" TEXT NOT NULL,
    "tripStopId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "StopEventType" NOT NULL,
    "payload" JSONB,
    "deliveredUnits" INTEGER,
    "recipientName" TEXT,
    "signatureData" TEXT,
    "photoData" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,
    "actorUserId" TEXT,
    "source" "EventSource" NOT NULL DEFAULT 'ONLINE',
    "conflictState" "ConflictState" NOT NULL DEFAULT 'NONE',
    "serverSeq" BIGSERIAL NOT NULL,

    CONSTRAINT "StopEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "kind" "ProblemKind" NOT NULL,
    "tripId" TEXT,
    "tripStopId" TEXT,
    "orderId" TEXT,
    "note" TEXT,
    "photoData" TEXT,
    "raisedByUserId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ProblemStatus" NOT NULL DEFAULT 'NEW',
    "acknowledgedByUserId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "reasonCode" TEXT,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptConfirmation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unitsReceived" INTEGER NOT NULL,
    "matches" BOOLEAN NOT NULL,
    "issueKind" TEXT,
    "note" TEXT,

    CONSTRAINT "ReceiptConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelLedger" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "quotaL" DOUBLE PRECISION NOT NULL,
    "committedL" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consumedL" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "FuelLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelLedgerEntry" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "tripId" TEXT,
    "km" DOUBLE PRECISION NOT NULL,
    "litres" DOUBLE PRECISION NOT NULL,
    "kind" "FuelEntryKind" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapacityAction" (
    "id" TEXT NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "depotCode" TEXT NOT NULL,
    "brand" "Brand",
    "kind" "CapacityActionKind" NOT NULL,
    "params" JSONB,
    "expectedRelief" JSONB,
    "status" "CapacityActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reasonCode" TEXT,
    "note" TEXT,
    "appliesFromDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapacityAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchSize" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "conflicts" INTEGER NOT NULL,
    "clockSkewMs" INTEGER NOT NULL,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeedMeta" (
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "seededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeedMeta_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "District_depotCode_idx" ON "District"("depotCode");

-- CreateIndex
CREATE INDEX "Outlet_depotCode_brand_idx" ON "Outlet"("depotCode", "brand");

-- CreateIndex
CREATE INDEX "Outlet_districtName_brand_idx" ON "Outlet"("districtName", "brand");

-- CreateIndex
CREATE INDEX "Outlet_parkingConstraint_idx" ON "Outlet"("parkingConstraint");

-- CreateIndex
CREATE INDEX "Vehicle_depotCode_temp_type_idx" ON "Vehicle"("depotCode", "temp", "type");

-- CreateIndex
CREATE INDEX "CalendarDay_isoYear_isoWeek_idx" ON "CalendarDay"("isoYear", "isoWeek");

-- CreateIndex
CREATE INDEX "CalendarDay_isOperating_date_idx" ON "CalendarDay"("isOperating", "date");

-- CreateIndex
CREATE INDEX "VehicleDayStatus_date_status_idx" ON "VehicleDayStatus"("date", "status");

-- CreateIndex
CREATE INDEX "DailyDemandHistory_depotCode_date_idx" ON "DailyDemandHistory"("depotCode", "date");

-- CreateIndex
CREATE INDEX "DemandForecast_depotCode_isoYear_idx" ON "DemandForecast"("depotCode", "isoYear");

-- CreateIndex
CREATE INDEX "ServiceObservation_brand_dockType_idx" ON "ServiceObservation"("brand", "dockType");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceObservation_brand_dockType_districtName_monsoon_key" ON "ServiceObservation"("brand", "dockType", "districtName", "monsoon");

-- CreateIndex
CREATE INDEX "HistoricalLeg_date_vehicleId_idx" ON "HistoricalLeg"("date", "vehicleId");

-- CreateIndex
CREATE INDEX "HistoricalLeg_routeId_seq_idx" ON "HistoricalLeg"("routeId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_at_idx" ON "AuditEvent"("entityType", "entityId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_at_idx" ON "AuditEvent"("actorUserId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_action_at_idx" ON "AuditEvent"("action", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_outletId_createdAt_idx" ON "Notification"("outletId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanningDay_status_idx" ON "PlanningDay"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningDay_date_depotCode_key" ON "PlanningDay"("date", "depotCode");

-- CreateIndex
CREATE UNIQUE INDEX "Order_clientRequestId_key" ON "Order"("clientRequestId");

-- CreateIndex
CREATE INDEX "Order_requestedDate_depotCode_status_idx" ON "Order"("requestedDate", "depotCode", "status");

-- CreateIndex
CREATE INDEX "Order_outletId_requestedDate_idx" ON "Order"("outletId", "requestedDate");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_ref_requestedDate_key" ON "Order"("ref", "requestedDate");

-- CreateIndex
CREATE INDEX "Plan_planningDayId_status_idx" ON "Plan"("planningDayId", "status");

-- CreateIndex
CREATE INDEX "Trip_planId_idx" ON "Trip"("planId");

-- CreateIndex
CREATE INDEX "Trip_vehicleId_status_idx" ON "Trip"("vehicleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_planId_vehicleId_tripNo_key" ON "Trip"("planId", "vehicleId", "tripNo");

-- CreateIndex
CREATE INDEX "TripStop_outletId_idx" ON "TripStop"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "TripStop_tripId_seq_key" ON "TripStop"("tripId", "seq");

-- CreateIndex
CREATE INDEX "TripStopOrder_orderId_idx" ON "TripStopOrder"("orderId");

-- CreateIndex
CREATE INDEX "Assignment_tripStopId_idx" ON "Assignment"("tripStopId");

-- CreateIndex
CREATE INDEX "Assignment_planId_decision_idx" ON "Assignment"("planId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_planId_orderId_key" ON "Assignment"("planId", "orderId");

-- CreateIndex
CREATE INDEX "StopReassignment_tripStopId_at_idx" ON "StopReassignment"("tripStopId", "at");

-- CreateIndex
CREATE INDEX "Deferral_orderId_idx" ON "Deferral"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Deferral_planId_orderId_key" ON "Deferral"("planId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "LoadCheck_clientRequestId_key" ON "LoadCheck"("clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "LoadCheck_tripId_orderId_key" ON "LoadCheck"("tripId", "orderId");

-- CreateIndex
CREATE INDEX "Shortfall_status_raisedAt_idx" ON "Shortfall"("status", "raisedAt");

-- CreateIndex
CREATE INDEX "Shortfall_tripId_idx" ON "Shortfall"("tripId");

-- CreateIndex
CREATE INDEX "StopEvent_tripStopId_occurredAt_idx" ON "StopEvent"("tripStopId", "occurredAt");

-- CreateIndex
CREATE INDEX "StopEvent_serverSeq_idx" ON "StopEvent"("serverSeq");

-- CreateIndex
CREATE INDEX "StopEvent_conflictState_idx" ON "StopEvent"("conflictState");

-- CreateIndex
CREATE INDEX "Problem_status_recordedAt_idx" ON "Problem"("status", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptConfirmation_orderId_key" ON "ReceiptConfirmation"("orderId");

-- CreateIndex
CREATE INDEX "FuelLedger_isoYear_isoWeek_idx" ON "FuelLedger"("isoYear", "isoWeek");

-- CreateIndex
CREATE UNIQUE INDEX "FuelLedger_vehicleId_isoYear_isoWeek_key" ON "FuelLedger"("vehicleId", "isoYear", "isoWeek");

-- CreateIndex
CREATE INDEX "FuelLedgerEntry_ledgerId_idx" ON "FuelLedgerEntry"("ledgerId");

-- CreateIndex
CREATE INDEX "FuelLedgerEntry_tripId_idx" ON "FuelLedgerEntry"("tripId");

-- CreateIndex
CREATE INDEX "CapacityAction_depotCode_isoYear_isoWeek_idx" ON "CapacityAction"("depotCode", "isoYear", "isoWeek");

-- CreateIndex
CREATE INDEX "CapacityAction_status_idx" ON "CapacityAction"("status");

-- CreateIndex
CREATE INDEX "SyncLog_deviceId_receivedAt_idx" ON "SyncLog"("deviceId", "receivedAt");

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_depotCode_fkey" FOREIGN KEY ("depotCode") REFERENCES "Depot"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_districtName_fkey" FOREIGN KEY ("districtName") REFERENCES "District"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_depotCode_fkey" FOREIGN KEY ("depotCode") REFERENCES "Depot"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_depotCode_fkey" FOREIGN KEY ("depotCode") REFERENCES "Depot"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDayStatus" ADD CONSTRAINT "VehicleDayStatus_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_planningDayId_fkey" FOREIGN KEY ("planningDayId") REFERENCES "PlanningDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStopOrder" ADD CONSTRAINT "TripStopOrder_tripStopId_fkey" FOREIGN KEY ("tripStopId") REFERENCES "TripStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStopOrder" ADD CONSTRAINT "TripStopOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_tripStopId_fkey" FOREIGN KEY ("tripStopId") REFERENCES "TripStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopReassignment" ADD CONSTRAINT "StopReassignment_tripStopId_fkey" FOREIGN KEY ("tripStopId") REFERENCES "TripStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopReassignment" ADD CONSTRAINT "StopReassignment_fromTripId_fkey" FOREIGN KEY ("fromTripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopReassignment" ADD CONSTRAINT "StopReassignment_toTripId_fkey" FOREIGN KEY ("toTripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deferral" ADD CONSTRAINT "Deferral_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deferral" ADD CONSTRAINT "Deferral_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadCheck" ADD CONSTRAINT "LoadCheck_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadCheck" ADD CONSTRAINT "LoadCheck_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortfall" ADD CONSTRAINT "Shortfall_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortfall" ADD CONSTRAINT "Shortfall_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortfall" ADD CONSTRAINT "Shortfall_loadCheckId_fkey" FOREIGN KEY ("loadCheckId") REFERENCES "LoadCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopEvent" ADD CONSTRAINT "StopEvent_tripStopId_fkey" FOREIGN KEY ("tripStopId") REFERENCES "TripStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopEvent" ADD CONSTRAINT "StopEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_tripStopId_fkey" FOREIGN KEY ("tripStopId") REFERENCES "TripStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptConfirmation" ADD CONSTRAINT "ReceiptConfirmation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLedger" ADD CONSTRAINT "FuelLedger_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLedgerEntry" ADD CONSTRAINT "FuelLedgerEntry_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "FuelLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLedgerEntry" ADD CONSTRAINT "FuelLedgerEntry_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
