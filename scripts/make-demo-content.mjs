#!/usr/bin/env node
/**
 * Generates the DEMO content pack into public/content-demo/.
 *
 * Why this exists: a 6x5 board needs 30 questions plus a final. The approved
 * CUSP LRN bank is the only source of real questions, and it is nowhere near
 * that size yet, so the game needs something to run on while the bank fills.
 *
 * What this generator may produce — and the rule it follows:
 *   The CUSP LRN project forbids writing clinical content anywhere, and requires
 *   demo data to be obviously fake and non-clinical so it can never be mistaken
 *   for reviewed content. So every item here is UI filler about buttons, dials
 *   and shapes, every string starts with "SAMPLE", and the manifest sets
 *   `sample: true`, which makes the app show a demo banner over the board.
 *
 *   There are no clinical facts in this file. There must never be any. If you
 *   want real questions on the board, publish them through the content
 *   pipeline and run `pnpm content:sync` instead.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "content-demo");

/** Category metadata mirrors the published taxonomy so the board looks real. */
const DOMAINS = [
  { id: "caries", name: "Caries dx, non-restorative and restorative", qeWeightPct: 23, oceWeightPct: 17 },
  { id: "shcn", name: "Special health care needs", qeWeightPct: 14, oceWeightPct: 8 },
  { id: "pulp", name: "Pulp therapy", qeWeightPct: 12, oceWeightPct: 8 },
  { id: "trauma-emergency", name: "Oral-facial injury, emergency care, oral surgery", qeWeightPct: 10, oceWeightPct: 16 },
  { id: "diagnosis", name: "Diagnosis, oral pathology, radiology, oral medicine", qeWeightPct: 10, oceWeightPct: 10 },
  { id: "prevention", name: "Prevention and health promotion", qeWeightPct: 10, oceWeightPct: 10 },
  { id: "growth", name: "Growth and development", qeWeightPct: 8, oceWeightPct: 8 },
  { id: "behavior", name: "Behavior guidance", qeWeightPct: 6, oceWeightPct: 14 },
  { id: "practice", name: "Elements of pediatric dental practice", qeWeightPct: 5, oceWeightPct: 5 },
  { id: "advocacy", name: "Advocacy and education", qeWeightPct: 2, oceWeightPct: 4 },
];

const LEVELS = ["remember", "understand_apply", "analyze_evaluate"];

/** Non-clinical filler subjects. Deliberately about the UI, not about patients. */
const SUBJECTS = [
  { thing: "demo dial", trait: "its needle points at the gold mark" },
  { thing: "test button", trait: "it is the one labelled B" },
  { thing: "sample tile", trait: "it sits in the third row" },
  { thing: "placeholder shape", trait: "it has four equal sides" },
  { thing: "mock slider", trait: "it starts at zero" },
  { thing: "fixture lamp", trait: "it glows blue when idle" },
  { thing: "demo switch", trait: "it clicks twice" },
  { thing: "sample card", trait: "its corner is folded" },
  { thing: "test meter", trait: "it reads in whole numbers" },
  { thing: "placeholder gauge", trait: "its dial runs anticlockwise" },
];

const SOURCE_ID = "src_cusp-showdown-demo-pack";
const BUILT_AT = "2026-01-01T00:00:00.000Z";

/**
 * Deterministic, collision-free id so regenerating the pack does not churn the
 * diff. The `demo_` prefix makes a demo item obvious wherever an id is shown.
 */
function demoId(domainId, level, n) {
  return `demo_${domainId.replace(/[^a-z0-9]+/gi, "-")}_${level}_${n + 1}`;
}

function cite() {
  return [{ sourceId: SOURCE_ID, page: null, section: "SAMPLE demo pack" }];
}

