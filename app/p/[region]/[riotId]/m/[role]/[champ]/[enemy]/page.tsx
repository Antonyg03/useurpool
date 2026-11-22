import { Suspense } from "react";
import { MatchupView } from "@/components/MatchupView";

export default function MatchupPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <MatchupView />
    </Suspense>
  );
}
