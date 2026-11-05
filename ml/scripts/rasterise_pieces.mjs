// Rasterises each piece set's SVGs to PNGs. Usage: node rasterise_pieces.mjs <input> <output>
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(resolve(import.meta.dirname, "../../apps/web/package.json"));
const sharp = require("sharp");

const SIZE = 256;
const [input, output] = process.argv.slice(2);
let count = 0;
const failures = [];

for (const set of readdirSync(input)) {
  mkdirSync(join(output, set), { recursive: true });
  for (const file of readdirSync(join(input, set))) {
    const target = join(output, set, file.replace(".svg", ".png"));
    let error = null;
    // SVGs declare very different sizes, so the highest density that fits within limits is used.
    for (const density of [400, 150, 72, 24]) {
      try {
        const png = await sharp(join(input, set, file), { density })
          .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        writeFileSync(target, png);
        count += 1;
        error = null;
        break;
      } catch (caught) {
        error = caught;
      }
    }
    if (error) failures.push(`${set}/${file}: ${error.message}`);
  }
}

console.log(`Rasterised ${count} pieces`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