function makeItem(domain, level, n, ordinal) {
  const subject = SUBJECTS[ordinal % SUBJECTS.length];
  const id = demoId(domain.id, level, n);
  const keyIndex = (DOMAINS.indexOf(domain) + n + LEVELS.indexOf(level)) % 4;
  const keyLetter = ["A", "B", "C", "D"][keyIndex];

  const correctText =
    `SAMPLE correct choice — the ${subject.thing} on fixture ${ordinal + 1}, because ${subject.trait}`;
  const distractors = [
    `SAMPLE distractor — a different ${subject.thing} with no mark at all`,
    `SAMPLE distractor — the ${subject.thing} from the unused demo row`,
    `SAMPLE distractor — none of the demo widgets on this fixture board`,
  ];

  // Hand each non-key option its own distractor, so no two options repeat.
  let nextDistractor = 0;
  const options = ["A", "B", "C", "D"].map((letter) => ({
    id: letter,
    text: letter === keyLetter ? correctText : distractors[nextDistractor++],
  }));

  const levelPrefix = {
    remember: "SAMPLE recall:",
    understand_apply: "SAMPLE applied:",
    analyze_evaluate: "SAMPLE analysis:",
  }[level];

  const question = {
    id,
    version: 1,
    tags: {
      domainId: domain.id,
      subtopicId: `sample-${domain.id}-widgets`,
      taskStatementId: `ts-sample-${domain.id}`,
      cognitiveLevel: level,
    },
    lastVerifiedAt: BUILT_AT,
    type: "mcq",
    stem:
      `${levelPrefix} on demo fixture ${ordinal + 1}, which option describes the ` +
      `${subject.thing}? (Placeholder content for interface testing, not a clinical question.)`,
    options,
  };

  const rationales = {};
  for (const option of options) {
    rationales[option.id] = [
      {
        text:
          option.id === keyLetter
            ? `SAMPLE: this option matches the demo fixture, where ${subject.trait}.`
            : `SAMPLE: this option describes a widget that is not on the demo fixture.`,
        cites: cite(),
      },
    ];
  }

  const answer = {
    id,
    version: 1,
    type: "mcq",
    key: keyLetter,
    rationales,
    explanation: [
      {
        text: `SAMPLE explanation: the demo fixture defines the ${subject.thing} as the one where ${subject.trait}.`,
        cites: cite(),
      },
      {
        text: "SAMPLE: this pack exists so the board, timer, scoring and reveal can be played end to end. It carries no clinical content and no reviewed citations.",
        cites: cite(),
      },
    ],
  };

  const stub = {
    id,
    version: 1,
    type: "mcq",
    tags: question.tags,
    hasMedia: false,
  };

  return { question, answer, stub };
}

/** Three items per (domain, level) gives 9 per column — enough to replay. */
const PER_CELL = 3;

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "q"), { recursive: true });
  await mkdir(path.join(outDir, "a"), { recursive: true });
  await mkdir(path.join(outDir, "stubs"), { recursive: true });

  const stubsByDomain = new Map();
  let mcqCount = 0;
  let ordinal = 0;

  for (const domain of DOMAINS) {
    for (const level of LEVELS) {
      for (let n = 0; n < PER_CELL; n += 1) {
        const { question, answer, stub } = makeItem(domain, level, n, ordinal);
        ordinal += 1;
        await writeFile(path.join(outDir, "q", `${question.id}.json`), `${JSON.stringify(question, null, 2)}\n`);
        await writeFile(path.join(outDir, "a", `${answer.id}.json`), `${JSON.stringify(answer, null, 2)}\n`);
        stubsByDomain.set(domain.id, [...(stubsByDomain.get(domain.id) ?? []), stub]);
        mcqCount += 1;
      }
    }
  }

  for (const [domainId, stubs] of stubsByDomain) {
    await writeFile(path.join(outDir, "stubs", `${domainId}.json`), `${JSON.stringify(stubs, null, 2)}\n`);
  }

  await writeFile(
    path.join(outDir, "sources.json"),
    `${JSON.stringify(
      [
        {
          id: SOURCE_ID,
          title: "SAMPLE demonstration pack (not clinical content)",
          organization: "CUSP Showdown",
          year: 2026,
          versionLabel: "demo-1",
          url: "https://github.com/fouaddahmed99/cusp-showdown",
          licenseLabel: "Placeholder fixture content — carries no clinical authority",
          attribution: "Generated by scripts/make-demo-content.mjs for interface testing.",
        },
      ],
      null,
      2,
    )}\n`,
  );

  const manifest = {
    contractVersion: 1,
    contentVersion: `demo-${PER_CELL}x${DOMAINS.length * LEVELS.length}`,
    builtAt: BUILT_AT,
    sample: true,
    exam: {
      qe: { totalItems: 240, unscoredPretestItems: 40, durationMinutes: 240, miniMockSizes: [50, 100] },
      oce: { sessions: 2, sessionMinutes: 60, examinersPerSession: 2 },
    },
    domains: DOMAINS,
    subtopics: DOMAINS.map((d) => ({
      id: `sample-${d.id}-widgets`,
      domainId: d.id,
      name: `SAMPLE demo widgets (${d.id})`,
    })),
    taskStatements: DOMAINS.map((d) => ({
      id: `ts-sample-${d.id}`,
      domainId: d.id,
      text: `SAMPLE task statement placeholder for ${d.id}.`,
    })),
    counts: { mcq: mcqCount, vignette_mcq: 0, image_mcq: 0, flashcard: 0, note_section: 0, oce_vignette: 0 },
    stubFiles: [...stubsByDomain.keys()].map((id) => `stubs/${id}.json`),
    noteSubtopics: [],
    forms: [],
  };

  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  process.stdout.write(
    `demo pack written: ${mcqCount} SAMPLE items across ${DOMAINS.length} categories -> ${path.relative(root, outDir)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
