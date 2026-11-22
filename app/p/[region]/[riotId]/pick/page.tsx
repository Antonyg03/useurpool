import { Suspense } from "react";
import { PickView } from "@/components/PickView";

export default function PickPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <PickView />
    </Suspense>
  );
}
