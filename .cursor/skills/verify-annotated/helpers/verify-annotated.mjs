#!/usr/bin/env node
// Never print Supabase keys, service-role keys, or session tokens.

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyQuietList } from "./drive-outcome.mjs";
import {
  createSupabaseMintPort,
  mintDedicatedTestSession,
  readMintEnv,
  redactSecrets,
  toPlaywrightCookies,
} from "./mint-test-session.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const EVIDENCE_ROOT = join(REPO_ROOT, ".cursor/skills/verify-annotated/evidence");
const TMP_ROOT = "/tmp/verify-annotated";
const STATE_PATH = join(TMP_ROOT, "state.json");
const LOG_DIR = join(TMP_ROOT, "logs");
const TOOLS_DIR = join(TMP_ROOT, "tools");
const BROWSERS_DIR = join(TMP_ROOT, "ms-playwright");
const PROD_URL = "https://annotated.cbandcoop.com";
const LOCAL_URL = "http://127.0.0.1:3000";
const LOCAL_PORT = 3000;
const FEED_TITLE = "Public annotation feed";
const FEED_LEDE = "Your media notations across video, podcasts & text shared with the world.";

const COMMANDS = [
  "launch",
  "doctor",
  "drive",
  "cleanup",
  "help",
];

const QUIET_PAGES = {
  trending: {
    path: "/trending",
    heading: "This week’s most active annotations.",
    expectedTitle: "What’s Trending | Annotated",
    listLabel: "Trending annotations",
    presenceLabel: "Trending list present",
    emptyHeading: "Not enough trending activity yet.",
    emptyLabel: "Quiet heading",
    unavailableHeading: "Trending is temporarily unavailable.",
    extraNotes: ["- Side effects: none."],
  },
  "who-to-follow": {
    path: "/who-to-follow",
    heading: "Accounts worth following.",
    expectedTitle: "Who to Follow | Annotated",
    listLabel: "Suggested accounts",
    presenceLabel: "Suggested accounts present",
    emptyHeading: "No suggestions right now.",
    emptyLabel: "Empty heading",
    unavailableHeading: "Who to Follow is temporarily unavailable.",
    extraNotes: ["- Follow was not clicked.", "- Side effects: none."],
  },
};

