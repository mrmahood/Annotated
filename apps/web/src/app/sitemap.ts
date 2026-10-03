import type { MetadataRoute } from "next";
import { getSitemapEntries } from "@/lib/discoverability";

export default function sitemap(): MetadataRoute.Sitemap {
  return getSitemapEntries();
}
