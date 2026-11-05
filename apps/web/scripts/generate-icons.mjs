// Renders the PNG icons that installing the app requires, from public/icons/icon.svg.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const iconsDir = resolve(import.meta.dirname, "..", "public", "icons");
const svg = readFileSync(resolve(iconsDir, "icon.svg"));

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(resolve(iconsDir, name));
}

// Maskable icons get cropped to a shape by the OS, so the artwork sits inside a safe zone.
const inner = await sharp(svg, { density: 300 }).resize(410, 410).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#163a2c" },
})
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(resolve(iconsDir, "icon-maskable-512.png"));

console.log("Icons written.");
