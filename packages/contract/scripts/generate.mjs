// Generates src/generated.ts from the JSON Schema. With --check, fails if the file is out of date.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "json-schema-to-typescript";

const root = resolve(import.meta.dirname, "..");
const schemaPath = resolve(root, "schema", "recognition-response.schema.json");
const outputPath = resolve(root, "src", "generated.ts");

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const rendered = await compile(schema, "RecognitionResponse", {
  bannerComment:
    "/* Generated from schema/recognition-response.schema.json. Do not edit.\n" +
    "   Run `pnpm contract:generate` to update. */",
  additionalProperties: false,
});

if (process.argv.includes("--check")) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;
  if (current !== rendered) {
    console.error("Contract types are out of date. Run: pnpm contract:generate");
    process.exit(1);
  }
} else {
  writeFileSync(outputPath, rendered);
  console.log(`Wrote ${outputPath}`);
}
