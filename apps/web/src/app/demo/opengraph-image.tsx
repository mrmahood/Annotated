import { ImageResponse } from "next/og";
import { DEMO_PAGE_TITLE } from "./demo-data";

export const alt = DEMO_PAGE_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function DemoOpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#12110e",
          color: "#f6f3ea",
          padding: "72px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            letterSpacing: 4,
            color: "#cfc6b4",
          }}
        >
          ANNOTATED
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 68,
            lineHeight: 1.05,
            letterSpacing: -1,
            maxWidth: 980,
          }}
        >
          The fact-check layer for the web
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 36,
          }}
        >
          <div
            style={{
              display: "flex",
              background: "#ffe14a",
              color: "#1a170c",
              fontSize: 28,
              fontWeight: 700,
              padding: "10px 18px",
              borderRadius: 999,
            }}
          >
            Needs context
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
