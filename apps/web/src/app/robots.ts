import type { MetadataRoute } from "next";
import { getRobotsDocument } from "@/lib/discoverability";

export default function robots(): MetadataRoute.Robots {
  return getRobotsDocument();
}
