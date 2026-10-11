/* Render the actual built Nitro app with local audio and explicit unavailable probes.
 * These unsigned observations are not provider, device, auth or publication evidence. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// A caller may choose the parent, but every run gets a new private directory.
// Atomic mkdtemp creation prevents predictable temporary-path substitution.
const OUTPUT_PARENT = process.env.NEXUS_QA_OUT ? resolve(process.env.NEXUS_QA_OUT) : tmpdir();
mkdirSync(OUTPUT_PARENT, { recursive: true, mode: 0o700 });
assert.ok(lstatSync(OUTPUT_PARENT).isDirectory(), "observation parent must be a directory");
const OUT = mkdtempSync(join(OUTPUT_PARENT, "nexus-native-observations-"));
const QUICK = process.argv.includes("--quick");
const widths = QUICK ? [320, 1440] : [320, 390, 768, 1024, 1440, 2560];
const checks = [],
  measurements = [],
  errors = [],
  denied = [],
  writes = [];
const expectedAssetPaths = [
  "/assets/szl/PROJECTION.json",
  "/assets/szl/SOURCE.json",
  "/assets/szl/szl-icon-16.svg",
  "/assets/szl/szl-icon-32.svg",
  "/assets/szl/szl-tokens.css",
];
let browser, server;
const check = (name, ok, detail) =>
  checks.push({ name, pass: Boolean(ok), ...(ok ? {} : { detail }) });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 });
  assert.equal(r.status, 0, "Git source observation failed");
  return r.stdout.trim();
}
const revision = git(["rev-parse", "HEAD"]);
const dirty = Boolean(git(["status", "--porcelain", "--untracked-files=all"]));
const localSource = dirty ? "0".repeat(40) : revision;
writeFileSync(join(OUT, "SOURCE_GITHUB_SHA.fixture"), localSource, { flag: "wx", mode: 0o600 });

async function port() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const value = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return value;
}

async function measure(page, name) {
  const result = await page.evaluate(() => {
    const visible = (el) => {
      if (!el.getClientRects().length) return false;
      for (let at = el; at instanceof Element; at = at.parentElement) {
        const s = getComputedStyle(at);
        if (s.display === "none" || s.visibility !== "visible" || Number(s.opacity) === 0)
          return false;
      }
      return true;
    };
    const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const color = (value) => {
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = value;
      paint.fillRect(0, 0, 1, 1);
      const x = paint.getImageData(0, 0, 1, 1).data;
      return [x[0], x[1], x[2], x[3] / 255];
    };
    const blend = (a, b) =>
      a
        .slice(0, 3)
        .map((v, i) => v * a[3] + b[i] * (1 - a[3]))
        .concat(1);
    const lum = (c) =>
      c
        .slice(0, 3)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const layers = (value) => {
      const out = [];
      let depth = 0,
        start = 0;
      for (let i = 0; i < value.length; i++) {
        if (value[i] === "(") depth++;
        if (value[i] === ")") depth--;
        if (value[i] === "," && depth === 0) {
          out.push(value.slice(start, i));
          start = i + 1;
        }
      }
      out.push(value.slice(start));
      return out;
    };
    const cache = new Map();
    const backgrounds = (el) => {
      if (!el) return [[255, 255, 255, 1]];
      if (cache.has(el)) return cache.get(el);
      const s = getComputedStyle(el);
      let colors = backgrounds(el.parentElement).map((bg) => blend(color(s.backgroundColor), bg));
      for (const layer of layers(s.backgroundImage).reverse()) {
        if (!layer.includes("gradient(")) continue;
        const stops = [...layer.matchAll(/rgba?\([^()]*\)|color\([^()]*\)|#[\da-f]{3,8}\b/gi)].map(
          (m) => color(m[0]),
        );
        if (stops.length) colors = colors.flatMap((bg) => stops.map((stop) => blend(stop, bg)));
        colors = [...new Map(colors.map((c) => [c.map(Math.round).join(), c])).values()].slice(
          0,
          64,
        );
      }
      cache.set(el, colors);
      return colors;
    };
    const badText = [],
      badTargets = [],
      unnamed = [];
    let textPairs = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode,
        el = node.parentElement;
      const text = node.textContent.trim();
      if (
        !text ||
        !el ||
        !(el instanceof HTMLElement) ||
        !visible(el) ||
        el.closest("script,style,option,[disabled],[aria-hidden='true']")
      )
        continue;
      const s = getComputedStyle(el),
        fg = color(s.color);
      const minimum =
        parseFloat(s.fontSize) >= 24 ||
        (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700)
          ? 3
          : 4.5;
      const actual = Math.min(...backgrounds(el).map((bg) => ratio(blend(fg, bg), bg)));
      textPairs++;
      if (actual + 0.01 < minimum)
        badText.push({
          text: text.slice(0, 100),
          ratio: Number(actual.toFixed(3)),
          minimum,
          element: el.className,
        });
    }
    for (const el of document.querySelectorAll(
      "button,select,input[type='range'],summary,[role='slider']",
    )) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 43.9 || rect.height < 43.9)
        badTargets.push({
          tag: el.tagName,
          label: (el.getAttribute("aria-label") || el.textContent).trim().slice(0, 60),
          width: rect.width,
          height: rect.height,
        });
      if (
        el.tagName !== "INPUT" &&
        !el.textContent.trim() &&
        !el.getAttribute("aria-label") &&
        !el.getAttribute("aria-labelledby")
      )
        unnamed.push(el.outerHTML.slice(0, 180));
    }
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      textPairs,
      badText,
      badTargets,
      unnamed,
      theme: document.documentElement.dataset.surface,
    };
  });
  measurements.push({ name, ...result });
  check(`${name}: no document overflow`, !result.overflow, result);
  check(
    `${name}: visible text contrast`,
    result.textPairs > 15 && !result.badText.length,
    result.badText,
  );
  check(`${name}: 44px controls`, !result.badTargets.length, result.badTargets);
  check(`${name}: controls named`, !result.unnamed.length, result.unnamed);
}

async function contextFor(origin, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) {
      denied.push({ url: url.origin + url.pathname, method: request.method() });
      return route.abort();
    }
    if (request.method() !== "GET") {
      writes.push({ path: url.pathname, method: request.method() });
      return route.abort();
    }
    if (url.pathname === "/api/probes")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          ["hatun", "anatomy", "nexus-space"].map((id) => ({
            id,
            label: id,
            status: "UNAVAILABLE",
            detail: "Local rendered fixture; no provider probe",
            at: 0,
          })),
        ),
      });
    return route.continue();
  });
  await context.addInitScript(() => {
    window.__nexusQA = { audio: 0, midi: 0 };
    if (window.AudioContext) {
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        constructor(...args) {
          super(...args);
          window.__nexusQA.audio++;
        }
      };
    }
    navigator.requestMIDIAccess = async () => {
      window.__nexusQA.midi++;
      throw new DOMException("Local fixture denies hardware access", "NotAllowedError");
    };
  });
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  return context;
}

async function settle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function selectModule(page, width, name) {
  if (width < 1024)
    await page
      .getByRole("navigation", { name: "Instrument modules" })
      .getByRole("button", { name, exact: true })
      .click();
}
const region = (page, name) =>
  page.getByRole("region", { name, exact: true }).filter({ visible: true });

async function interactions(page, width) {
  check(
    "all eight scene presets are visibly contained",
    await page.getByRole("group", { name: "Instrument scenes" }).evaluate((group) => {
      const bounds = group.getBoundingClientRect();
      const buttons = [...group.querySelectorAll("button")];
      return (
        buttons.length === 8 &&
        buttons.every((button) => {
          const box = button.getBoundingClientRect();
          return (
            box.left >= bounds.left - 1 &&
            box.right <= bounds.right + 1 &&
            box.top >= bounds.top - 1 &&
            box.bottom <= bounds.bottom + 1
          );
        })
      );
    }),
  );
  await selectModule(page, width, "Patch");
  const patch = region(page, "Patchbay");
  const before = await patch.locator("summary").innerText();
  const sources = await patch
    .locator("[data-port-group='src'] button")
    .evaluateAll((es) => es.map((e) => e.getAttribute("aria-label").replace(/ source$/, "")));
  const dests = await patch
    .locator("[data-port-group='dst'] button")
    .evaluateAll((es) => es.map((e) => e.getAttribute("aria-label").replace(/ destination$/, "")));
  const current = await patch
    .locator(".nx-patch-list button")
    .evaluateAll((es) => es.map((e) => e.getAttribute("aria-label")));
  const pair = sources
    .flatMap((s) => dests.map((d) => [s, d]))
    .find(([s, d]) => !current.includes(`Remove ${s} to ${d} connection`));
  assert.ok(pair);
  await patch.getByRole("button", { name: `${pair[0]} source`, exact: true }).click();
  check(
    "mouse patch source remains selected",
    (await patch.getByRole("status").innerText()).includes("selected"),
  );
  await patch.getByRole("button", { name: `${pair[1]} destination`, exact: true }).click();
  await patch.locator("summary").click();
  const remove = patch.getByRole("button", {
    name: `Remove ${pair[0]} to ${pair[1]} connection`,
    exact: true,
  });
  check("mouse destination adds actual connection", (await remove.count()) === 1);
  await remove.click();
  check(
    "native removal restores actual patch count",
    (await patch.locator("summary").innerText()) === before,
  );
  await patch.getByRole("button", { name: `${pair[0]} source`, exact: true }).focus();
  await page.keyboard.press("Space");
  await patch.getByRole("button", { name: `${pair[1]} destination`, exact: true }).focus();
  await page.keyboard.press("Space");
  check("keyboard destination adds actual connection", (await remove.count()) === 1);
  await remove.click();

  await selectModule(page, width, "Grid");
  const grid = region(page, "The Grid");
  await grid.locator("summary").focus();
  await page.keyboard.press("Space");
  check(
    "keyboard opens grid editor disclosure",
    await grid.locator("details").evaluate((el) => el.open),
  );
  await grid.getByLabel("Column", { exact: true }).selectOption({ value: "4" });
  await grid.getByLabel("Row", { exact: true }).selectOption({ value: "2" });
  assert.equal(await grid.getByLabel("Column", { exact: true }).inputValue(), "4");
  assert.equal(await grid.getByLabel("Row", { exact: true }).inputValue(), "2");
  const cell = grid.getByRole("button", { name: "Toggle grid cell column 5, row 3", exact: true });
  assert.equal(
    await cell.count(),
    1,
    "Grid editor button labels: " +
      JSON.stringify(
        await grid
          .locator("button")
          .evaluateAll((es) => es.map((el) => el.getAttribute("aria-label"))),
      ),
  );
  const old = await cell.getAttribute("aria-pressed");
  await cell.focus();
  await page.keyboard.press("Space");
  check("keyboard grid toggles actual cell", (await cell.getAttribute("aria-pressed")) !== old);
  await page.keyboard.press("Space");
  check("keyboard grid restores actual cell", (await cell.getAttribute("aria-pressed")) === old);

  await selectModule(page, width, "Voice");
  const voice = region(page, "Voice");
  const key = voice.getByRole("button", { name: "MIDI note 48, keyboard Z", exact: true });
  await key.focus();
  await page.keyboard.down("Space");
  check(
    "focused piano key starts its actual note",
    (await key.getAttribute("aria-pressed")) === "true",
  );
  await page.keyboard.up("Space");
  check(
    "focused piano key releases its actual note",
    (await key.getAttribute("aria-pressed")) === "false",
  );
  const uni = voice.getByRole("slider", { name: "Uni", exact: true });
  await uni.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  check(
    "stepped knob follows its nonzero-origin increment",
    (await uni.getAttribute("aria-valuenow")) === "3",
  );
  await page.keyboard.press("End");
  check("knob End reaches upper bound", (await uni.getAttribute("aria-valuenow")) === "5");

  const help = page
    .locator(".nx-workspace > header")
    .getByRole("button", { name: "Key", exact: true })
    .filter({ visible: true });
  await help.focus();
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog", { name: "Key map" });
  await dialog.waitFor();
  check("Space opens help without transport shortcut", await dialog.isVisible());
  check(
    "opening help leaves stopped transport unchanged",
    (await page
      .locator(".nx-workspace > header")
      .getByRole("button", { name: "Run", exact: true })
      .count()) === 1,
  );
  await page.keyboard.press("Tab");
  check(
    "modal contains keyboard focus",
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  );
  await page.keyboard.press("Shift+Tab");
  check(
    "modal contains reverse keyboard focus",
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  );
  await page.keyboard.press("Escape");
  check(
    "help restores invoking control focus",
    await help.evaluate((el) => document.activeElement === el),
  );
  const master = page.getByRole("slider", { name: "Master", exact: true });
  await page
    .locator(".nx-workspace > header")
    .getByRole("button", { name: "Run", exact: true })
    .click();
  await page
    .locator(".nx-workspace > header")
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor();
  await master.focus();
  await page.keyboard.press("Escape");
  check(
    "Escape stops while a range is focused",
    (await page
      .locator(".nx-workspace > header")
      .getByRole("button", { name: "Run", exact: true })
      .count()) === 1,
  );
  check(
    "audio engagement did not request MIDI",
    (await page.evaluate(() => window.__nexusQA.midi)) === 0,
  );
  await page.getByRole("button", { name: "Connect MIDI", exact: true }).click();
  await page
    .getByText("MIDI access unavailable. The on-screen instrument remains usable.", { exact: true })
    .waitFor();
  check(
    "MIDI requests only after explicit control",
    (await page.evaluate(() => window.__nexusQA.midi)) === 1,
  );
  await page.getByRole("button", { name: "Disconnect MIDI", exact: true }).click();
}

(async () => {
  const { verifyAssets } = await import(pathToFileURL(join(ROOT, "scripts/native-assets.mjs")));
  const assets = verifyAssets(join(ROOT, ".output/public"));
  assert.deepEqual(assets.files.map((x) => x.path).sort(), expectedAssetPaths);
  const serverPort = await port(),
    origin = `http://127.0.0.1:${serverPort}`;
  const env = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  Object.assign(env, {
    HOST: "127.0.0.1",
    PORT: String(serverPort),
    NODE_ENV: "production",
    SOURCE_GITHUB_SHA_FILE: join(OUT, "SOURCE_GITHUB_SHA.fixture"),
  });
  server = spawn(process.execPath, [join(ROOT, ".output/server/index.mjs")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  const append = (bytes) => {
    serverLog = (serverLog + bytes.toString()).slice(-128 * 1024);
  };
  server.stdout.on("data", append);
  server.stderr.on("data", append);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(origin + "/healthz", {
        redirect: "error",
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* The local server may still be starting. */
    }
    if (server.exitCode !== null) throw new Error("local Nitro process exited: " + serverLog);
    await wait(200);
  }
  assert.ok(ready, "local Nitro did not start");
  for (const path of expectedAssetPaths) {
    const response = await fetch(origin + path, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const expected = assets.files.find((x) => x.path === path);
    check(
      `built served bytes: ${path}`,
      response.status === 200 && bytes.length === expected.bytes && hash(bytes) === expected.sha256,
    );
  }
  const actual = await (
    await fetch(origin + "/api/build-info", { signal: AbortSignal.timeout(5000) })
  ).json();
  check(
    "actual local source binding",
    actual.source_revision === (dirty ? "UNAVAILABLE" : revision) && actual.source_bound === !dirty,
    actual,
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--mute-audio"],
  });
  for (const width of widths) {
    for (const theme of ["dark", "light"]) {
      console.log(`Rendering ${width}px ${theme} entry and workstation`);
      const context = await contextFor(origin, { viewport: { width, height: 1000 } });
      const page = await context.newPage();
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Open instrument", exact: true }).waitFor();
      if (theme === "light")
        await page.getByRole("button", { name: "Switch to light appearance" }).click();
      await settle(page);
      await measure(page, `entry ${width} ${theme}`);
      check(
        `entry ${width} ${theme}: no passive audio or MIDI`,
        await page.evaluate(() => window.__nexusQA.audio === 0 && window.__nexusQA.midi === 0),
      );
      check(
        `entry ${width} ${theme}: native geometry`,
        await page.locator(".nx-native-mark img").evaluate((el) => {
          const s = getComputedStyle(el),
            r = el.getBoundingClientRect();
          return r.width === 40 && r.height === 40 && s.filter === "none" && s.transform === "none";
        }),
      );
      if ([320, 1440].includes(width))
        await page.screenshot({ path: join(OUT, `entry-${width}-${theme}.png`), fullPage: true });
      await page.getByRole("button", { name: "Open instrument", exact: true }).focus();
      await page.keyboard.press("Space");
      await page.locator(".nx-workspace").waitFor();
      check(
        `workstation ${width} ${theme}: one audio engagement`,
        await page.evaluate(() => window.__nexusQA.audio === 1),
      );
      const modules = width < 1024 ? ["Grid", "Scope", "Tape", "Patch", "Seq", "Voice"] : ["all"];
      for (const name of modules) {
        if (name !== "all") await selectModule(page, width, name);
        await settle(page);
        await measure(page, `workstation ${width} ${theme} ${name}`);
      }
      if ([320, 1440].includes(width))
        await page.screenshot({
          path: join(OUT, `workstation-${width}-${theme}.png`),
          fullPage: true,
        });
      if (theme === "dark" && [320, 1440].includes(width)) await interactions(page, width);
      await context.close();
    }
  }

  const sourceContext = await contextFor(origin),
    sourcePage = await sourceContext.newPage();
  const baseInfo = { ...actual, source_revision: "a".repeat(40), source_bound: true };
  for (const [name, payload, expected, status = 200] of [
    ["valid declared fixture", baseInfo, true],
    ["source HTTP failure", baseInfo, false, 503],
    ["source malformed JSON", "{incomplete", false],
    ["zero source", { ...baseInfo, source_revision: "0".repeat(40) }, false],
    ["wrong owner", { ...baseInfo, source_repository: "untrusted/repository" }, false],
    [
      "hostile revision",
      { ...baseInfo, source_revision: '<img src=x onerror="window.__nexusPwn=1">' },
      false,
    ],
    ["oversized source", { ...baseInfo, extra: "x".repeat(65536) }, false],
  ]) {
    await sourcePage.route("**/api/build-info", (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
      }),
    );
    await sourcePage.goto(origin);
    await sourcePage.getByRole("button", { name: "Open instrument", exact: true }).waitFor();
    await sourcePage.getByText("Inspect declared build source", { exact: true }).click();
    if (expected) {
      await sourcePage.getByText("Declared GitHub revision", { exact: true }).waitFor();
      check(
        name,
        (await sourcePage.locator(".nx-source-revision").getAttribute("href")) ===
          "https://github.com/szl-holdings/nexus/commit/" + "a".repeat(40),
      );
    } else {
      await sourcePage.getByText(/Source declaration UNAVAILABLE/).waitFor();
      check(
        name,
        (await sourcePage.locator(".nx-source-revision").count()) === 0 &&
          (await sourcePage.evaluate(() => !window.__nexusPwn)),
      );
    }
    await sourcePage.unroute("**/api/build-info");
  }
  await sourceContext.close();
  const failedAudio = await contextFor(origin);
  await failedAudio.addInitScript(() => {
    window.AudioContext = class {
      constructor() {
        throw new Error("Local unsupported audio fixture");
      }
    };
  });
  const badPage = await failedAudio.newPage();
  await badPage.goto(origin);
  await badPage.getByRole("button", { name: "Open instrument", exact: true }).click();
  await badPage.getByRole("alert").waitFor();
  check(
    "unsupported audio has recoverable visible state",
    await badPage.getByRole("button", { name: "Open instrument", exact: true }).isEnabled(),
  );
  await failedAudio.close();

  for (const [name, options] of [
    ["no-js", { javaScriptEnabled: false }],
    ["forced", { forcedColors: "active" }],
    ["reduced", { reducedMotion: "reduce" }],
  ]) {
    const context = await contextFor(origin, options),
      page = await context.newPage();
    await page.goto(origin);
    if (name === "no-js")
      check(
        "no JavaScript leaves technical recovery",
        (await page.locator("body").innerText()).includes("needs JavaScript"),
      );
    else {
      await page.getByRole("button", { name: "Open instrument", exact: true }).waitFor();
      if (name === "forced")
        check(
          "forced colors keep native identity visible",
          await page.locator(".nx-native-mark img").isVisible(),
        );
      if (name === "reduced")
        check(
          "reduced motion removes decorative transitions",
          await page
            .locator(".nx-primary")
            .evaluate((el) => getComputedStyle(el).transitionDuration === "0s"),
        );
    }
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    await context.close();
  }
  const printContext = await contextFor(origin),
    printPage = await printContext.newPage();
  await printPage.goto(origin);
  await printPage.getByRole("button", { name: "Open instrument", exact: true }).waitFor();
  await printPage.emulateMedia({ media: "print" });
  await measure(printPage, "printed source/frontdoor");
  await printPage.screenshot({ path: join(OUT, "print.png"), fullPage: true });
  await printContext.close();
  check("no page errors", errors.length === 0, errors);
  check("no browser provider transport attempted", denied.length === 0, denied);
  check("no browser network mutation attempted", writes.length === 0, writes);
  writeFileSync(join(OUT, "server.log"), serverLog, { flag: "wx", mode: 0o600 });
})()
  .catch((error) => {
    check("harness completed", false, error.stack);
  })
  .finally(async () => {
    await browser?.close();
    server?.kill("SIGTERM");
    const report = {
      kind: "UNSIGNED_RENDERED_FIXTURE_OBSERVATION",
      revision,
      dirty,
      checks: checks.length,
      passed: checks.filter((x) => x.pass).length,
      failed: checks.filter((x) => !x.pass),
      measurements,
      errors,
      denied,
      writes,
      limits: [
        "Actual built local Nitro app and browser Web Audio; audio output muted for qualification, MIDI denial and all provider probes are explicit local fixtures.",
        "Contrast checks cover visible HTML text and the CSS gradient color envelope; canvas glyphs, device audio fidelity and complete assistive-technology certification are outside this observation.",
        "Remote and non-GET counters cover browser-context traffic; Nitro-process network sockets are not instrumented.",
        "No external database credentials or migrations, auth activation, central publisher, Hugging Face upload or live readiness qualification. The unchanged runtime can initialize an in-memory PGlite fallback.",
      ],
    };
    writeFileSync(join(OUT, "results.json"), JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify(
        { checks: report.checks, passed: report.passed, failed: report.failed, output: OUT },
        null,
        2,
      ),
    );
    process.exitCode = report.failed.length ? 1 : 0;
  });
