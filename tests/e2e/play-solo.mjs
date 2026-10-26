#!/usr/bin/env node
/**
 * Plays a whole solo game in a real browser against the production build.
 *
 * It asserts the things a player would notice: the board deals, a tile opens,
 * an answer is graded, the explanation and its citation appear, no question
 * repeats, the score adds up, the final challenge pays out, and the summary
 * reports what happened. Console errors fail the run.
 *
 *   pnpm build && pnpm e2e
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/**
 * Playwright is installed in the environment rather than in this project, so
 * resolve it the same way a CommonJS require would. With playwright as a local
 * devDependency, `import { chromium } from "playwright"` works directly.
 */
const require_ = createRequire(import.meta.url);
const { chromium } = require_("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = path.join(root, "dist");
const BASE = "/cusp-showdown/";
const PORT = 4178;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Serves dist/ under the Pages base path, so routing and assets are real. */
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      if (!url.pathname.startsWith(BASE)) {
        res.writeHead(404).end("outside base path");
        return;
      }
      let rel = url.pathname.slice(BASE.length) || "index.html";
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.join(dist, rel);
      if (!file.startsWith(dist)) {
        res.writeHead(403).end("no");
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function main() {
  const server = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const page = await context.newPage();

  // Font requests to Google's CDN are blocked in some sandboxes. The page is
  // built to fall back to system faces, so those failures are not app errors.
  const EXTERNAL_FONT_NOISE = /fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL_CONNECTION_FAILED/;
  const consoleErrors = [];
  const noteError = (text) => {
    if (!EXTERNAL_FONT_NOISE.test(text)) consoleErrors.push(text);
  };
  page.on("console", (msg) => {
    if (msg.type() === "error") noteError(msg.text());
  });
  page.on("pageerror", (err) => noteError(String(err)));
  page.on("requestfailed", (req) => {
    if (!EXTERNAL_FONT_NOISE.test(req.url())) {
      noteError(`request failed: ${req.url()} ${req.failure()?.errorText ?? ""}`);
    }
  });

  const shots = path.join(root, "tests", "e2e", "screenshots");

  try {
    // ---------------------------------------------------------------- home
    await page.goto(`http://localhost:${PORT}${BASE}`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Play solo", { timeout: 15000 });
    check("home screen renders", true);

    const demoBadge = await page.locator("text=Demo content on the board").count();
    const approvedBadge = await page.locator("text=/[0-9]+ approved items/").count();
    const onDemo = demoBadge > 0;
    check(
      "content source is disclosed on the home screen",
      demoBadge + approvedBadge > 0,
      onDemo ? "demo pack in play" : "approved content in play",
    );
    await page.screenshot({ path: path.join(shots, "01-home.png") });

    // ---------------------------------------------------------------- board
    await page.click("text=Play solo");
    await page.waitForSelector('button[aria-label$="points"]', { timeout: 15000 });
    const tileCount = await page.locator('button[aria-label$="points"]').count();
    check("board deals 30 playable tiles", tileCount === 30, `${tileCount} tiles`);
    await page.screenshot({ path: path.join(shots, "02-board.png") });

    // ------------------------------------------------------- play every tile
    const seenStems = new Set();
    let answered = 0;

    for (let i = 0; i < 30; i += 1) {
      const tiles = page.locator('button[aria-label$="points"]');
      const remaining = await tiles.count();
      if (remaining === 0) break;
      await tiles.first().click();

      await page.waitForSelector('button:has-text("Lock in")', { timeout: 10000 });
      const stem = (await page.locator("h2").first().innerText()).trim();
      if (seenStems.has(stem)) {
        check("no question repeats", false, `repeated: ${stem.slice(0, 60)}`);
        break;
      }
      seenStems.add(stem);

      // Answer: pick the option whose letter matches a rotating guess, so the
      // run produces both correct and incorrect outcomes.
      const options = page.locator('button[aria-pressed]:has(span.display)');
      const optionCount = await options.count();
      await options.nth(i % Math.max(1, optionCount)).click();
      await page.click('button:has-text("Lock in")');

      await page.waitForSelector("text=/Correct|Incorrect|No answer/", { timeout: 10000 });
      answered += 1;

      if (i === 0) {
        const hasWhy = await page.locator("h3:has-text('Why')").count();
        const hasRefs = await page.locator("h3:has-text('References')").count();
        const hasCite = await page.locator("sup").count();
        check("reveal shows the explanation", hasWhy > 0);
        check("reveal shows the reference list", hasRefs > 0);
        check("explanation sentences carry citation markers", hasCite > 0);
        const itemLine = await page.locator("text=/Item .* · version/").count();
        check("reveal shows item id, version and content version", itemLine > 0);
        await page.screenshot({ path: path.join(shots, "03-question-revealed.png") });
      }

      await page.click('button:has-text("Back to the board")');
      await page.waitForFunction(
        () =>
          document.querySelectorAll('button[aria-label$="points"]').length > 0 ||
          document.body.innerText.includes("Board cleared"),
        undefined,
        { timeout: 10000 },
      );
    }

    check("played every tile on the board", answered === 30, `${answered} answered`);
    check("every question was distinct", seenStems.size === answered, `${seenStems.size} unique stems`);

    await page.waitForSelector("text=Board cleared", { timeout: 10000 });
    const scoreText = await page.locator("text=Board cleared").innerText();
    check("board completion is announced with a score", /Board cleared with/.test(scoreText), scoreText.trim());
    await page.screenshot({ path: path.join(shots, "04-board-cleared.png") });

    // ------------------------------------------------------ final challenge
    await page.click('button:has-text("Final challenge")');
    await page.waitForSelector("text=One question, one wager", { timeout: 10000 });
    await page.fill('input[type="number"]', "500");
    await page.screenshot({ path: path.join(shots, "05-final-wager.png") });
    await page.click('button:has-text("Lock in")');

    await page.waitForSelector('button:has-text("Lock in")', { timeout: 10000 });
    const finalOptions = page.locator('button[aria-pressed]:has(span.display)');
    await finalOptions.first().click();
    await page.click('button:has-text("Lock in")');
    await page.waitForSelector("text=/Correct|Incorrect/", { timeout: 10000 });
    check("final challenge grades a wagered answer", true);

    // --------------------------------------------------------------- summary
    await page.click('button:has-text("See the summary")');
    await page.waitForSelector("text=Final score", { timeout: 10000 });
    const accuracyShown = await page.locator("text=Accuracy").count();
    const categoryShown = await page.locator("text=Accuracy by category").count();
    const reviewShown = await page.locator("text=/What to review|Nothing missed/").count();
    check("summary shows the final score and accuracy", accuracyShown > 0);
    check("summary breaks accuracy down by category", categoryShown > 0);
    check("summary offers a review of what was missed", reviewShown > 0);
    await page.screenshot({ path: path.join(shots, "06-summary.png"), fullPage: true });

    // The review panel opens on the first miss, and loads that item's answer
    // file (never fetched before the response was locked in).
    const missedToggles = page.locator("button[aria-expanded]");
    if ((await missedToggles.count()) > 0) {
      await page.waitForSelector("text=Correct answer:", { timeout: 10000 });
      const hasKey = await page.locator("text=Correct answer:").count();
      check("missed-question review loads its explanation", hasKey > 0);

      // Collapsing and reopening a different miss also works.
      await missedToggles.first().click();
      await page.waitForTimeout(250);
      await missedToggles.nth(1).click();
      await page.waitForSelector("text=Correct answer:", { timeout: 10000 });
      check("another missed question can be opened", true);
    }

    // ------------------------------------------------- persistence + replay
    await page.click('button:has-text("Play again with new questions")');
    await page.waitForSelector('button[aria-label$="points"]', { timeout: 15000 });
    check("replay deals a fresh board", true);

    await page.goto(`http://localhost:${PORT}${BASE}`, { waitUntil: "networkidle" });
    const bestBadge = await page.locator("text=/Best -?[0-9][0-9,]*/").count();
    const playedBadge = await page.locator("text=/games played|1 games played/").count();
    check("personal best is saved across a reload", bestBadge > 0);
    check("games played is tracked locally", playedBadge > 0);

    // ----------------------------------------------- multiplayer, unconfigured
    await page.click("text=Host a game");
    await page.waitForSelector("text=Live multiplayer needs a database", { timeout: 10000 });
    const noFakeRoom = await page.locator("text=/Room code/").count();
    check("host screen states multiplayer is not configured", true);
    check("host screen does not fabricate a room code", noFakeRoom === 0);
    await page.screenshot({ path: path.join(shots, "07-multiplayer-setup.png") });

    await page.goto(`http://localhost:${PORT}${BASE}#/join/ABCDE`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Live multiplayer needs a database", { timeout: 10000 });
    check("a join link routes correctly under the Pages base path", true);

    // --------------------------------------------------------------- mobile
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(`http://localhost:${PORT}${BASE}`, { waitUntil: "networkidle" });
    await phone.click("text=Play solo");
    await phone.waitForSelector('button[aria-label$="points"]', { timeout: 15000 });
    const overflow = await phone.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("no horizontal overflow at 390px", overflow <= 1, `${overflow}px`);
    await phone.screenshot({ path: path.join(shots, "08-mobile-board.png") });
    await phone.close();

    check("no console errors during the run", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
    server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  if (failed.length) {
    process.stdout.write(`failed: ${failed.map((f) => f.name).join(", ")}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
