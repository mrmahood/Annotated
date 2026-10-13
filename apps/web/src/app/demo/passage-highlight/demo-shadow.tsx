"use client";

import { useEffect, useRef } from "react";
import { DEMO_QUOTE, DEMO_SHADOW_LEAD, DEMO_SHADOW_TAIL } from "./fixture";

export function DemoShadowPassage() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || host.shadowRoot) return;
    const shadow = host.attachShadow({ mode: "open" });
    const paragraph = document.createElement("p");
    paragraph.textContent = `${DEMO_SHADOW_LEAD}${DEMO_QUOTE}${DEMO_SHADOW_TAIL}`;
    shadow.appendChild(paragraph);
  }, []);

  return <div ref={hostRef} data-demo-shadow="open" />;
}
