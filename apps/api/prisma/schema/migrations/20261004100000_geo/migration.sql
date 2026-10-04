-- CreateEnum
CREATE TYPE "GeoSource" AS ENUM ('SYNTHETIC', 'CSV', 'DISPATCHER');

-- CreateEnum
CREATE TYPE "RoadSource" AS ENUM ('OSRM', 'ESTIMATE');

-- AlterTable
ALTER TABLE "Depot" ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "geoSnapped" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "geoSource" "GeoSource",
ADD COLUMN     "geoUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "geoUpdatedByUserId" TEXT,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "returnAt" TEXT,
ADD COLUMN     "roadMinutes" DOUBLE PRECISION,
ADD COLUMN     "routePolyline" TEXT,
ADD COLUMN     "travelSource" TEXT;

-- AlterTable
ALTER TABLE "TripStop" ADD COLUMN     "leaveAt" TEXT,
ADD COLUMN     "legKm" DOUBLE PRECISION,
ADD COLUMN     "legMinutes" DOUBLE PRECISION,
ADD COLUMN     "serviceStartAt" TEXT;

-- CreateTable
CREATE TABLE "RoadLeg" (
    "fromKey" TEXT NOT NULL,
    "toKey" TEXT NOT NULL,
    "durationS" DOUBLE PRECISION NOT NULL,
    "distanceM" DOUBLE PRECISION NOT NULL,
    "source" "RoadSource" NOT NULL,
    "dataVersion" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoadLeg_pkey" PRIMARY KEY ("fromKey","toKey")
);
