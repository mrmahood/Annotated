import type { WhoToFollowProfile } from "@/lib/data/who-to-follow";
import { WhoToFollowCard } from "./who-to-follow-card";

export function WhoToFollowList({
  suggestions,
  currentUserId,
  returnTo,
}: {
  suggestions: WhoToFollowProfile[];
  currentUserId: string | null;
  returnTo: string;
}) {
  return (
    <ul className="who-to-follow-list">
      {suggestions.map((suggestion) => (
        <li key={suggestion.profileId}>
          <WhoToFollowCard
            suggestion={suggestion}
            currentUserId={currentUserId}
            returnTo={returnTo}
          />
        </li>
      ))}
    </ul>
  );
}

export function WhoToFollowRail({
  suggestions,
  currentUserId,
  returnTo,
}: {
  suggestions: WhoToFollowProfile[];
  currentUserId: string | null;
  returnTo: string;
}) {
  return (
    <aside className="who-to-follow-rail" aria-labelledby="who-to-follow-heading">
      <div className="who-to-follow-head">
        <p className="eyebrow">Who to Follow</p>
        <h2 id="who-to-follow-heading">Suggested accounts</h2>
      </div>
      <WhoToFollowList
        suggestions={suggestions}
        currentUserId={currentUserId}
        returnTo={returnTo}
      />
    </aside>
  );
}
