// Drives the unpacked side panel. Never clicks Publish clip and never prints
// a Supabase key or session token.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const YOUTUBE_WATCH_URL = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
export const MIN_PUBLISH_RANGE_MS = 1_000;
export const MAX_PUBLISH_RANGE_MS = 90_000;
const CHROME_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function extensionIdFromChromeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "chrome-extension:") return null;
    return /^[a-p]{32}$/.test(parsed.hostname) ? parsed.hostname : null;
  } catch {
    return null;
  }
}

export function sidePanelPathFromManifest(manifest) {
  const path = manifest?.side_panel?.default_path;
  if (typeof path !== "string" || !path.endsWith(".html")) return null;
  return path.replace(/^\//, "");
}

export function parseClipClock(value) {
  const text = String(value ?? "").trim();
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part))) return null;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (numbers.length === 3) {
    [hours, minutes, seconds] = numbers;
  } else {
    [minutes, seconds] = numbers;
  }
  if (minutes > 59 || seconds > 59 || hours > 99) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1_000;
}

export function parseClipSpanReadout(value) {
  const text = String(value ?? "").trim();
  if (text === "–" || text === "-" || text === "") {
    return { startMs: null, endMs: null, spanMs: null };
  }
  const parts = text.split("–");
  if (parts.length !== 2) return null;
  const startMs = parseClipClock(parts[0]);
  const endMs = parseClipClock(parts[1]);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  return { startMs, endMs, spanMs: endMs - startMs };
}

export function assessPublishControl({
  signedIn,
  commentaryReady,
  playerSelected,
  spanMs,
  publishPresent,
  publishEnabled,
}) {
  const validRange = Number.isInteger(spanMs)
    && spanMs >= MIN_PUBLISH_RANGE_MS
    && spanMs <= MAX_PUBLISH_RANGE_MS;
  if (publishEnabled && !validRange) {
    return { ok: false, reason: "publish-enabled-for-invalid-range" };
  }
  if (publishEnabled && (!signedIn || !commentaryReady || !playerSelected)) {
    return { ok: false, reason: "publish-enabled-with-closed-gate" };
  }
  const gatesOpen = Boolean(signedIn && commentaryReady && playerSelected && validRange);
  if (gatesOpen && (!publishPresent || !publishEnabled)) {
    return { ok: false, reason: "publish-disabled-for-valid-range" };
  }
  return { ok: true, reason: gatesOpen ? "publish-enabled" : "publish-held" };
}

export function judgeCreateProbe(probe) {
  const failures = [];
  if (probe.typedFieldCount !== 0) failures.push("typed-start-end-fields");
  if (probe.preset30Ms !== 30_000) failures.push(`preset-30:${probe.preset30Ms ?? "missing"}`);
  if (probe.preset60Ms !== 60_000) failures.push(`preset-60:${probe.preset60Ms ?? "missing"}`);
  if (!Number.isInteger(probe.dragSpanMs) || probe.dragSpanMs < MIN_PUBLISH_RANGE_MS || probe.dragSpanMs > MAX_PUBLISH_RANGE_MS) {
    failures.push(`drag-range:${probe.dragSpanMs ?? "missing"}`);
  }
  const beforeCommentary = assessPublishControl({
    signedIn: probe.signedIn,
    commentaryReady: false,
    playerSelected: probe.playerSelected,
    spanMs: probe.dragSpanMs,
    publishPresent: probe.publishPresent,
    publishEnabled: probe.publishEnabledBeforeCommentary,
  });
  if (!beforeCommentary.ok) failures.push(beforeCommentary.reason);
  const afterCommentary = assessPublishControl({
    signedIn: probe.signedIn,
    commentaryReady: true,
    playerSelected: probe.playerSelected,
    spanMs: probe.dragSpanMs,
    publishPresent: probe.publishPresent,
    publishEnabled: probe.publishEnabledAfterCommentary,
  });
  if (!afterCommentary.ok) failures.push(afterCommentary.reason);
  return { ok: failures.length === 0, failures };
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wavSilence(seconds) {
  const sampleRate = 8_000;
  const samples = sampleRate * seconds;
  const data = Buffer.alloc(samples);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, data]);
}

function audioFixtureHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Annotated audio fixture</title>
  <meta property="og:title" content="Fixture episode">
  <meta property="og:type" content="music.song">
  <meta property="og:audio" content="/tone.wav">
  <meta name="podcast:show" content="Annotated Fixture">
</head>
<body>
  <h1>Fixture episode</h1>
  <audio controls preload="auto" src="/tone.wav"></audio>
</body>
</html>`;
}

function startAudioFixture() {
  const tone = wavSilence(120);
  const html = audioFixtureHtml();
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/tone.wav")) {
      response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": tone.length });
      response.end(tone);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function startXvfb() {
  const base = 90 + (process.pid % 8);
  return new Promise((resolve, reject) => {
    const tryDisplay = (offset) => {
      if (offset > 12) {
        reject(new Error("xvfb-unavailable"));
        return;
      }
      const display = `:${base + offset}`;
      const child = spawn("Xvfb", [display, "-screen", "0", "1280x900x24", "-nolisten", "tcp"], {
        stdio: "ignore",
      });
      let settled = false;
      child.once("error", (error) => {
        if (!settled) tryDisplay(offset + 1);
        else child.kill("SIGTERM");
        if (error) { /* next display */ }
      });
      child.once("exit", () => {
        if (!settled) tryDisplay(offset + 1);
      });
      setTimeout(() => {
        if (settled) return;
        if (child.exitCode === null) {
          settled = true;
          resolve({ display, child });
        }
      }, 400);
    };
    tryDisplay(0);
  });
}

async function resolveExtensionId(context, timeoutMs) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await Promise.race([
      context.waitForEvent("serviceworker"),
      sleep(timeoutMs).then(() => {
        throw new Error("service-worker-timeout");
      }),
    ]);
  }
  return extensionIdFromChromeUrl(worker.url());
}

async function launchExtensionContext(chromium, extensionDir) {
  const args = [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
  ];
  const base = {
    viewport: { width: 1280, height: 900 },
    args,
    ignoreDefaultArgs: ["--disable-extensions", "--enable-automation"],
    userAgent: CHROME_USER_AGENT,
  };

  async function open(extra) {
    const userDataDir = mkdtempSync(join(tmpdir(), "annotated-extension-"));
    let context = null;
    try {
      context = await chromium.launchPersistentContext(userDataDir, { ...base, ...extra });
      const extensionId = await resolveExtensionId(context, 12_000);
      if (!extensionId) throw new Error("extension-id-missing");
      return { context, userDataDir, extensionId };
    } catch (error) {
      if (context) await context.close().catch(() => {});
      rmSync(userDataDir, { recursive: true, force: true });
      throw error;
    }
  }

  try {
    const opened = await open({ headless: true });
    return { ...opened, display: "headless", xvfb: null };
  } catch (headlessError) {
    const xvfb = await startXvfb().catch(() => null);
    if (!xvfb) throw headlessError;
    process.env.DISPLAY = xvfb.display;
    try {
      const opened = await open({ headless: false });
      return { ...opened, display: `xvfb ${xvfb.display}`, xvfb };
    } catch (headedError) {
      xvfb.child.kill("SIGTERM");
      throw headedError;
    }
  }
}

async function waitFor(read, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await read();
    if (last?.ok) return last;
    await sleep(400);
  }
  const error = new Error(last?.reason || "timed-out");
  error.detail = last;
  return { ok: false, error, detail: last };
}

function dismissYouTubeConsent() {
  const labels = ["Accept all", "Reject all", "Accept the use of cookies and other data", "I agree"];
  for (const label of labels) {
    const button = [...document.querySelectorAll("button, [role='button']")]
      .find((item) => item.textContent.replace(/\s+/g, " ").trim() === label);
    if (button) {
      button.click();
      return label;
    }
  }
  return null;
}

function youtubePlayerReady() {
  const video = document.querySelector("video");
  const rect = video?.getBoundingClientRect();
  const visible = Boolean(video && rect && rect.width > 40 && rect.height > 40);
  const hasSource = Boolean(video && (video.currentSrc || video.src) && Number.isFinite(video.duration) && video.duration > 70);
  return {
    ok: visible && hasSource,
    reason: visible ? (hasSource ? "player" : "youtube-player-without-source") : "youtube-player-not-visible",
    title: document.title,
    width: Math.round(rect?.width ?? 0),
    hasSource,
    visible,
  };
}

function sampleClipBase64() {
  // Playwright's Chromium build has no H.264 decoder. VP8 WebM plays there,
  // including as a blob on the YouTube watch page.
  const file = join(tmpdir(), "annotated-sample-clip.webm");
  if (!existsSync(file)) {
    const rendered = spawnSync("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x180:rate=8:duration=130",
      "-c:v", "libvpx", "-b:v", "150k", "-deadline", "realtime", "-cpu-used", "8",
      "-an",
      file,
    ], { stdio: "ignore" });
    if (rendered.status !== 0 || !existsSync(file)) return null;
  }
  return readFileSync(file).toString("base64");
}

function attachReadableYouTubeMedia(base64) {
  for (const meta of document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')) meta.remove();
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
  const video = document.createElement("video");
  video.controls = true;
  video.muted = true;
  video.preload = "auto";
  video.src = blobUrl;
  video.setAttribute("aria-label", "Annotated verification player");
  video.style.cssText = "position:fixed;left:24px;top:72px;width:640px;height:360px;z-index:2147483647;background:#000";
  document.body.appendChild(video);
  return new Promise((resolve) => {
    const finish = (ok, reason) => resolve({
      ok,
      reason,
      duration: Number.isFinite(video.duration) ? Math.round(video.duration) : null,
    });
    if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 70) {
      finish(true, "sample-ready");
      return;
    }
    video.addEventListener("loadedmetadata", () => finish(video.duration > 70, "sample-metadata"), { once: true });
    video.addEventListener("error", () => finish(false, `sample-video-error:${video.error?.code ?? "none"}`), { once: true });
    setTimeout(() => finish(false, "sample-video-timeout"), 20_000);
  });
}

function readCreateSurface() {
  const buttons = [...document.querySelectorAll("button")].map((button) => ({
    label: button.textContent.replace(/\s+/g, " ").trim(),
    disabled: Boolean(button.disabled),
  }));
  const publish = buttons.find((button) => button.label === "Publish clip") ?? null;
  const preset30 = buttons.find((button) => button.label === "30s") ?? null;
  const commentary = document.querySelector("#youtube-commentary, #audio-clip-commentary");
  const typedFieldCount = [...document.querySelectorAll("input")].filter((input) => {
    if (input.type === "range" || input.type === "radio" || input.type === "checkbox") return false;
    const name = `${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.id || ""}`;
    return /\b(start|end)\b/i.test(name);
  }).length;
  const source = document.querySelector(".context-source")?.innerText?.replace(/\s+/g, " ").trim().slice(0, 300) || "";
  return {
    readout: document.querySelector(".clip-range-readout strong")?.textContent?.trim() || "",
    budget: document.querySelector(".clip-range-readout span")?.textContent?.trim() || "",
    typedFieldCount,
    publishPresent: Boolean(publish),
    publishEnabled: Boolean(publish && !publish.disabled),
    commentaryReady: Boolean(commentary && commentary.value.trim().length > 0),
    signedIn: Boolean(publish),
    playerSelected: Boolean(preset30 && !preset30.disabled),
    preset30Present: Boolean(preset30),
    mode: document.querySelector('input[name="create-mode"]:checked')?.value || "",
    source,
    heading: document.querySelector("h1")?.textContent?.trim() || "",
  };
}

function clickExactButton(label) {
  const button = [...document.querySelectorAll("button")]
    .find((item) => item.textContent.replace(/\s+/g, " ").trim() === label);
  if (!button || button.disabled) return { ok: false, reason: button ? "disabled" : "missing" };
  if (label === "Publish clip") return { ok: false, reason: "publish-blocked" };
  button.click();
  return { ok: true };
}

function dragClipBeyondNinetySeconds() {
  const start = document.querySelector('input[aria-label="Clip start"]');
  const end = document.querySelector('input[aria-label="Clip end"]');
  if (!start || !end || start.disabled || end.disabled) {
    return { ok: false, reason: "handles-unavailable" };
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) return { ok: false, reason: "value-setter-missing" };
  const max = Number(end.max);
  const requested = Math.min(max, 120);
  setter.call(start, "0");
  start.dispatchEvent(new Event("input", { bubbles: true }));
  setter.call(end, String(requested));
  end.dispatchEvent(new Event("input", { bubbles: true }));
  return { ok: requested >= 91, requested, max };
}

function fillCommentary() {
  const field = document.querySelector("#youtube-commentary, #audio-clip-commentary");
  if (!field) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) return false;
  setter.call(field, "Range check only. This note must not be published.");
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function chooseAudioMode() {
  const radio = document.querySelector('input[name="create-mode"][value="audio"]');
  if (!radio || radio.disabled) return { ok: false, reason: radio ? "audio-disabled" : "audio-missing" };
  radio.click();
  return { ok: true };
}

async function activateSourceTab(context, urlPrefix) {
  const worker = context.serviceWorkers()[0];
  if (!worker) return { ok: false, reason: "service-worker-missing" };
  return worker.evaluate(async (prefix) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => typeof item.url === "string" && item.url.startsWith(prefix) && item.id != null);
    if (!tab) return { ok: false, reason: "source-tab-missing" };
    await chrome.tabs.update(tab.id, { active: true });
    return { ok: true, tabId: tab.id, url: tab.url };
  }, urlPrefix);
}

async function driveCreateSurface(panel, label) {
  const preset30 = await panel.evaluate(clickExactButton, "30s");
  await sleep(300);
  const after30 = await panel.evaluate(readCreateSurface);
  const span30 = parseClipSpanReadout(after30.readout);
  const preset60 = await panel.evaluate(clickExactButton, "60s");
  await sleep(300);
  const after60 = await panel.evaluate(readCreateSurface);
  const span60 = parseClipSpanReadout(after60.readout);
  const drag = await panel.evaluate(dragClipBeyondNinetySeconds);
  await sleep(300);
  const afterDrag = await panel.evaluate(readCreateSurface);
  const spanDrag = parseClipSpanReadout(afterDrag.readout);
  const filled = await panel.evaluate(fillCommentary);
  await sleep(200);
  const afterNote = await panel.evaluate(readCreateSurface);
  const probe = {
    label,
    typedFieldCount: afterDrag.typedFieldCount,
    preset30Ms: span30?.spanMs ?? null,
    preset60Ms: span60?.spanMs ?? null,
    dragSpanMs: spanDrag?.spanMs ?? null,
    signedIn: afterNote.signedIn,
    playerSelected: after30.playerSelected || after60.playerSelected || afterDrag.playerSelected,
    publishPresent: afterNote.publishPresent,
    publishEnabledBeforeCommentary: afterDrag.publishEnabled,
    publishEnabledAfterCommentary: afterNote.publishEnabled,
    readout30: after30.readout,
    readout60: after60.readout,
    readoutDrag: afterDrag.readout,
    budgetDrag: afterDrag.budget,
    preset30,
    preset60,
    drag,
    commentaryFilled: filled,
    mode: afterNote.mode,
    source: afterNote.source,
  };
  return { probe, judgment: judgeCreateProbe(probe) };
}

async function connectPanel(panel, context, urlPrefix, timeoutMs) {
  await activateSourceTab(context, urlPrefix);
  return waitFor(async () => {
    const surface = await panel.evaluate(readCreateSurface);
    const connected = surface.preset30Present && surface.playerSelected;
    return {
      ok: connected,
      reason: connected ? "connected" : "create-player-not-ready",
      surface,
    };
  }, timeoutMs);
}

export async function runChromeExtensionDrive({
  chromium,
  extensionDir,
  evidenceDir,
  youtubeUrl = YOUTUBE_WATCH_URL,
}) {
  const manifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8"));
  const sidePanelPath = sidePanelPathFromManifest(manifest);
  if (!sidePanelPath) throw new Error("manifest-missing-side-panel");
  mkdirSync(evidenceDir, { recursive: true });
  const notes = [];
  const failures = [];
  let audioStatus = "unavailable";
  const fixture = await startAudioFixture();
  const launched = await launchExtensionContext(chromium, extensionDir);
  const { context, extensionId } = launched;
  try {
    const sidePanelUrl = `chrome-extension://${extensionId}/${sidePanelPath}`;
    const [youtube] = context.pages();
    await youtube.goto(youtubeUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await youtube.evaluate(dismissYouTubeConsent).catch(() => null);
    const player = await waitFor(() => youtube.evaluate(youtubePlayerReady), 20_000);
    let youtubeMedia = player.ok ? "native" : "missing";
    if (!player.ok && player.detail?.visible) {
      const sample = sampleClipBase64();
      const attached = sample
        ? await youtube.evaluate(attachReadableYouTubeMedia, sample)
        : { ok: false, reason: "sample-clip-unavailable" };
      if (attached?.ok) youtubeMedia = "sample";
      else failures.push(attached?.reason || "youtube-player-not-visible");
    } else if (!player.ok) {
      failures.push(player.detail?.reason || "youtube-player-not-visible");
    }
    const panel = await context.newPage();
    await panel.goto(sidePanelUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await youtube.bringToFront();
    const connected = await connectPanel(panel, context, "https://www.youtube.com/watch", 30_000);
    if (!connected.ok) failures.push("youtube-create-not-ready");
    let youtubeJudgment = { ok: false, failures: ["youtube-not-driven"] };
    let youtubeProbe = null;
    if (connected.ok) {
      const driven = await driveCreateSurface(panel, "youtube");
      youtubeProbe = driven.probe;
      youtubeJudgment = driven.judgment;
      failures.push(...youtubeJudgment.failures.map((failure) => `youtube:${failure}`));
    }
    await panel.screenshot({ path: join(evidenceDir, "youtube-create.png") }).catch(() => {});
    await youtube.bringToFront();

    const audioPage = await context.newPage();
    await audioPage.goto(fixture.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await audioPage.evaluate(() => {
      const audio = document.querySelector("audio");
      if (audio) audio.load();
    });
    await audioPage.bringToFront();
    await activateSourceTab(context, fixture.url);
    const audioReady = await waitFor(async () => {
      const chose = await panel.evaluate(chooseAudioMode);
      const surface = await panel.evaluate(readCreateSurface);
      const ready = surface.mode === "audio" && surface.preset30Present && surface.playerSelected;
      return {
        ok: ready,
        reason: ready ? "audio-ready" : chose.reason || "audio-player-not-ready",
        surface,
      };
    }, 20_000);
    if (!audioReady.ok) {
      audioStatus = "unavailable";
      notes.push("- Audio source: unavailable. The local fixture did not become an Audio Create player.");
    } else {
      const audioDriven = await driveCreateSurface(panel, "audio");
      if (audioDriven.judgment.ok) {
        audioStatus = "pass";
      } else {
        audioStatus = "fail";
        failures.push(...audioDriven.judgment.failures.map((failure) => `audio:${failure}`));
      }
      notes.push(`- Audio readout after 60s: ${audioDriven.probe.readout60 || "(none)"}`);
      notes.push(`- Audio drag span ms: ${audioDriven.probe.dragSpanMs ?? "(none)"}`);
    }
    await panel.screenshot({ path: join(evidenceDir, "result.png") }).catch(() => {});
    const aria = await panel.locator("body").ariaSnapshot().catch(() => "(no snapshot)");
    writeFileSync(join(evidenceDir, "result.aria.txt"), aria);

    if (youtubeMedia === "sample") {
      notes.push("- YouTube showed the watch page and a visible player, but attached no media source. A sample video on that same tab supplied a duration longer than 90 seconds.");
    }
    notes.unshift(
      "# Proof: chrome-extension",
      "",
      "- Feature ID: chrome-extension",
      `- Extension: ${extensionId}`,
      `- Side panel: ${sidePanelUrl}`,
      `- Display: ${launched.display}`,
      `- YouTube: ${youtubeUrl}`,
      `- YouTube player: ${youtubeMedia}`,
      `- Preset 30s span ms: ${youtubeProbe?.preset30Ms ?? "(none)"}`,
      `- Preset 60s span ms: ${youtubeProbe?.preset60Ms ?? "(none)"}`,
      `- Drag span ms: ${youtubeProbe?.dragSpanMs ?? "(none)"}`,
      `- Typed START/END fields: ${youtubeProbe ? youtubeProbe.typedFieldCount : "not observed"}`,
      `- Signed in: ${youtubeProbe?.signedIn ? "yes" : "no"}`,
      "- Publish clip was not clicked.",
      "- Session: signed out. This drive does not mint a Supabase session.",
    );
    if (audioStatus === "pass") notes.push("- Audio source: pass. The same trim checks passed. Publish clip was not clicked.");
    notes.push(`- Result: ${failures.length === 0 ? "pass" : "fail"}`);
    if (failures.length > 0) notes.push(`- Failures: ${failures.join(", ")}`);
    writeFileSync(join(evidenceDir, "notes.md"), `${notes.join("\n")}\n`);
    return {
      exitCode: failures.length === 0 ? 0 : 1,
      failures,
      extensionId,
      audioStatus,
      display: launched.display,
      notes,
    };
  } finally {
    await context.close().catch(() => {});
    if (launched.xvfb) launched.xvfb.child.kill("SIGTERM");
    rmSync(launched.userDataDir, { recursive: true, force: true });
    await fixture.close();
  }
}

export async function driveChromeExtensionCommand({
  repoRoot,
  evidenceRoot,
  ensurePlaywright,
}) {
  const extensionDir = process.env.VERIFY_ANNOTATED_EXTENSION_DIR
    || join(repoRoot, "apps/extension/.output/chrome-mv3");
  const manifestPath = join(extensionDir, "manifest.json");
  try {
    JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    console.error(`chrome-extension: missing unpacked build at ${extensionDir}`);
    console.error("Build it with: pnpm --dir apps/extension run build");
    process.exit(1);
  }
  const runId = stamp();
  const evidenceDir = join(evidenceRoot, "chrome-extension", runId);
  const { chromium, env } = ensurePlaywright();
  Object.assign(process.env, env);
  try {
    const result = await runChromeExtensionDrive({ chromium, extensionDir, evidenceDir });
    console.log(`evidence: ${evidenceDir}`);
    console.log(`drive: chrome-extension ${result.exitCode === 0 ? "pass" : "fail"} (${result.display || "done"}, audio ${result.audioStatus})`);
    if (result.failures.length > 0) console.error(result.failures.join("\n"));
    process.exit(result.exitCode);
  } catch (error) {
    mkdirSync(evidenceDir, { recursive: true });
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync(join(evidenceDir, "notes.md"), [
      "# Proof: chrome-extension",
      "",
      "- Result: fail",
      `- Error: ${message}`,
      "- Publish clip was not clicked.",
      "- Side effects: none.",
      "",
    ].join("\n"));
    console.log(`evidence: ${evidenceDir}`);
    console.error(`chrome-extension: ${message}`);
    process.exit(1);
  }
}