const DRIVES = {
  "public-feed": drivePublicFeed,
  "public-annotation": drivePublicAnnotation,
  legal: driveLegal,
  trending: (ctx) => driveQuietPage(ctx, "trending", QUIET_PAGES.trending),
  "who-to-follow": (ctx) => driveQuietPage(ctx, "who-to-follow", QUIET_PAGES["who-to-follow"]),
  "me-signed-out": driveMeSignedOut,
};

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function readState() {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function writeState(state) {
  mkdirSync(TMP_ROOT, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function parseEnvFile(filePath) {
  const values = {};
  if (!existsSync(filePath)) return values;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function localEnvStatus() {
  const filePath = join(REPO_ROOT, "apps/web/.env.local");
  if (!existsSync(filePath)) return { ready: false, reason: "missing-file" };
  const env = parseEnvFile(filePath);
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !key || url.includes("YOUR_PROJECT_REF") || key.includes("YOUR_SUPABASE")) {
    return { ready: false, reason: "placeholder" };
  }
  try {
    const parsed = new URL(url);
    const httpsOrLocal = parsed.protocol === "https:" || parsed.hostname === "localhost";
    if (!httpsOrLocal || key.length < 20) return { ready: false, reason: "placeholder" };
  } catch {
    return { ready: false, reason: "placeholder" };
  }
  return { ready: true, reason: "ready" };
}

function resolveTarget() {
  const requested = process.env.VERIFY_ANNOTATED_TARGET;
  const envStatus = localEnvStatus();
  if (requested === "prod") {
    return {
      mode: "prod-public",
      baseUrl: PROD_URL,
      reason: "VERIFY_ANNOTATED_TARGET=prod",
    };
  }
  if (requested === "local") {
    if (!envStatus.ready) {
      die(`VERIFY_ANNOTATED_TARGET=local but apps/web/.env.local is ${envStatus.reason}. Values were not printed.`);
    }
    return { mode: "local", baseUrl: LOCAL_URL, reason: "VERIFY_ANNOTATED_TARGET=local" };
  }
  if (requested && requested !== "local" && requested !== "prod") {
    die(`VERIFY_ANNOTATED_TARGET must be local or prod. Received ${requested}.`);
  }
  if (envStatus.ready) {
    return { mode: "local", baseUrl: LOCAL_URL, reason: "apps/web/.env.local has a non-placeholder Supabase URL and publishable key" };
  }
  return {
    mode: "prod-public",
    baseUrl: PROD_URL,
    reason: `apps/web/.env.local is ${envStatus.reason}. Public verification target is ${PROD_URL}.`,
  };
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function extractTitle(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? decodeEntities(match[1]).trim() : "";
}

async function fetchPage(url) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: { accept: "text/html" },
  });
  const html = await response.text();
  return { status: response.status, title: extractTitle(html), finalUrl: response.url };
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processGroupId(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return Number(rest[2]);
  } catch {
    return null;
  }
}

function listenerPids(port) {
  if (process.platform === "win32") return [];
  const result = spawnSync("ss", ["-ltnp", `sport = :${port}`], { encoding: "utf8" });
  if (result.status !== 0) return { unavailable: true, pids: [] };
  const pids = [];
  for (const match of result.stdout.matchAll(/pid=(\d+)/g)) pids.push(Number(match[1]));
  return { unavailable: false, pids };
}

function localPortOwnedBy(pid) {
  const listeners = listenerPids(LOCAL_PORT);
  if (listeners.unavailable) {
    return { owned: null, detail: "ss unavailable; port ownership not verified" };
  }
  if (listeners.pids.length === 0) return { owned: false, detail: "nothing is listening on 3000" };
  const group = processGroupId(pid) ?? pid;
  const owned = listeners.pids.some((listener) => processGroupId(listener) === group || listener === pid);
  return {
    owned,
    detail: owned
      ? `port 3000 is held by pid group ${group}`
      : `port 3000 is held by ${listeners.pids.join(",")} which is not pid group ${group}`,
  };
}

async function doctorState(state) {
  const page = await fetchPage(`${state.baseUrl}/`);
  const titleOk = page.title.includes(FEED_TITLE);
  const httpOk = page.status === 200;
  let ownedProcess = "n/a";
  let processOk = true;
  if (state.mode === "local") {
    processOk = pidAlive(state.pid);
    const port = localPortOwnedBy(state.pid);
    ownedProcess = processOk ? `pid ${state.pid} alive; ${port.detail}` : `pid ${state.pid} is not alive`;
    if (port.owned === false) processOk = false;
  }
  const ready = httpOk && titleOk && processOk;
  return { ready, httpOk, titleOk, processOk, ownedProcess, page };
}

function printDoctor(state, report) {
  console.log(`mode: ${state.mode}`);
  console.log(`baseUrl: ${state.baseUrl}`);
  console.log(`runId: ${state.runId}`);
  console.log(`reason: ${state.reason}`);
  console.log(`http: ${report.page.status}`);
  console.log(`title: ${report.page.title || "(none)"}`);
  console.log(`ownedProcess: ${report.ownedProcess}`);
  console.log(`ready: ${report.ready ? "yes" : "no"}`);
}

function requireState() {
  const state = readState();
  if (!state?.baseUrl || !state.mode || !state.runId) {
    die("No verification state. Run launch before doctor or drive.");
  }
  return state;
}

async function waitForLocalReady(state) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (!pidAlive(state.pid)) return false;
    try {
      const report = await doctorState(state);
      if (report.ready) return true;
    } catch {
      // Next is still booting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  return false;
}

async function launch() {
  const existing = readState();
  if (existing?.pid && pidAlive(existing.pid)) {
    console.log(`launch: reusing local run ${existing.runId} at ${existing.baseUrl}`);
    return;
  }
  if (existing?.mode === "prod-public" && !existing.pid) {
    console.log(`launch: reusing prod-public run ${existing.runId} at ${existing.baseUrl}`);
    console.log(`reason: ${existing.reason}`);
    return;
  }
  const target = resolveTarget();
  const state = {
    runId: stamp(),
    mode: target.mode,
    baseUrl: target.baseUrl,
    reason: target.reason,
    pid: null,
    logPath: null,
    startedAt: new Date().toISOString(),
  };
  if (target.mode === "local") {
    const listeners = listenerPids(LOCAL_PORT);
    if (!listeners.unavailable && listeners.pids.length > 0) {
      die(`Port ${LOCAL_PORT} is already in use by pid ${listeners.pids.join(",")}. Refusing to adopt a server this run did not start.`);
    }
    const nextBin = join(REPO_ROOT, "apps/web/node_modules/next/package.json");
    if (!existsSync(nextBin)) {
      die("Local launch needs dependencies. From the repository root run: pnpm install --frozen-lockfile");
    }
    mkdirSync(LOG_DIR, { recursive: true });
    const logPath = join(LOG_DIR, `${state.runId}.log`);
    const out = openSync(logPath, "a");
    const child = spawn(
      "pnpm",
      ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(LOCAL_PORT)],
      {
        cwd: REPO_ROOT,
        detached: true,
        stdio: ["ignore", out, out],
      },
    );
    child.unref();
    state.pid = child.pid;
    state.logPath = logPath;
    writeState(state);
    console.log(`launch: starting local next dev pid ${state.pid}`);
    console.log(`log: ${logPath}`);
    const ready = await waitForLocalReady(state);
    if (!ready) {
      killStarted(state);
      rmSync(STATE_PATH, { force: true });
      die(`Local server pid ${state.pid} did not become ready. See ${logPath}.`);
    }
  } else {
    writeState(state);
    console.log(`launch: prod-public ${state.baseUrl}`);
    console.log(`reason: ${state.reason}`);
    console.log("launch: no local server started");
  }
  console.log(`runId: ${state.runId}`);
}

