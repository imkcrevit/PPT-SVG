// =============================================================================
// Offline snapshot test — exercises the compiler + renderer WITHOUT a model.
//
// For each calibrated fixture it:
//   1. validates the semantic graph (expects 0 errors),
//   2. confirms the fixture satisfies its matching regression assertions,
//   3. compiles it with layoutDiagram and renders SVG,
//   4. compares the SVG against a stored baseline in tests/__snapshots__/.
//      First run (or with UPDATE_SNAPSHOTS=1) writes the baseline instead.
//
// Run:  node --experimental-strip-types --experimental-loader ./tests/ts-path-loader.mjs tests/snapshot-test.ts
//       UPDATE_SNAPSHOTS=1 node --experimental-strip-types --experimental-loader ./tests/ts-path-loader.mjs tests/snapshot-test.ts
// =============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { layoutDiagram } from "@/lib/layout-engine";
import { renderFigureSvg } from "@/lib/svg";
import { validateAndNormalizeSemanticDiagram } from "@/lib/semantic-validation";
import { TESTS, type Produced } from "./diagram-regression";
import { FIXTURES } from "./fixtures";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = path.join(HERE, "__snapshots__");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

function main(): boolean {
  if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
  let allPass = true;

  for (const fixture of FIXTURES) {
    const failures: string[] = [];

    // 1. semantic validation
    const validation = validateAndNormalizeSemanticDiagram(
      fixture.response,
      fixture.response.diagram.type,
      fixture.response.diagram.language
    );
    const errors = validation.errors;
    if (errors.length) failures.push(`validation: ${errors.join("; ")}`);

    // 2. compile + 3. structural assertions (fixture must be a valid "ideal answer")
    let svg = "";
    if (errors.length === 0 && validation.diagram) {
      const figure = layoutDiagram(validation.diagram);
      const produced: Produced = { diagram: validation.diagram, figure };
      const test = TESTS.find((t) => t.id === fixture.id);
      if (test) failures.push(...test.assert(produced).map((f) => `assert: ${f}`));
      svg = renderFigureSvg(figure);
    }

    // 4. snapshot compare / write
    if (svg) {
      const file = path.join(SNAP_DIR, `${fixture.id}.svg`);
      if (UPDATE || !existsSync(file)) {
        writeFileSync(file, svg);
        console.log(`SNAP  ${fixture.id}  baseline written (${svg.length} bytes)`);
      } else {
        const baseline = readFileSync(file, "utf8");
        if (baseline !== svg) {
          failures.push(`snapshot mismatch vs ${path.relative(HERE, file)} — review the diff, then UPDATE_SNAPSHOTS=1 if intended`);
        }
      }
    }

    const ok = failures.length === 0;
    allPass = allPass && ok;
    console.log(`${ok ? "PASS" : "FAIL"}  ${fixture.id}  ${fixture.name}`);
    for (const f of failures) console.log(`        - ${f}`);
  }

  console.log(allPass ? "\nALL PASS ✅" : "\nSOME FAILED ❌");
  return allPass;
}

const ok = main();
if (!ok) process.exitCode = 1;
