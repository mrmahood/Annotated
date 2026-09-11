"use client";

import { useEffect, useState } from "react";
import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_PREFERENCE_LABELS,
  APPEARANCE_PREFERENCES,
  SYSTEM_LIGHT_MEDIA_QUERY,
  appearancePreferenceIndex,
  parseAppearancePreference,
  type AppearancePreference,
} from "@annotated/shared/appearance";
import {
  applyStoredAppearance,
  dispatchAppearanceChange,
  persistAppearancePreference,
  readStoredAppearancePreference,
} from "@/lib/appearance";

function systemPrefersLightNow(): boolean {
  return window.matchMedia(SYSTEM_LIGHT_MEDIA_QUERY).matches;
}

function storageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function AppearanceRuntime() {
  useEffect(() => {
    const applyCurrent = () => {
      applyStoredAppearance(
        document.documentElement,
        readStoredAppearancePreference(storageOrNull(), document.cookie),
        systemPrefersLightNow(),
      );
    };

    applyCurrent();
    const media = window.matchMedia(SYSTEM_LIGHT_MEDIA_QUERY);
    const onMedia = () => {
      if (readStoredAppearancePreference(storageOrNull(), document.cookie) === "system") {
        applyCurrent();
      }
    };
    media.addEventListener("change", onMedia);
    return () => media.removeEventListener("change", onMedia);
  }, []);

  return null;
}

export function AppearanceControl({ compact = false }: { compact?: boolean }) {
  const [preference, setPreference] = useState<AppearancePreference>("system");

  useEffect(() => {
    setPreference(readStoredAppearancePreference(storageOrNull(), document.cookie));

    const onChange = (event: Event) => {
      setPreference(parseAppearancePreference((event as CustomEvent<unknown>).detail));
    };
    window.addEventListener(APPEARANCE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, onChange);
  }, []);

  const selectPreference = (next: AppearancePreference) => {
    const saved = persistAppearancePreference(
      next,
      storageOrNull(),
      (value) => {
        document.cookie = value;
      },
      window.location.protocol === "https:",
    );
    applyStoredAppearance(document.documentElement, saved, systemPrefersLightNow());
    dispatchAppearanceChange(saved);
    setPreference(saved);
  };

  return (
    <fieldset className={`appearance-control${compact ? " appearance-control-compact" : ""}`}>
      <legend className={compact ? "visually-hidden" : "section-label"}>Appearance</legend>
      <div
        className="appearance-segmented"
        role="radiogroup"
        aria-label="Appearance"
        data-index={String(appearancePreferenceIndex(preference))}
      >
        {APPEARANCE_PREFERENCES.map((value) => {
          const selected = preference === value;
          return (
            <label
              key={value}
              className={`appearance-segment${selected ? " selected" : ""}`}
            >
              <input
                type="radio"
                name={compact ? "site-appearance" : "appearance"}
                value={value}
                checked={selected}
                onChange={() => selectPreference(value)}
              />
              {APPEARANCE_PREFERENCE_LABELS[value]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
