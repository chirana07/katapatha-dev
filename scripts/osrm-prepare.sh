#!/bin/sh
# Build the OSRM road-network data for Sri Lanka from OpenStreetMap.
#
#   pnpm osrm:prepare        # once, and again to refresh the road data
#   pnpm osrm:up             # start the routing service on localhost:5000
#
# Downloads the Geofabrik extract (about 100 MB), then runs OSRM's three
# preprocessing steps (extract, partition, customize) in the same image the
# service uses. Needs Docker and roughly 2-4 GB of free memory. Output goes to
# ./.osrm, which is not committed.
set -eu

cd "$(dirname "$0")/.."
DATA=.osrm
PBF="$DATA/sri-lanka-latest.osm.pbf"
IMAGE="ghcr.io/project-osrm/osrm-backend:v5.27.1"

mkdir -p "$DATA"

echo "[osrm] Downloading the Sri Lanka extract (only if newer than the copy here)..."
if [ -f "$PBF" ]; then
  curl -fL --progress-bar -z "$PBF" -o "$PBF" https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf
else
  curl -fL --progress-bar -o "$PBF" https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf
fi

run() {
  docker run --rm -v "$PWD/$DATA:/data" "$IMAGE" "$@"
}

echo "[osrm] Extracting (car profile)..."
run osrm-extract -p /opt/car.lua /data/sri-lanka-latest.osm.pbf
echo "[osrm] Partitioning..."
run osrm-partition /data/sri-lanka-latest.osrm
echo "[osrm] Customizing..."
run osrm-customize /data/sri-lanka-latest.osrm

echo "[osrm] Done. Start it with: pnpm osrm:up   (then set OSRM_URL=http://localhost:5000 for the API)"
