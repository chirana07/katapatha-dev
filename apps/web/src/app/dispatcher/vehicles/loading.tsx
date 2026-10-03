import { LoadingSkeleton } from "@/components/ui/states";

export default function VehiclesLoading() {
  return (
    <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
      <LoadingSkeleton label="Loading vehicles" />
    </main>
  );
}
