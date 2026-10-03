-- CreateEnum
CREATE TYPE "ChillerSource" AS ENUM ('LOADER_AT_BAY', 'DRIVER_ON_ARRIVAL');

-- CreateEnum
CREATE TYPE "PodPageKind" AS ENUM ('RECEIPT', 'SIGNATURE', 'PHOTO');

-- CreateTable
CREATE TABLE "VehiclePing" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "tripId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedByUserId" TEXT,
    "deviceId" TEXT,
    "clientPingId" TEXT,

    CONSTRAINT "VehiclePing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChillerReading" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "tripId" TEXT,
    "tripStopId" TEXT,
    "tempC" DOUBLE PRECISION NOT NULL,
    "targetMinC" DOUBLE PRECISION NOT NULL,
    "targetMaxC" DOUBLE PRECISION NOT NULL,
    "source" "ChillerSource" NOT NULL,
    "recordedByUserId" TEXT,
    "recordedByName" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "clientReadingId" TEXT,

    CONSTRAINT "ChillerReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodPage" (
    "id" TEXT NOT NULL,
    "stopEventId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "PodPageKind" NOT NULL,
    "data" TEXT NOT NULL,
    "qualityFlags" TEXT[],
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PodPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehiclePing_clientPingId_key" ON "VehiclePing"("clientPingId");

-- CreateIndex
CREATE INDEX "VehiclePing_vehicleId_recordedAt_idx" ON "VehiclePing"("vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "VehiclePing_tripId_recordedAt_idx" ON "VehiclePing"("tripId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChillerReading_clientReadingId_key" ON "ChillerReading"("clientReadingId");

-- CreateIndex
CREATE INDEX "ChillerReading_vehicleId_recordedAt_idx" ON "ChillerReading"("vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "ChillerReading_tripId_recordedAt_idx" ON "ChillerReading"("tripId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PodPage_stopEventId_seq_key" ON "PodPage"("stopEventId", "seq");

-- AddForeignKey
ALTER TABLE "VehiclePing" ADD CONSTRAINT "VehiclePing_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehiclePing" ADD CONSTRAINT "VehiclePing_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChillerReading" ADD CONSTRAINT "ChillerReading_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChillerReading" ADD CONSTRAINT "ChillerReading_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChillerReading" ADD CONSTRAINT "ChillerReading_tripStopId_fkey" FOREIGN KEY ("tripStopId") REFERENCES "TripStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodPage" ADD CONSTRAINT "PodPage_stopEventId_fkey" FOREIGN KEY ("stopEventId") REFERENCES "StopEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
