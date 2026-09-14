import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/extension.zip",
        headers: [
          { key: "Content-Type", value: "application/zip" },
          { key: "Content-Disposition", value: 'attachment; filename="extension.zip"' },
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
