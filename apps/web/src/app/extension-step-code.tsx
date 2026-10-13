"use client";

import { useEffect, useState } from "react";

const CHROME_EXTENSIONS_URL = "chrome://extensions";

export function ExtensionStepLine({
  text,
  code,
}: {
  text: string;
  code?: string;
}) {
  return (
    <li>
      <span className="install-extension-step-body">
        {text}
        {code ? (
          <>
            {" "}
            <span className="install-extension-code">
              <code>{code}</code>
              {code === CHROME_EXTENSIONS_URL ? <CopyExtensionsUrl /> : null}
            </span>
          </>
        ) : null}
      </span>
    </li>
  );
}

function CopyExtensionsUrl() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <>
      <button
        className="install-extension-copy"
        type="button"
        aria-label={copied ? "Copied chrome://extensions" : "Copy chrome://extensions"}
        onClick={() => {
          void navigator.clipboard.writeText(CHROME_EXTENSIONS_URL).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="visually-hidden" role="status">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}