async function doctor() {
  const state = requireState();
  let report;
  try {
    report = await doctorState(state);
  } catch (error) {
    console.log(`mode: ${state.mode}`);
    console.log(`baseUrl: ${state.baseUrl}`);
    console.log(`runId: ${state.runId}`);
    console.log(`http: error`);
    console.log(`title: (none)`);
    console.log(`ownedProcess: ${state.mode === "local" ? `pid ${state.pid}` : "n/a"}`);
    console.log("ready: no");
    die(error instanceof Error ? error.message : String(error));
  }
  printDoctor(state, report);
  if (!report.ready) process.exit(1);
}

function killStarted(state) {
  if (!state?.pid) return false;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(state.pid), "/T", "/F"], { stdio: "ignore" });
    return true;
  }
  try {
    process.kill(-state.pid, "SIGTERM");
  } catch {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      return false;
    }
  }
  return true;
}

function cleanup() {
  const state = readState();
  if (state?.pid) {
    const killed = killStarted(state);
    console.log(killed ? `cleanup: stopped pid ${state.pid}` : `cleanup: pid ${state.pid} was not running`);
  } else {
    console.log("cleanup: no local server was started by this run");
  }
  if (existsSync(STATE_PATH)) rmSync(STATE_PATH);
  if (existsSync(LOG_DIR)) rmSync(LOG_DIR, { recursive: true, force: true });
  console.log(`cleanup: left evidence at ${EVIDENCE_ROOT}`);
  console.log("cleanup: left Playwright cache at /tmp/verify-annotated/tools");
}

