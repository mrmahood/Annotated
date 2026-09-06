"use client";

import { ProviderSignInButton } from "./provider-sign-in-button";

export function ProviderSignInActions({
  returnTo,
  className,
  googleLabel,
  xLabel,
}: {
  returnTo: string;
  className?: string;
  googleLabel?: string;
  xLabel?: string;
}) {
  return (
    <div className="provider-sign-in-actions">
      <ProviderSignInButton
        provider="google"
        returnTo={returnTo}
        label={googleLabel}
        className={className}
      />
      <ProviderSignInButton
        provider="x"
        returnTo={returnTo}
        label={xLabel}
        className={className}
      />
    </div>
  );
}
