#!/usr/bin/env node
/**
 * Pulls the published CUSP LRN content bundle into public/content-lrn/.
 *
 * The bundle is the public output of the private `cusp-lrn-content` pipeline:
 * every item in it has already passed verification and owner approval, and the
 * publish step strips internal fields by an explicit whitelist. This script
 * only copies it. It never edits content, never reaches into the private repo,
 * and refuses a bundle that fails the checks below.
 *
 *   source:  https://raw.githubusercontent.com/<owner>/<repo>/<ref>/content/
 *   target:  public/content-lrn/
 *
 * Usage:
 *   node scripts/sync-lrn-content.mjs
 *   node scripts/sync-lrn-content.mjs --owner fouaddahmed99 --repo cusp-lrn-web --ref main
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "content-lrn");

const FORBIDDEN_KEYS = [
  "supportingQuote",
  "chunkId",
  "chunkText",
  "discoveredViaLead",
  "leadClaimIds",
  "leadDocId",
  "claimText",
  "provenance",
  "claims",
  "passages",
  "verificationRef",
  "solver",
  "attestation",
  "licenseEvidence",
];

const SUPPORTED_CONTRACT_VERSION = 1;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const owner = arg("owner", "fouaddahmed99");
const repo = arg("repo", "cusp-lrn-web");
const ref = arg("ref", "main");
const base = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/content`;

function collectKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

function assertClean(rel, value) {
  const keys = collectKeys(value);
  const leaked = FORBIDDEN_KEYS.filter((k) => keys.has(k));
  if (leaked.length) {
    throw new Error(`${rel} carries internal-only field(s) ${leaked.join(", ")}. Refusing to vendor it.`);
  }
}

async function getJson(rel) {
  const res = await fetch(`${base}/${rel}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${base}/${rel} failed with HTTP ${res.status}`);
  const value = await res.json();
  assertClean(rel, value);
  return value;
}

async function put(rel, value) {
  const dest = path.join(outDir, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  process.stdout.write(`syncing approved content from ${base}\n`);
  const manifest = await getJson("manifest.json");
  if (!manifest) {
    throw new Error(
      `No manifest.json at ${base}. Has the content pipeline published a bundle to ${owner}/${repo} yet?`,
    );
  }
  if (manifest.contractVersion !== SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `Bundle uses public contract version ${manifest.contractVersion}; this build reads ` +
        `version ${SUPPORTED_CONTRACT_VERSION}. Update src/contract/lrn-public-v1.ts first.`,
    );
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await put("manifest.json", manifest);

  const sources = await getJson("sources.json");
  if (sources) await put("sources.json", sources);

  let items = 0;
  let playable = 0;
  for (const stubFile of manifest.stubFiles ?? []) {
    const stubs = await getJson(stubFile);
    if (!stubs) continue;
    await put(stubFile, stubs);
    for (const stub of stubs) {
      items += 1;
      // Only MCQ-like items can sit on a tile; skip fetching the rest.
      if (!["mcq", "vignette_mcq", "image_mcq"].includes(stub.type)) continue;
      const question = await getJson(`q/${stub.id}.json`);
      const answer = await getJson(`a/${stub.id}.json`);
      if (!question || !answer) {
        process.stderr.write(`  ! ${stub.id}: question or answer file missing, skipped\n`);
        continue;
      }
      if (question.version !== answer.version) {
        process.stderr.write(
          `  ! ${stub.id}: question v${question.version} / answer v${answer.version} mismatch, skipped\n`,
        );
        continue;
      }
      await put(`q/${stub.id}.json`, question);
      await put(`a/${stub.id}.json`, answer);
      playable += 1;
    }
  }

  process.stdout.write(
    `vendored content version ${manifest.contentVersion}: ${playable} playable of ${items} published item(s)\n`,
  );
  if (playable === 0) {
    process.stdout.write(
      "no playable items yet — Showdown will fall back to the labelled demo pack\n",
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
