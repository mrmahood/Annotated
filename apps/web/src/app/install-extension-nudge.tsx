"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  EXTENSION_DOWNLOAD_PATH,
  EXTENSION_INSTALL_COPY,
  EXTENSION_INSTALL_STEPS,
  isInstallCalloutDismissed,
  isLikelyGoogleChrome,
  persistInstallCalloutDismissed,
} from "@/lib/extension-install";

const INSTALL_CALLOUT_CHANGE_EVENT = "annotated:install-extension-callout";

function storageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function ChromeMark() {
  return (
    <svg
      className="install-extension-chrome-mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10.2" fill="#fff" />
      <path
        fill="#EA4335"
        d="M12 1.8A10.2 10.2 0 0 1 20.83 6.9H12.9A3.9 3.9 0 0 0 9.4 8.9L6.1 3.3A10.2 10.2 0 0 1 12 1.8Z"
      />
      <path
        fill="#34A853"
        d="M21.15 7.2A10.2 10.2 0 0 1 12 22.2a10.16 10.16 0 0 1-8.4-4.5l5.5-3.15A3.9 3.9 0 0 0 12 15.9h9.1c.03-.3.05-.6.05-.9 0-2.8-1.14-5.32-2.98-7.8Z"
      />
      <path
        fill="#FBBC05"
        d="M3.6 17.7A10.2 10.2 0 0 1 12 1.8c.9 0 1.77.12 2.6.34L11.3 8.9A3.9 3.9 0 0 0 8.1 12c0 .73.2 1.4.55 1.98L3.6 17.7Z"
      />
      <circle cx="12" cy="12" r="3.9" fill="#4285F4" />
      <circle cx="12" cy="12" r="2.15" fill="#fff" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function subscribeInstallCallout(onStoreChange: () => void) {
  window.addEventListener(INSTALL_CALLOUT_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(INSTALL_CALLOUT_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getDismissedSnapshot() {
  return isInstallCalloutDismissed(storageOrNull());
}

function getDismissedServerSnapshot() {
  return true;
}

function subscribeNavigator() {
  return () => {};
}

function getChromeSnapshot() {
  return isLikelyGoogleChrome(window.navigator.userAgent);
}

function getChromeServerSnapshot() {
  return true;
}

function dispatchInstallCalloutChange() {
  window.dispatchEvent(new Event(INSTALL_CALLOUT_CHANGE_EVENT));
}

export function InstallExtensionNudge() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dismissed = useSyncExternalStore(
    subscribeInstallCallout,
    getDismissedSnapshot,
    getDismissedServerSnapshot,
  );
  const isChrome = useSyncExternalStore(
    subscribeNavigator,
    getChromeSnapshot,
    getChromeServerSnapshot,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (modalOpen && !node.open) node.showModal();
    if (!modalOpen && node.open) node.close();
  }, [modalOpen]);

  const dismissCallout = () => {
    persistInstallCalloutDismissed(storageOrNull());
    dispatchInstallCalloutChange();
    setModalOpen(false);
  };

  const calloutBody = isChrome
    ? EXTENSION_INSTALL_COPY.calloutBody
    : EXTENSION_INSTALL_COPY.calloutBodyNonChrome;
  const modalPitch = isChrome
    ? EXTENSION_INSTALL_COPY.modalPitch
    : EXTENSION_INSTALL_COPY.modalPitchNonChrome;

  return (
    <>
      {!dismissed ? (
        <aside className="install-extension-nudge" aria-label="Install the Chrome extension">
          <div className="install-extension-callout">
            <div className="install-extension-callout-head">
              <ChromeMark />
              <button
                className="install-extension-icon-button"
                type="button"
                aria-label="Dismiss install reminder"
                onClick={dismissCallout}
              >
                <CloseIcon />
              </button>
            </div>
            <h2>{EXTENSION_INSTALL_COPY.calloutTitle}</h2>
            <p>{calloutBody}</p>
            <button
              className="button button-primary install-extension-callout-cta"
              type="button"
              onClick={() => setModalOpen(true)}
            >
              {EXTENSION_INSTALL_COPY.calloutCta}
            </button>
          </div>
        </aside>
      ) : null}

      <dialog
        ref={dialogRef}
        className="install-extension-modal"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => setModalOpen(false)}
      >
        <div className="install-extension-modal-head">
          <ChromeMark />
          <button
            className="install-extension-icon-button"
            type="button"
            aria-label="Close"
            onClick={() => setModalOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>
        <p className="eyebrow">{EXTENSION_INSTALL_COPY.modalEyebrow}</p>
        <h2 id={titleId}>{EXTENSION_INSTALL_COPY.modalTitle}</h2>
        <p id={descriptionId} className="install-extension-modal-pitch">
          {modalPitch}
        </p>
        <a
          className="button button-primary install-extension-download"
          href={EXTENSION_DOWNLOAD_PATH}
          download="extension.zip"
        >
          {EXTENSION_INSTALL_COPY.downloadCta}
        </a>
        <ol className="install-extension-steps">
          {EXTENSION_INSTALL_STEPS.map((step, index) => (
            <li key={index}>
              {step.text}
              {"code" in step && step.code ? (
                <>
                  {" "}
                  <code>{step.code}</code>
                </>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="install-extension-modal-footer">{EXTENSION_INSTALL_COPY.footer}</p>
      </dialog>
    </>
  );
}