function ensurePlaywright() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;
  mkdirSync(TOOLS_DIR, { recursive: true });
  const pkgJson = join(TOOLS_DIR, "package.json");
  if (!existsSync(pkgJson)) {
    writeFileSync(pkgJson, "{\"private\":true}\n");
  }
  const pkg = join(TOOLS_DIR, "node_modules/playwright/package.json");
  if (!existsSync(pkg)) {
    console.log("drive: installing playwright into /tmp/verify-annotated/tools");
    const install = spawnSync("npm", ["install", "--silent", "playwright@1.55.1"], {
      cwd: TOOLS_DIR,
      stdio: "inherit",
    });
    if (install.status !== 0) die("Could not install Playwright.");
  }
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR };
  const cli = join(TOOLS_DIR, "node_modules/playwright/cli.js");
  console.log("drive: ensuring Chromium is installed");
  const browser = spawnSync(process.execPath, [cli, "install", "chromium"], {
    cwd: TOOLS_DIR,
    env,
    stdio: "inherit",
  });
  if (browser.status !== 0) die("Could not install Chromium for Playwright.");
  const requireFromTools = createRequire(join(TOOLS_DIR, "package.json"));
  return { chromium: requireFromTools("playwright").chromium, env };
}

async function withBrowser(state, featureId, run) {
  const report = await doctorState(state);
  printDoctor(state, report);
  if (!report.ready) die("Doctor failed. Not driving.");
  const { chromium, env } = ensurePlaywright();
  Object.assign(process.env, env);
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const dir = join(EVIDENCE_ROOT, featureId, state.runId);
  mkdirSync(dir, { recursive: true });
  let exitCode = 0;
  let failed = null;
  try {
    const outcome = await run({ page, context, state, dir });
    if (outcome?.exitCode === 2) exitCode = 2;
  } catch (error) {
    failed = error;
    exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
    try {
      await page.screenshot({ path: join(dir, "error.png") });
    } catch {
      // The page may not have opened.
    }
    if (!existsSync(join(dir, "notes.md"))) {
      writeNotes(dir, [
        `# Proof: ${featureId}`,
        "",
        "- Result: fail",
        `- Error: ${error instanceof Error ? error.message : String(error)}`,
        "- Side effects: none intended. Browser was closed without clicking sign-in.",
      ]);
    }
  } finally {
    await browser.close();
  }
  console.log(`evidence: ${dir}`);
  if (exitCode === 2) process.exit(2);
  if (failed) die(failed instanceof Error ? failed.message : String(failed), exitCode);
}

async function dismissCallout(page) {
  const button = page.getByRole("button", { name: "Dismiss install reminder" });
  if (await button.count()) {
    await button.click();
    return true;
  }
  return false;
}

async function shot(page, filePath) {
  await page.screenshot({ path: filePath });
}

function writeNotes(dir, lines) {
  writeFileSync(join(dir, "notes.md"), `${lines.join("\n")}\n`);
}

