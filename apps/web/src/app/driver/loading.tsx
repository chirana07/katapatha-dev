import { LoadingSkeleton } from "@/components/ui/states";

export default function DriverLoading() {
  return (
    <main className="mx-auto w-full max-w-xl p-4">
      <LoadingSkeleton label="Loading your run" rows={4} />
    </main>
  );
}
