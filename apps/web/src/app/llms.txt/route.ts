import { getLlmsTxt } from "@/lib/discoverability";

export function GET() {
  return new Response(getLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
