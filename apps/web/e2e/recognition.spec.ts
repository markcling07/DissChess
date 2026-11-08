import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectedPieces, pieces, piecesSorted } from "./helpers";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const EXPECTED = JSON.parse(readFileSync(resolve(FIXTURES, "expected.json"), "utf8")) as Record<
  string,
  { placement?: string; flipped?: boolean; failure?: string }
>;
const MIDGAME = EXPECTED["midgame.png"]!.placement!;
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

const fixture = (name: string) => resolve(FIXTURES, name);
const startButton = (page: Page) => page.getByRole("button", { name: "Start game" });

async function upload(page: Page, name: string) {
  await page.getByLabel("Image file").setInputFiles(fixture(name));
}

async function expectPosition(page: Page, placement: string) {
  await expect(page.getByRole("heading", { name: "Check the position" })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => piecesSorted(page)).toEqual(expectedPieces(placement));
}

/** A reply in the service's format, so the review screen can be tested with exact flags. */
function scriptedReading(
  placement: string,
  flagged: Record<string, { confidence: number; alternatives: { label: string; probability: number }[] }> = {},
  orientationReview = false,
) {
  const board = new Map(expectedPieces(placement));
  const codes: Record<string, string> = {
    "white pawn": "P",
    "white knight": "N",
    "white bishop": "B",
    "white rook": "R",
    "white queen": "Q",
    "white king": "K",
    "black pawn": "p",
    "black knight": "n",
    "black bishop": "b",
    "black rook": "r",
    "black queen": "q",
    "black king": "k",
  };
  const squares = [];
  for (const file of "abcdefgh") {
    for (const rank of "12345678") {
      const square = `${file}${rank}`;
      const name = board.get(square);
      const flag = flagged[square];
      squares.push({
        square,
        label: name ? codes[name] : "empty",
        confidence: flag?.confidence ?? 0.999,
        alternatives: flag?.alternatives ?? [],
        needs_review: Boolean(flag),
        review_reasons: flag ? ["low_confidence"] : [],
      });
    }
  }
  return {
    contract_version: "1.0",
    status: "ok",
    source_kind: "screenshot",
    board: {
      corners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      confidence: 1,
    },
    orientation: {
      quarter_turns_cw: 0,
      confidence: orientationReview ? 0.6 : 0.99,
      method: "piece_layout",
      needs_review: orientationReview,
    },
    placement,
    squares,
    issues: [],
    rectified_preview: null,
    engine: { name: "scripted", version: "0" },
    timings_ms: {},
  };
}

