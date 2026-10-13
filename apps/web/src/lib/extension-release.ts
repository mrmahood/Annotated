import { EXTENSION_WHATS_NEW_PATH } from "./extension-install.ts";

export const WHATS_NEW_PATH = EXTENSION_WHATS_NEW_PATH;
export const EXTENSION_VERSION_PATH = "/extension-version.json";
export const EXTENSION_DOWNLOAD_PATH = "/extension.zip";

export const WHATS_NEW_HEADING = "What's new";
export const WHATS_NEW_LEDE =
  "The current Annotated extension, a 30-second way to update the copy you already installed, and what changed.";

export const EXTENSION_UPDATE_GUIDE = [
  { text: "Download the zip." },
  { text: "Unzip it over the old folder, replacing the files in place." },
  { text: "Open", code: "chrome://extensions" },
  { text: "Click Reload on Annotated." },
  { text: "Your sign-in stays." },
] as const;

/**
 * User-facing notes drawn from merged work in PRs #163–#174.
 * #167 and #168 are verification tooling and have no public entry.
 * #174 is the in-flight capture and microphone fix this version expects.
 */
export const EXTENSION_CHANGELOG = [
  {
    version: "0.2.1",
    items: [
      "The header mark stays readable in dark mode: a cream bar and asterisk on the yellow highlight.",
      "The Chrome toolbar icon is a yellow tile, so the mark stays clear on light and dark toolbars.",
    ],
  },
  {
    version: "0.2.0",
    items: [
      "Annotated is the fact-check layer for the web. A note can be a fact check, receipts, or context, with a verdict and links back to the sources.",
      "Published passages highlight on the page you are reading. Wikipedia lines split by citation markers still light up. If a quote could match more than one place, it stays unmarked.",
      "After you publish, you can post the take to X. A cited post stays attached, and suggested sources wait until you approve them.",
      "The public site leads with the fact-check line, a home illustration, and a comment-first annotation page. On a narrow window, Sign in stays clear of the header.",
      "Clip recording asks Chrome for the tab from the extension itself, and the microphone warning only appears when the microphone is actually blocked.",
    ],
  },
] as const;
