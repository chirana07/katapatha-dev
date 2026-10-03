import { PageBody } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/states";

export default function StoreLoading() {
  return (
    <PageBody>
      <LoadingSkeleton label="Loading your outlet" rows={4} />
    </PageBody>
  );
}
