import { resolve } from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";

// Photos of real boards are switched off unless asked for, while they're still being trained for.
// These tests check the corner marking flow with scripted replies, so they don't depend on the model.

const IMAGE = resolve(import.meta.dirname, "fixtures", "no-board.png");
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

function failure(code: string, message: string) {
  return { contract_version: "1.0", status: "error", code, message, retryable: true, board_candidates: [] };
}

function photoReading() {
  const squares = [];
  for (const file of "abcdefgh") {
    for (const rank of "12345678") {
      const back = { 1: "RNBQKBNR", 8: "rnbqkbnr" }[rank as "1" | "8"];
      const label = back ? back["abcdefgh".indexOf(file)]! : rank === "2" ? "P" : rank === "7" ? "p" : "empty";
      squares.push({ square: `${file}${rank}`, label, confidence: 0.9, alternatives: [], needs_review: false, review_reasons: [] });
    }
  }
  return {
    contract_version: "1.0",
    status: "ok",
    source_kind: "photo",
    board: {
      corners: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 },
      ],
      confidence: 1,
    },
    orientation: { quarter_turns_cw: 0, confidence: 0.99, method: "piece_layout", needs_review: false },
    placement: START,
    squares,
    issues: [],
    rectified_preview: null,
    engine: { name: "photo", version: "test" },
    timings_ms: {},
  };
}

/** Replies like the service: no board as a screenshot, and a reading once corners are sent. */
async function scriptService(page: Page): Promise<Request[]> {
  const requests: Request[] = [];
  await page.route("**/api/v1/recognize**", (route) => {
    requests.push(route.request());
    const tapped = new URL(route.request().url()).searchParams.has("corners");
    return route.fulfill(
      tapped
        ? { json: photoReading() }
        : { status: 422, json: failure("no_board_detected", "No flat chessboard was found.") },
    );
  });
  return requests;
}

async function openCornerStep(page: Page) {
  await page.getByLabel("Image file").setInputFiles(IMAGE);
  await page.getByRole("button", { name: "Mark the corners of a real board" }).click();
  await expect(page.getByRole("heading", { name: "Mark the board's corners" })).toBeVisible();
}

test("without photos switched on, no corner marking is offered", async ({ page }) => {
  await scriptService(page);
  await page.goto("/");
  await expect(page.getByText("Photos of real boards aren't supported yet.")).toBeVisible();
  await page.getByLabel("Image file").setInputFiles(IMAGE);
  await expect(page.getByRole("alert")).toHaveText("No flat chessboard was found.");
  await expect(page.getByRole("button", { name: "Mark the corners of a real board" })).toHaveCount(0);
});

test.describe("with photos switched on", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?photos=1");
  });

  test("a photo with marked corners is read and goes to the position check", async ({ page }) => {
    const requests = await scriptService(page);
    await openCornerStep(page);

    // Drag the first corner to near the top left of the image.
    const surface = page.locator(".corners__surface");
    const box = (await surface.boundingBox())!;
    const marker = page.getByRole("button", { name: "Corner 1" });
    const from = (await marker.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.05, { steps: 5 });
    await page.mouse.up();

    const bottom = page.getByRole("button", { name: "White sits at the bottom edge" });
    await bottom.click();
    await expect(bottom).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Read board" }).click();
    await expect(page.getByRole("heading", { name: "Check the position" })).toBeVisible();

    const query = new URL(requests.at(-1)!.url()).searchParams;
    const sent = query.get("corners")!.split(",").map(Number);
    expect(sent).toHaveLength(8);
    expect(sent[0]).toBeCloseTo(0.05, 1);
    expect(sent[1]).toBeCloseTo(0.05, 1);
    expect(sent[4]).toBeCloseTo(0.85, 2);
    // The middle of the bottom edge, between the untouched corners 3 and 4.
    const white = query.get("white")!.split(",").map(Number);
    expect(white[0]).toBeCloseTo(0.5, 2);
    expect(white[1]).toBeCloseTo(0.85, 2);
  });

  test("White's side must be chosen, or the user says they aren't sure", async ({ page }) => {
    const requests = await scriptService(page);
    await openCornerStep(page);
    const sentBefore = requests.length;
    await page.getByRole("button", { name: "Read board" }).click();
    await expect(page.getByRole("alert")).toContainText("Tap White on the edge of the board White sits behind");
    expect(requests.length).toBe(sentBefore);

    await page.getByRole("button", { name: "Not sure which side" }).click();
    await page.getByRole("button", { name: "Read board" }).click();
    await expect(page.getByRole("heading", { name: "Check the position" })).toBeVisible();
    const query = new URL(requests.at(-1)!.url()).searchParams;
    expect(query.has("corners")).toBe(true);
    expect(query.has("white")).toBe(false);
  });

  test("tapping White on an edge doesn't move a corner", async ({ page }) => {
    await scriptService(page);
    await openCornerStep(page);
    const markers = page.locator(".corners__marker");
    const before = await markers.evaluateAll((all) => all.map((m) => (m as HTMLElement).style.cssText));
    await page.getByRole("button", { name: "White sits at the left edge" }).click();
    const after = await markers.evaluateAll((all) => all.map((m) => (m as HTMLElement).style.cssText));
    expect(after).toEqual(before);
  });

  test("corners are offered when a photo's board looks incomplete", async ({ page }) => {
    await page.route("**/api/v1/recognize**", (route) =>
      route.fulfill({ status: 422, json: failure("board_incomplete", "Part of the board is cut off.") }),
    );
    await openCornerStep(page);
  });

  test("a marker can be moved with the keyboard", async ({ page }) => {
    await scriptService(page);
    await openCornerStep(page);
    const marker = page.getByRole("button", { name: "Corner 3" });
    const before = await marker.evaluate((element) => (element as HTMLElement).style.left);
    await marker.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => marker.evaluate((element) => (element as HTMLElement).style.left)).not.toBe(before);
  });

  test("corners that can't be a board are explained before anything is sent", async ({ page }) => {
    const requests = await scriptService(page);
    await openCornerStep(page);
    for (const name of ["Corner 1", "Corner 2", "Corner 3", "Corner 4"]) {
      await page.getByRole("button", { name }).focus();
      // Pull every corner into the middle, far too close together.
      for (let i = 0; i < 18; i++) await page.keyboard.press(name === "Corner 1" || name === "Corner 4" ? "Shift+ArrowRight" : "Shift+ArrowLeft");
    }
    const sentBefore = requests.length;
    await page.getByRole("button", { name: "Read board" }).click();
    await expect(page.getByRole("alert")).toContainText("Spread them over the board");
    expect(requests.length).toBe(sentBefore);
  });

  test("cancelling goes back to choosing an image", async ({ page }) => {
    await scriptService(page);
    await openCornerStep(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Upload image" })).toBeVisible();
  });
});
