#!/usr/bin/env node
// Browser acceptance for the Python-served Space: load the workstation, open the
// instrument with a real click (the user gesture), and require a running
// AudioContext with no console errors. Needs Playwright with Chromium installed;
// set CHROMIUM_PATH to use an already installed Chromium binary instead.
// Usage: node scripts/space-browser-smoke.mjs http://127.0.0.1:7860/
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2];
if (!base) {
  console.error("usage: node scripts/space-browser-smoke.mjs <base-url>");
  process.exit(2);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const errors = [];
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const contexts = [];
    window.__nexusAudioContexts = contexts;
    for (const name of ["AudioContext", "webkitAudioContext"]) {
      const Original = window[name];
      if (!Original) continue;
      window[name] = class extends Original {
        constructor(...args) {
          super(...args);
          contexts.push(this);
        }
      };
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });

  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForSelector(".nx-chassis", { timeout: 15000 });
  await page.getByRole("button", { name: "Open instrument" }).click();
  await page.waitForSelector(".nx-workspace", { timeout: 15000 });
  const audioStates = await page.evaluate(() => window.__nexusAudioContexts.map((context) => context.state));
  const alerts = await page.locator(".nx-notice[role=alert]").count();
  const result = { workstation: true, audioStates, alerts, errors };
  console.log(JSON.stringify(result));
  process.exitCode = errors.length === 0 && alerts === 0 && audioStates.includes("running") ? 0 : 1;
} catch (error) {
  console.error(`browser smoke failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