async function drivePublicFeed({ page, state, dir }) {
  const response = await page.goto(`${state.baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByText(FEED_LEDE).waitFor({ timeout: 15000 });
  const title = await page.title();
  await shot(page, join(dir, "feed-loaded.png"));
  const dismissed = await dismissCallout(page);
  const list = page.locator("[aria-label=\"Published annotations\"]");
  const articles = await list.locator("article").count();
  const view = page.getByRole("link", { name: "View annotation" });
  const viewCount = await view.count();
  const firstHref = viewCount > 0 ? await view.first().getAttribute("href") : null;
  const unavailable = await page.getByRole("alert").filter({ hasText: "temporarily unavailable" }).count();
  const empty = await page.getByRole("heading", { name: "No annotations have been published yet." }).count();
  await list.scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, join(dir, "feed.png"));
  writeFileSync(join(dir, "feed.aria.txt"), await page.locator("main").ariaSnapshot());
  const pass = response?.status() === 200 && title.includes(FEED_TITLE) && articles > 0 && viewCount > 0 && !unavailable && !empty;
  writeNotes(dir, [
    "# Proof: public-feed",
    "",
    `- Feature ID: public-feed`,
    `- Entry: GET /`,
    `- Base URL: ${state.baseUrl}`,
    `- Mode: ${state.mode}`,
    `- Run: ${state.runId}`,
    `- Action: opened the public feed in a fresh signed-out browser.`,
    `- HTTP status: ${response?.status() ?? "unknown"}`,
    `- Title: ${title}`,
    `- Lede visible: yes`,
    `- Install callout dismissed before result screenshot: ${dismissed ? "yes" : "no"}`,
    `- Published annotation articles: ${articles}`,
    `- View annotation links: ${viewCount}`,
    `- First View annotation href: ${firstHref ?? "(none)"}`,
    `- Unavailable alert: ${unavailable ? "yes" : "no"}`,
    `- Empty heading: ${empty ? "yes" : "no"}`,
    `- Side effects: none. No sign-in, comment, follow, bookmark, reshare, or vote.`,
    `- Result: ${pass ? "pass" : "fail"}`,
  ]);
  if (!pass) throw new Error("public-feed proof failed. Evidence was kept.");
  console.log(`drive: public-feed pass (${articles} articles)`);
}

async function drivePublicAnnotation({ page, state, dir }) {
  await page.goto(`${state.baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByText(FEED_LEDE).waitFor({ timeout: 15000 });
  await shot(page, join(dir, "loaded.png"));
  const view = page.getByRole("link", { name: "View annotation" }).first();
  if (await view.count() === 0) {
    writeNotes(dir, ["# Proof: public-annotation", "", "- Result: fail", "- Reason: no View annotation link on the feed."]);
    throw new Error("public-annotation proof failed. No card link.");
  }
  const href = await view.getAttribute("href");
  await view.click();
  await page.waitForURL((url) => url.origin === new URL(state.baseUrl).origin && url.pathname !== "/", { timeout: 20000 });
  await page.getByRole("heading", { name: "Comments" }).waitFor({ timeout: 15000 });
  const title = await page.title();
  const source = page.getByRole("link", {
    name: /^(Open clip on YouTube|Open clip on TikTok|Open clip on Spotify|Open original source|View original source)/,
  });
  const sourceCount = await source.count();
  await shot(page, join(dir, "result.png"));
  writeFileSync(join(dir, "result.aria.txt"), await page.locator("main").ariaSnapshot());
  const path = new URL(page.url()).pathname;
  const pass = title.startsWith("Annotation on ") && sourceCount > 0 && (path.startsWith("/a/") || /^\/[^/]+\/[^/]+$/.test(path));
  writeNotes(dir, [
    "# Proof: public-annotation",
    "",
    `- Feature ID: public-annotation`,
    `- Entry: first View annotation link on /`,
    `- Href followed: ${href}`,
    `- Final path: ${path}`,
    `- Title: ${title}`,
    `- Source link visible: ${sourceCount > 0 ? "yes" : "no"}`,
    `- Comments heading visible: yes`,
    `- Side effects: none. Source link was not opened.`,
    `- Result: ${pass ? "pass" : "fail"}`,
  ]);
  if (!pass) throw new Error("public-annotation proof failed. Evidence was kept.");
  console.log(`drive: public-annotation pass ${path}`);
}

async function driveLegal({ page, state, dir }) {
  const response = await page.goto(`${state.baseUrl}/legal`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { level: 1, name: "Policies for Annotated" }).waitFor({ timeout: 15000 });
  const footer = page.getByRole("navigation", { name: "Legal" });
  const footerOk = await footer.getByRole("link", { name: "Privacy" }).count() > 0
    && await footer.getByRole("link", { name: "Terms" }).count() > 0
    && await footer.getByRole("link", { name: "Legal" }).count() > 0;
  await shot(page, join(dir, "loaded.png"));
  await page.getByRole("link", { name: "Read the Privacy Policy" }).click();
  await page.waitForURL((url) => url.pathname === "/privacy", { timeout: 20000 });
  await page.getByRole("heading", { level: 1, name: "Privacy Policy" }).waitFor({ timeout: 15000 });
  const privacyTitle = await page.title();
  const who = await page.getByRole("link", { name: "Who operates Annotated" }).count();
  await shot(page, join(dir, "result.png"));
  writeFileSync(join(dir, "result.aria.txt"), await page.locator("main").ariaSnapshot());
  await page.goto(`${state.baseUrl}/terms`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { level: 1, name: "Terms of Service" }).waitFor({ timeout: 15000 });
  const termsTitle = await page.title();
  const agreement = await page.getByRole("link", { name: "Agreement to the terms" }).count();
  writeFileSync(join(dir, "terms.aria.txt"), await page.locator("main").ariaSnapshot());
  const legalTitle = "Legal | Annotated";
  const pass = response?.ok() && footerOk && privacyTitle === "Privacy Policy | Annotated" && who > 0
    && termsTitle === "Terms of Service | Annotated" && agreement > 0;
  writeNotes(dir, [
    "# Proof: legal",
    "",
    `- Feature ID: legal`,
    `- Entry: GET /legal`,
    `- Legal title expected: ${legalTitle}`,
    `- Footer Legal nav has Privacy, Terms, and Legal: ${footerOk ? "yes" : "no"}`,
    `- Privacy title: ${privacyTitle}`,
    `- Who operates Annotated link: ${who > 0 ? "yes" : "no"}`,
    `- Terms title: ${termsTitle}`,
    `- Agreement to the terms link: ${agreement > 0 ? "yes" : "no"}`,
    `- Side effects: none. Mailto links were not opened.`,
    `- Result: ${pass ? "pass" : "fail"}`,
  ]);
  if (!pass) throw new Error("legal proof failed. Evidence was kept.");
  console.log("drive: legal pass");
}

async function driveQuietPage({ page, state, dir }, featureId, spec) {
  const response = await page.goto(`${state.baseUrl}${spec.path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const httpStatus = response?.status() ?? 0;
  let title = "";
  let listCount = 0;
  let empty = 0;
  let unavailable = 0;
  if (httpStatus >= 200 && httpStatus < 300) {
    await page.getByRole("heading", { level: 1, name: spec.heading }).waitFor({ timeout: 15000 });
    title = await page.title();
    listCount = await page.locator(`[aria-label="${spec.listLabel}"]`).count();
    empty = await page.getByRole("heading", { name: spec.emptyHeading }).count();
    unavailable = await page.getByRole("heading", { name: spec.unavailableHeading }).count();
  } else {
    title = await page.title().catch(() => "");
  }
  await shot(page, join(dir, "result.png"));
  const aria = await page.locator("main").ariaSnapshot().catch(() => "(no main)");
  writeFileSync(join(dir, "result.aria.txt"), aria);
  const outcome = classifyQuietList({
    httpStatus,
    title,
    expectedTitle: spec.expectedTitle,
    listCount,
    emptyVisible: empty > 0,
    unavailableVisible: unavailable > 0,
  });
  writeNotes(dir, [
    `# Proof: ${featureId}`,
    "",
    `- Feature ID: ${featureId}`,
    `- Entry: GET ${spec.path}`,
    `- HTTP status: ${httpStatus || "none"}`,
    `- Title: ${title || "(none)"}`,
    `- ${spec.presenceLabel}: ${listCount > 0 ? "yes" : "no"}`,
    `- ${spec.emptyLabel}: ${empty ? "yes" : "no"}`,
    `- Unavailable heading: ${unavailable ? "yes" : "no"}`,
    ...spec.extraNotes,
    `- Result: ${outcome.result}`,
  ]);
  console.log(`drive: ${featureId} ${outcome.result}`);
  if (outcome.exitCode === 2) return outcome;
  if (outcome.exitCode !== 0) {
    throw new Error(`${featureId} proof failed (${outcome.reason}). Evidence was kept.`);
  }
}

async function driveMeSignedOut({ page, state, dir }) {
  await page.goto(`${state.baseUrl}/me`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Sign in to see your bookmarks." }).waitFor({ timeout: 15000 });
  const title = await page.title();
  const bookmarks = await page.getByRole("heading", { level: 1, name: "Bookmarks" }).count();
  const google = await page.getByRole("button", { name: "Sign in with Google" }).count();
  await shot(page, join(dir, "result.png"));
  writeFileSync(join(dir, "result.aria.txt"), await page.locator("main").ariaSnapshot());
  const pass = title === "Bookmarks | Annotated" && bookmarks > 0 && google > 0;
  writeNotes(dir, [
    "# Proof: me-signed-out",
    "",
    `- Feature ID: me-signed-out`,
    `- Entry: GET /me`,
    `- Title: ${title}`,
    `- Bookmarks heading: ${bookmarks > 0 ? "yes" : "no"}`,
    `- Sign in with Google visible: ${google > 0 ? "yes" : "no"}`,
    `- Sign-in was not clicked.`,
    `- Result: ${pass ? "pass" : "fail"}`,
  ]);
  if (!pass) throw new Error("me-signed-out proof failed. Evidence was kept.");
  console.log("drive: me-signed-out pass");
}

async function driveAuthenticatedMePage({ page, context, state, dir, sessionCookies }) {
  await context.addCookies(toPlaywrightCookies(sessionCookies, state.baseUrl));
  const response = await page.goto(`${state.baseUrl}/me`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const httpStatus = response?.status() ?? 0;
  await page.getByRole("heading", { level: 1, name: "Bookmarks" }).waitFor({ timeout: 15000 });
  const dismissed = await dismissCallout(page);
  const title = await page.title();
  const handle = await page.getByRole("region", { name: "Public handle" }).count();
  const feedback = await page.getByRole("link", { name: "Send feedback" }).count();
  const signOut = await page.getByRole("button", { name: "Sign out" }).count();
  const wall = await page.getByRole("heading", { name: "Sign in to see your bookmarks." }).count();
  const google = await page.getByRole("button", { name: "Sign in with Google" }).count();
  const unavailable = await page.getByRole("heading", { name: "Bookmarks are temporarily unavailable." }).count();
  const empty = await page.getByRole("heading", { name: "No bookmarks yet." }).count();
  const list = page.locator("[aria-label=\"Your bookmarks\"]");
  const listCount = await list.count();
  const viewCount = listCount > 0 ? await list.getByRole("link", { name: "View annotation" }).count() : 0;
  await shot(page, join(dir, "result.png"));
  writeFileSync(join(dir, "result.aria.txt"), await page.locator("main").ariaSnapshot());
  const sessionOk = httpStatus >= 200 && httpStatus < 300
    && title === "Bookmarks | Annotated"
    && handle > 0 && feedback > 0 && signOut > 0
    && wall === 0 && google === 0;
  const cards = listCount > 0 && viewCount > 0 && empty === 0;
  const quiet = empty > 0 && listCount === 0;
  const bookmarkState = !sessionOk
    ? "session-not-recognized"
    : unavailable
      ? "unavailable"
      : cards
        ? "cards"
        : quiet
          ? "empty"
          : "unrecognized";
  const pass = sessionOk && unavailable === 0 && (cards || quiet);
  writeNotes(dir, [
    "# Proof: authenticated-me",
    "",
    "- Feature ID: authenticated-me",
    "- Entry: dedicated test session, then GET /me",
    `- HTTP status: ${httpStatus || "none"}`,
    `- Title: ${title}`,
    `- Public handle region: ${handle > 0 ? "yes" : "no"}`,
    `- Send feedback link: ${feedback > 0 ? "yes" : "no"}`,
    `- Sign out button: ${signOut > 0 ? "yes" : "no"}`,
    `- Sign-in wall: ${wall > 0 ? "yes" : "no"}`,
    `- Bookmarks: ${bookmarkState}`,
    `- View annotation links: ${viewCount}`,
    `- Install callout dismissed: ${dismissed ? "yes" : "no"}`,
    "- Claim handle, Save handle, Bookmarked, Share, Sign out, and Send feedback were not clicked.",
    "- Side effects: none intended. No bookmark, comment, follow, reshare, vote, or handle claim.",
    `- Result: ${pass ? "pass" : "fail"}`,
  ]);
  if (!pass) throw new Error(`authenticated-me proof failed (${bookmarkState}). Evidence was kept.`);
  console.log(`drive: authenticated-me pass (${bookmarkState} bookmarks)`);
}

async function driveAuthenticatedMeCommand() {
  const config = readMintEnv(process.env);
  if (!config.ok) unreachable("authenticated-me", config.message);
  const state = requireState();
  const report = await doctorState(state);
  printDoctor(state, report);
  if (!report.ready) die("Doctor failed. Not driving.");
  let minted;
  try {
    minted = await mintDedicatedTestSession(createSupabaseMintPort({
      url: config.url,
      serviceRoleKey: config.serviceRoleKey,
      publishableKey: config.publishableKey,
    }), config.email);
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "mint_failed";
    const dir = join(EVIDENCE_ROOT, "authenticated-me", state.runId);
    mkdirSync(dir, { recursive: true });
    writeNotes(dir, [
      "# Proof: authenticated-me",
      "",
      "- Feature ID: authenticated-me",
      "- Entry: session mint, then GET /me",
      "- Result: fail",
      `- Reason: ${code}`,
      "- The browser was not opened.",
      "- Side effects: none intended. No bookmark, comment, follow, reshare, vote, or handle claim.",
    ]);
    die(redactSecrets(`authenticated-me mint failed: ${code}`, [config.serviceRoleKey, config.publishableKey]), 1);
  }
  console.log(redactSecrets(minted.log, [
    config.serviceRoleKey,
    config.publishableKey,
    ...minted.cookies.map((cookie) => cookie.value),
  ]));
  await withBrowser(state, "authenticated-me", (ctx) => driveAuthenticatedMePage({
    ...ctx,
    sessionCookies: minted.cookies,
  }));
}

function unreachable(feature, precondition) {
  console.log("verified-unreachable");
  console.log(`feature: ${feature}`);
  console.log(`prerequisite: ${precondition}`);
  console.log("route attempted: none. OAuth and extension load were not started.");
  process.exit(3);
}

function help() {
  console.log(`verify-annotated

Commands (run from the repository root):

  node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs launch
  node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs doctor
  node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs drive <feature>
  node .cursor/skills/verify-annotated/helpers/verify-annotated.mjs cleanup

Features: ${Object.keys(DRIVES).join(", ")}, chrome-extension, authenticated-me

Exit codes: 0 pass, 1 fail, 2 pass-empty, 3 verified-unreachable.
chrome-extension stays exit 3. It needs an unpacked extension, and a website session does not load the side panel.
authenticated-me exits 3 until SUPABASE_SERVICE_ROLE_KEY is set.
Evidence stays in .cursor/skills/verify-annotated/evidence/.
`);
}

const command = process.argv[2];
if (!COMMANDS.includes(command)) {
  help();
  process.exit(command ? 1 : 0);
}

if (command === "help") help();
if (command === "launch") await launch();
if (command === "doctor") await doctor();
if (command === "cleanup") cleanup();
if (command === "drive") {
  const feature = process.argv[3];
  if (feature === "chrome-extension") {
    unreachable("chrome-extension", "Chrome extension load (unpacked MV3 side panel). A website session does not load the side panel. Not started.");
  } else if (feature === "authenticated-me") {
    await driveAuthenticatedMeCommand();
  } else {
    const drive = DRIVES[feature];
    if (!drive) die(`Unknown feature ${feature ?? "(missing)"}. Run help.`);
    const state = requireState();
    await withBrowser(state, feature, drive);
  }
}
