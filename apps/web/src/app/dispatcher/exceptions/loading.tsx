import { PageBody } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <PageBody>
      <LoadingSkeleton label="Loading exceptions" />
    </PageBody>
  );
}
