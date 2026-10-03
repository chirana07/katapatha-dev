import { PageBody } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/states";

export default function LoaderLoading() {
  return (
    <PageBody>
      <LoadingSkeleton label="Loading the dock" />
    </PageBody>
  );
}
