import { Suspense } from "react";
import { TierListView } from "@/components/TierListView";

export default function TiersPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <TierListView />
    </Suspense>
  );
}
