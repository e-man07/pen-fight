// Verifies lib/sim.ts is bit-identical to the Rust sim. Vectors come from:
//   cd anchor && cargo test -p pen-fight --lib print_vectors -- --nocapture
import { readFileSync } from "node:fs";
import { applyFlick, runToRest, spawn } from "../lib/sim";

const vectors = JSON.parse(
  readFileSync(new URL("../../anchor/tests/vectors.json", import.meta.url), "utf8"),
);

let failed = 0;
for (const v of vectors) {
  const pens = spawn(BigInt(v.seed), v.n);
  const ticks: number[] = [];
  for (const f of v.flicks) {
    if (pens[f.who].out) {
      ticks.push(0);
      continue;
    }
    applyFlick(pens[f.who], f.angle, f.power);
    ticks.push(runToRest(pens));
  }
  const ok =
    JSON.stringify(ticks) === JSON.stringify(v.ticks) &&
    JSON.stringify(pens) === JSON.stringify(v.pens);
  if (!ok) {
    failed++;
    console.error("MISMATCH", JSON.stringify(v), { ticks, pens });
  } else {
    console.log("ok", `n=${v.n}`, v.seed, `flicks=${v.flicks.length}`);
  }
}
if (failed) process.exit(1);
console.log(`all ${vectors.length} vectors match the Rust sim`);
