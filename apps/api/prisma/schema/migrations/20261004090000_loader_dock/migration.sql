-- AlterTable
ALTER TABLE "Depot" ADD COLUMN     "dockBays" INTEGER NOT NULL DEFAULT 6;

-- AlterTable
ALTER TABLE "LoadCheck" ADD COLUMN     "itemCounts" JSONB;

-- AlterTable
ALTER TABLE "Shortfall" ADD COLUMN     "photoData" TEXT,
ADD COLUMN     "productSku" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "dockBay" INTEGER,
ADD COLUMN     "loadStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "staffId" TEXT;

-- CreateTable
CREATE TABLE "LoadProgress" (
    "tripId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "loadedUnits" INTEGER NOT NULL,
    "itemCounts" JSONB,
    "updatedByName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoadProgress_pkey" PRIMARY KEY ("tripId","orderId")
);

-- CreateTable
CREATE TABLE "VehicleSwap" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "fromVehicleId" TEXT NOT NULL,
    "toVehicleId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousDepartAt" TEXT NOT NULL,
    "newDepartAt" TEXT NOT NULL,
    "unloadedUnits" INTEGER NOT NULL,
    "previousLoad" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unloadedAt" TIMESTAMP(3),
    "unloadedByName" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "arrivedByName" TEXT,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "VehicleSwap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DockNote" (
    "depotCode" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DockNote_pkey" PRIMARY KEY ("depotCode","date")
);

-- CreateIndex
CREATE INDEX "VehicleSwap_tripId_createdAt_idx" ON "VehicleSwap"("tripId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_staffId_key" ON "User"("staffId");

-- AddForeignKey
ALTER TABLE "LoadProgress" ADD CONSTRAINT "LoadProgress_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadProgress" ADD CONSTRAINT "LoadProgress_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSwap" ADD CONSTRAINT "VehicleSwap_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSwap" ADD CONSTRAINT "VehicleSwap_fromVehicleId_fkey" FOREIGN KEY ("fromVehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSwap" ADD CONSTRAINT "VehicleSwap_toVehicleId_fkey" FOREIGN KEY ("toVehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

