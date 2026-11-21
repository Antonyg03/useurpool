import type { Champion } from "@/lib/ddragon";
import type { Tier } from "@/lib/types";

export function Portrait({
  champ,
  tier,
  small,
}: {
  champ: Champion | undefined;
  tier?: Tier;
  small?: boolean;
}) {
  return (
    <div className={`portrait ${tier ? `tier-${tier}` : ""} ${small ? "sm" : ""}`}>
      {champ ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={champ.image} alt={champ.name} loading="lazy" />
      ) : (
        <div className="ph" />
      )}
    </div>
  );
}
