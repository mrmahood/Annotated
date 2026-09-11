"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_PREFERENCE_LABELS,
  APPEARANCE_PREFERENCES,
  SYSTEM_LIGHT_MEDIA_QUERY,
  appearancePreferenceIndex,
  resolveAppearanceTheme,
  type AppearancePreference,
  type AppearanceTheme,
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

function subscribeAppearance(onStoreChange: () => void) {
  window.addEventListener(APPEARANCE_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, onStoreChange);
}

function getAppearanceSnapshot() {
  return readStoredAppearancePreference(storageOrNull(), document.cookie);
}

function getAppearanceServerSnapshot(): AppearancePreference {
  return "system";
}

function subscribeSystemTheme(onStoreChange: () => void) {
  const media = window.matchMedia(SYSTEM_LIGHT_MEDIA_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getSystemPrefersLightSnapshot() {
  return window.matchMedia(SYSTEM_LIGHT_MEDIA_QUERY).matches;
}

function getSystemPrefersLightServerSnapshot() {
  return false;
}

function ThemeIcon({ theme }: { theme: AppearanceTheme }) {
  if (theme === "light") {
    return (
      <svg className="appearance-theme-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.35" />
        <path
          d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg className="appearance-theme-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M13.1 10.35A5.35 5.35 0 0 1 6.1 3.15 5.4 5.4 0 1 0 13.1 10.35Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CompactAppearanceMenu({
  preference,
  onSelect,
}: {
  preference: AppearancePreference;
  onSelect: (next: AppearancePreference) => void;
}) {
  const [open, setOpen] = useState(false);
  const prefersLight = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemPrefersLightSnapshot,
    getSystemPrefersLightServerSnapshot,
  );
  const theme = resolveAppearanceTheme(preference, prefersLight);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const label = APPEARANCE_PREFERENCE_LABELS[preference];

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const focusItem = (index: number) => {
    const next = (index + APPEARANCE_PREFERENCES.length) % APPEARANCE_PREFERENCES.length;
    itemRefs.current[next]?.focus();
  };

  useEffect(() => {
    if (!open) return;

    const selectedIndex = appearancePreferenceIndex(preference);
    itemRefs.current[selectedIndex]?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, preference]);

  const onButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpen(true);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    const current = itemRefs.current.findIndex((item) => item === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(current < 0 ? 0 : current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(current < 0 ? APPEARANCE_PREFERENCES.length - 1 : current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(APPEARANCE_PREFERENCES.length - 1);
    }
  };

  const selectPreference = (next: AppearancePreference) => {
    onSelect(next);
    closeMenu(true);
  };

  return (
    <div className="appearance-control appearance-control-compact" ref={rootRef}>
      <button
        ref={buttonRef}
        className="appearance-theme-button"
        type="button"
        aria-label={`Appearance: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-theme={theme}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onButtonKeyDown}
      >
        <ThemeIcon theme={theme} />
      </button>
      {open && (
        <div
          id={menuId}
          className="appearance-menu"
          role="menu"
          aria-label="Appearance"
          onKeyDown={onMenuKeyDown}
        >
          {APPEARANCE_PREFERENCES.map((value, index) => {
            const selected = preference === value;
            return (
              <button
                key={value}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className={`appearance-menu-item${selected ? " selected" : ""}`}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => selectPreference(value)}
              >
                {APPEARANCE_PREFERENCE_LABELS[value]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppearanceControl({ compact = false }: { compact?: boolean }) {
  const preference = useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getAppearanceServerSnapshot,
  );

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
  };

  if (compact) {
    return <CompactAppearanceMenu preference={preference} onSelect={selectPreference} />;
  }

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
            <label
              key={value}
              className={`appearance-segment${selected ? " selected" : ""}`}
            >
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
