import { createClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/public-content";
import {
  receiptsAssistEnabled,
  requestReceiptSuggestion,
  ReceiptAssistError,
} from "@/lib/receipts";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "cache-control": "no-store",
};

class ReceiptRouteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "ReceiptRouteError";
    this.code = code;
    this.status = status;
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function routeError(error: unknown) {
  if (error instanceof ReceiptRouteError) return json({ error: error.code }, error.status);
  if (error instanceof ReceiptAssistError) {
    return json({ error: error.code }, error.code === "RECEIPTS_UNAVAILABLE" ? 404 : 502);
  }
  return json({ error: "RECEIPTS_FAILED" }, 502);
}

async function verifiedUserId(request: Request): Promise<string> {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1] || match[1].length < 20) throw new ReceiptRouteError("AUTH_REQUIRED", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new ReceiptRouteError("SERVER_MISCONFIGURED", 500);
  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
  });
  const { data, error } = await supabase.auth.getUser(match[1]);
  if (error || !data.user || !isUuid(data.user.id)) throw new ReceiptRouteError("AUTH_REQUIRED", 401);
  return data.user.id;
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function GET() {
  return json({ enabled: receiptsAssistEnabled() });
}

export async function POST(request: Request) {
  try {
    if (!receiptsAssistEnabled()) throw new ReceiptAssistError("RECEIPTS_UNAVAILABLE");
    await verifiedUserId(request);
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new ReceiptRouteError("INVALID_REQUEST", 400);
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).byteLength > 8_000) {
      throw new ReceiptRouteError("INVALID_REQUEST", 400);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ReceiptRouteError("INVALID_REQUEST", 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ReceiptRouteError("INVALID_REQUEST", 400);
    }
    const record = body as Record<string, unknown>;
    const passage = typeof record.passage === "string" ? record.passage.trim() : "";
    if (passage.length < 1 || passage.length > 2_000) throw new ReceiptRouteError("INVALID_REQUEST", 400);
    const pageUrl = typeof record.pageUrl === "string" ? record.pageUrl.trim() : "";
    if (pageUrl) {
      try {
        const parsed = new URL(pageUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new ReceiptRouteError("INVALID_REQUEST", 400);
        }
      } catch (error) {
        if (error instanceof ReceiptRouteError) throw error;
        throw new ReceiptRouteError("INVALID_REQUEST", 400);
      }
    }
    const suggestion = await requestReceiptSuggestion(
      { passage, pageUrl: pageUrl || null },
      {
        apiKey: process.env.AI_GATEWAY_API_KEY ?? "",
        model: process.env.AI_GATEWAY_MODEL,
      },
    );
    return json(suggestion);
  } catch (error) {
    return routeError(error);
  }
}
