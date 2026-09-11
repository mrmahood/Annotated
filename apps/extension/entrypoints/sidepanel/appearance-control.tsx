import { useEffect, useState } from 'react';
import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_PREFERENCE_LABELS,
  APPEARANCE_PREFERENCES,
  appearancePreferenceIndex,
  parseAppearancePreference,
  type AppearancePreference,
} from '@annotated/shared/appearance';
import {
  applyAppearancePreference,
  dispatchAppearanceChange,
  getExtensionChrome,
  persistAppearancePreference,
  readLocalAppearancePreference,
} from '../../utils/appearance';

function storageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function systemPrefersLightNow(): boolean {
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function AppearanceControl() {
  const [preference, setPreference] = useState<AppearancePreference>(
    readLocalAppearancePreference(storageOrNull()),
  );

  useEffect(() => {
    const onChange = (event: Event) => {
      setPreference(parseAppearancePreference((event as CustomEvent<unknown>).detail));
    };
    window.addEventListener(APPEARANCE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, onChange);
  }, []);

  const selectPreference = (next: AppearancePreference) => {
    const saved = parseAppearancePreference(next);
    setPreference(saved);
    applyAppearancePreference(saved, document.documentElement, systemPrefersLightNow());
    dispatchAppearanceChange(saved);
    void persistAppearancePreference(saved, getExtensionChrome(), storageOrNull());
  };

  return (
    <fieldset className="appearance-control">
      <legend className="section-label">Appearance</legend>
      <div
        className="appearance-segmented"
        role="radiogroup"
        aria-label="Appearance"
        data-index={String(appearancePreferenceIndex(preference))}
      >
        {APPEARANCE_PREFERENCES.map((value) => {
          const selected = preference === value;
          return (
            <label key={value} className={`appearance-segment${selected ? ' selected' : ''}`}>
              <input
                type="radio"
                name="appearance"
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