async function useScriptedReading(page: Page, reply: object) {
  await page.route("**/api/v1/recognize", (route) => route.fulfill({ json: reply }));
  await upload(page, "midgame.png");
  await expect(page.getByRole("heading", { name: "Check the position" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Photo to Chess" })).toBeVisible();
});

test.describe("reading real images with the real service", () => {
  test("uploading a screenshot reconstructs the exact position", async ({ page }) => {
    await upload(page, "midgame.png");
    await expectPosition(page, MIDGAME);
  });

  test("a board surrounded by page content is found", async ({ page }) => {
    await upload(page, "on-page.png");
    await expectPosition(page, EXPECTED["on-page.png"]!.placement!);
  });

  test("a screenshot with Black at the bottom is turned the right way", async ({ page }) => {
    await upload(page, "flipped.jpg");
    await expectPosition(page, EXPECTED["flipped.jpg"]!.placement!);
  });

  test("WEBP files work", async ({ page }) => {
    await upload(page, "endgame.webp");
    await expect(page.getByRole("heading", { name: "Check the position" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("img", { name: "The board found in your image" })).toBeVisible();
  });

  test("no details are invented, and then a real game can be played", async ({ page }) => {
    await upload(page, "midgame.png");
    await expectPosition(page, MIDGAME);

    await expect(page.getByRole("radio", { name: "White" })).not.toBeChecked();
    await expect(page.getByRole("radio", { name: "Black" })).not.toBeChecked();
    await expect(page.getByLabel("White kingside")).not.toBeChecked();
    await expect(page.getByText("Choose whose turn it is.")).toBeVisible();
    await expect(startButton(page)).toBeDisabled();

    await page.getByRole("radio", { name: "Black" }).check();
    await startButton(page).click();
    await expect(page.locator(".status")).toHaveText("Black to move.");
    await expect(page.getByText(`${MIDGAME} b - - 0 1`)).toBeVisible();
    await expect.poll(() => piecesSorted(page)).toEqual(expectedPieces(MIDGAME));
  });

  test("the exact starting position gets its castling rights", async ({ page }) => {
    await upload(page, "start.png");
    await expectPosition(page, START);
    await expect(page.getByLabel("White kingside")).toBeChecked();
    await expect(page.getByLabel("Black queenside")).toBeChecked();
  });

  for (const [name, message] of [
    ["no-board.png", /No flat chessboard was found/],
    ["two-boards.png", /more than one chessboard/],
    ["cut-off.png", /Part of the board is cut off/],
  ] as const) {
    test(`${name} gets a useful message and a way forward`, async ({ page }) => {
      await upload(page, name);
      await expect(page.getByRole("alert")).toContainText(message, { timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Try another image" })).toBeVisible();
      await page.getByRole("button", { name: "Arrange a position by hand" }).click();
      await expect(page.getByRole("heading", { name: "Set up the position" })).toBeVisible();
    });
  }
});

test.describe("other ways to supply an image", () => {
  test("pasting works", async ({ page }) => {
    const base64 = readFileSync(fixture("midgame.png")).toString("base64");
    await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "clip.png", { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }));
    }, base64);
    await expectPosition(page, MIDGAME);
  });

  test("pasting text says there's no image", async ({ page }) => {
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(3)], "a.txt", { type: "text/plain" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }));
    });
    await expect(page.getByRole("alert")).toContainText("no image on your clipboard");
  });

  test("dropping a file works", async ({ page }) => {
    const base64 = readFileSync(fixture("midgame.png")).toString("base64");
    await page.locator(".dropzone").evaluate((zone, data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "drop.png", { type: "image/png" }));
      zone.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }, base64);
    await expectPosition(page, MIDGAME);
  });

  test("the camera opens, takes a photo, and reports what it found", async ({ page }) => {
    await page.getByRole("button", { name: "Open camera" }).click();
    const take = page.getByRole("button", { name: "Take photo" });
    await expect(take).toBeEnabled({ timeout: 15_000 });
    await take.click();
    // The fake camera shows a test pattern with no chessboard in it.
    await expect(page.getByRole("alert")).toContainText(/chessboard|board/, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Try another image" })).toBeVisible();
  });

  test("closing the camera returns to the main screen", async ({ page }) => {
    await page.getByRole("button", { name: "Open camera" }).click();
    await page.getByRole("button", { name: "Close camera" }).click();
    await expect(page.getByRole("button", { name: "Upload image" })).toBeVisible();
  });

  test("a file of the wrong type is refused before it's sent", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/v1/recognize", (route) => {
      requests += 1;
      return route.abort();
    });
    await page.getByLabel("Image file").setInputFiles({
      name: "drawing.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("GIF89a"),
    });
    await expect(page.getByRole("alert")).toContainText("Use a JPG, PNG or WEBP image.");
    expect(requests).toBe(0);
  });

  test("a damaged image gets a clear message", async ({ page }) => {
    await page.getByLabel("Image file").setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("not really a png"),
    });
    await expect(page.getByRole("alert")).toContainText("couldn't be read");
  });

  test("if the service is down, it says so and offers another way", async ({ page }) => {
    await page.route("**/api/v1/recognize", (route) => route.abort());
    await upload(page, "midgame.png");
    await expect(page.getByRole("alert")).toContainText("isn't reachable");
    await expect(page.getByRole("button", { name: "Arrange a position by hand" })).toBeVisible();
  });

  test("reading can be cancelled", async ({ page }) => {
    await page.route("**/api/v1/recognize", async (route) => {
      await new Promise((done) => setTimeout(done, 3000));
      await route.abort().catch(() => undefined);
    });
    await upload(page, "midgame.png");
    await expect(page.getByRole("status")).toHaveText("Reading the board…");
    await expect(page.getByRole("img", { name: "The image being read" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Upload image" })).toBeVisible();
  });
});

test.describe("checking an uncertain reading", () => {
  const UNSURE = {
    c6: {
      confidence: 0.62,
      alternatives: [
        { label: "b", probability: 0.3 },
        { label: "empty", probability: 0.05 },
      ],
    },
    d1: { confidence: 0.7, alternatives: [{ label: "K", probability: 0.25 }] },
  };

  test("uncertain squares are highlighted and block the game until they're resolved", async ({ page }) => {
    await useScriptedReading(page, scriptedReading(MIDGAME, UNSURE));
    await expect(page.locator("cg-board square.needs-review:visible")).toHaveCount(2);
    await expect(page.getByRole("list", { name: "Squares to check" }).getByRole("listitem")).toHaveCount(2);
    await page.getByRole("radio", { name: "White" }).check();
    await expect(page.getByText("2 things still need checking above.")).toBeVisible();
    await expect(startButton(page)).toBeDisabled();

    await page.getByRole("button", { name: "It's right" }).first().click();
    await expect(page.locator("cg-board square.needs-review:visible")).toHaveCount(1);
    await expect(startButton(page)).toBeDisabled();

    await page.getByRole("button", { name: "It's right" }).click();
    await expect(page.locator("cg-board square.needs-review:visible")).toHaveCount(0);
    await expect(startButton(page)).toBeEnabled();
  });

  test("choosing a suggested alternative replaces the piece and resolves the flag", async ({ page }) => {
    await useScriptedReading(page, scriptedReading(MIDGAME, UNSURE));
    await page.getByRole("button", { name: "Black bishop (30%)" }).click();
    await expect.poll(async () => (await pieces(page)).get("c6")).toBe("black bishop");
    await expect(page.locator("cg-board square.needs-review:visible")).toHaveCount(1);
  });

  test("choosing empty removes the piece", async ({ page }) => {
    await useScriptedReading(page, scriptedReading(MIDGAME, UNSURE));
    await page.getByRole("button", { name: /Empty square/ }).click();
    await expect.poll(async () => (await pieces(page)).has("c6")).toBe(false);
  });

  test("the board can't be dragged after reading an image, until asked to fix a piece", async ({ page }) => {
    await useScriptedReading(page, scriptedReading(MIDGAME));
    const before = await piecesSorted(page);

    async function dragKnight() {
      await page.locator(".board").scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const box = (await page.locator(".board").boundingBox())!;
      const at = (column: number, row: number) => [box.x + ((column + 0.5) * box.width) / 8, box.y + ((row + 0.5) * box.height) / 8] as const;
      // The white knight on f3, to the empty square a6.
      await page.mouse.move(...at(5, 5));
      await page.mouse.down();
      await page.mouse.move(...at(2, 3), { steps: 5 });
      await page.waitForTimeout(40);
      await page.mouse.move(...at(0, 2), { steps: 5 });
      await page.waitForTimeout(40);
      await page.mouse.up();
    }

    const moveTool = page.getByRole("button", { name: "Move pieces", exact: true });
    await expect(moveTool).toHaveCount(0);
    await dragKnight();
    expect(await piecesSorted(page)).toEqual(before);

    await page.getByRole("button", { name: "Fix a piece" }).click();
    await expect(moveTool).toBeVisible();
    await dragKnight();
    await expect.poll(async () => (await pieces(page)).get("a6")).toBe("white knight");

    await page.getByRole("button", { name: "Done fixing" }).click();
    await expect(page.getByRole("button", { name: "Fix a piece" })).toBeVisible();
  });

  test("editing a flagged square on the board also resolves it", async ({ page }) => {
    await useScriptedReading(page, scriptedReading(MIDGAME, UNSURE));
    await page.getByRole("button", { name: "Fix a piece" }).click();
    await page.getByRole("button", { name: "Remove pieces" }).click();
    const box = (await page.locator(".board").boundingBox())!;
    await page.locator(".board").scrollIntoViewIfNeeded();
    const fresh = (await page.locator(".board").boundingBox())!;
    const x = fresh.x + (2.5 * box.width) / 8;
    const y = fresh.y + (2.5 * box.height) / 8;
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    if ((page.viewportSize()?.width ?? 1000) < 600) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await expect(page.locator("cg-board square.needs-review:visible")).toHaveCount(1);
  });

  test("everything can be confirmed at once", async ({ page }) => {
    await useScriptedReading(page, scriptedReading(MIDGAME, UNSURE, true));
    await page.getByRole("button", { name: "All of these are right" }).click();
    await expect(page.locator("cg-board square.needs-review:visible")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Squares to check" })).toHaveCount(0);
  });

  test("an unclear orientation is asked about, and can be turned around", async ({ page }) => {
    await useScriptedReading(page, scriptedReading("8/5k2/8/8/3K4/8/4P3/8", {}, true));
    await expect(page.getByText(/don't clearly show which side is at the bottom/)).toBeVisible();
    await page.getByRole("radio", { name: "White" }).check();
    await expect(startButton(page)).toBeDisabled();

    await page.getByRole("button", { name: "No, turn the board around" }).click();
    await expect.poll(async () => (await pieces(page)).get("d7")).toBe("white pawn");
  });

  test("confirming the orientation unblocks the game", async ({ page }) => {
    await useScriptedReading(page, scriptedReading("8/5k2/8/8/3K4/8/4P3/8", {}, true));
    await page.getByRole("radio", { name: "White" }).check();
    await page.getByRole("button", { name: "Yes, White's at the bottom" }).click();
    await expect(startButton(page)).toBeEnabled();
  });

  test("every piece's confidence can be seen", async ({ page }) => {
    await useScriptedReading(page, scriptedReading(MIDGAME, UNSURE));
    await expect(page.getByText(/least certain is 62% sure/)).toBeVisible();
    await page.getByText("Confidence for every piece").click();
    await expect(page.locator(".readings li").first()).toContainText("62%");
  });

  test("the image can be swapped from the checking screen", async ({ page }) => {
    await useScriptedReading(page, scriptedReading(MIDGAME, UNSURE));
    await page.getByRole("button", { name: "Use an image instead" }).click();
    await expect(page.getByRole("button", { name: "Upload image" })).toBeVisible();
  });
});
