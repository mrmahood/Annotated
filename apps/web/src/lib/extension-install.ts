export const EXTENSION_DOWNLOAD_PATH = "/extension.zip";
export const EXTENSION_CALLOUT_DISMISSED_STORAGE_KEY =
  "annotated.install-extension-callout.dismissed.v1";
export const EXTENSION_CALLOUT_DISMISSED_VALUE = "1";

export const PROD_WEB_APP_ORIGIN = "https://annotated.cbandcoop.com";
export const PROD_SUPABASE_ORIGIN = "https://vnxjktpdzmykmqrqwvks.supabase.co";
export const STAGING_SUPABASE_HOST = "nkkunkwirvfwhmpwonqz.supabase.co";

export const EXTENSION_INSTALL_STEPS = [
  { text: "Download the extension package and unzip it." },
  { text: "Open your extensions page:", code: "chrome://extensions" },
  { text: "Turn on Developer mode (top right)." },
  { text: "Click Load unpacked and select the unzipped folder." },
  { text: "Open the Annotated sidebar from the toolbar icon." },
] as const;

export const EXTENSION_INSTALL_COPY = {
  calloutTitle: "Install for Chrome",
  calloutBody:
    "Annotate pages as you browse with the Annotated sidebar. We're not on the Chrome Web Store yet.",
  calloutBodyNonChrome:
    "This is a Chrome extension and works best in Google Chrome. We're not on the Chrome Web Store yet.",
  calloutCta: "Get sidebar",
  modalEyebrow: "Annotated sidebar",
  modalTitle: "Install for Chrome",
  modalPitch:
    "We're not on the Chrome Web Store yet. Download the package and load it unpacked. Takes about a minute.",
  modalPitchNonChrome:
    "This is a Chrome extension and works best in Google Chrome. We're not on the Chrome Web Store yet. You can still download the package and load it unpacked in Chrome.",
  downloadCta: "Download extension",
  footer:
    "The zip includes manifest.json and everything else Chrome needs. Keep the unzipped folder in place after installing.",
} as const;

type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function isLikelyGoogleChrome(userAgent: string): boolean {
  if (!userAgent) return false;
  if (/CriOS\//.test(userAgent)) return true;
  if (!/Chrome\//.test(userAgent)) return false;
  return !/Edg\/|EdgiOS\/|OPR\/|Opera\/|SamsungBrowser\/|UCBrowser\/|YaBrowser\//.test(
    userAgent,
  );
}

export function isInstallCalloutDismissed(
  storage: Pick<KeyValueStorage, "getItem"> | null | undefined,
): boolean {
  return storage?.getItem(EXTENSION_CALLOUT_DISMISSED_STORAGE_KEY) ===
    EXTENSION_CALLOUT_DISMISSED_VALUE;
}

export function persistInstallCalloutDismissed(
  storage: Pick<KeyValueStorage, "setItem"> | null | undefined,
): void {
  storage?.setItem(
    EXTENSION_CALLOUT_DISMISSED_STORAGE_KEY,
    EXTENSION_CALLOUT_DISMISSED_VALUE,
  );
}
