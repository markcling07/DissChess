import { expect, test, type Page } from "@playwright/test";
import { pieces } from "./helpers";

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 600;

/** The centre of a square on screen, respecting which way the board faces. */
async function squareCentre(page: Page, square: string) {
  const box = (await page.locator(".board").boundingBox())!;
  const flipped = await page.locator(".board.orientation-black").count();
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const column = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  return { x: box.x + ((column + 0.5) * box.width) / 8, y: box.y + ((row + 0.5) * box.height) / 8 };
}

async function drag(page: Page, from: string, to: string | { x: number; y: number }) {
  const start = await squareCentre(page, from);
  const end = typeof to === "string" ? await squareCentre(page, to) : to;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
  await page.waitForTimeout(40);
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.waitForTimeout(40);
  await page.mouse.up();
}

async function tap(page: Page, square: string) {
  await page.locator(".board").scrollIntoViewIfNeeded();
  // The board re-measures itself when scrolling ends, and a finger can't beat that by a frame.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const { x, y } = await squareCentre(page, square);
  if (isPhone(page)) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Moves by tapping twice, which is how most phone users play. */
async function tapMove(page: Page, from: string, to: string) {
  await tap(page, from);
  await tap(page, to);
}

async function loadFen(page: Page, fen: string) {
  await page.getByText("Load a FEN").click();
  await page.getByLabel("FEN", { exact: true }).fill(fen);
  await page.getByRole("button", { name: "Load FEN" }).click();
}

async function startFrom(page: Page, fen: string) {
  await loadFen(page, fen);
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
}

const status = (page: Page) => page.locator(".status");

let consoleErrors: string[];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  await page.goto("/");
  await page.getByRole("button", { name: "Arrange a position by hand" }).click();
  await expect(page.locator("cg-board")).toBeVisible();
  await page.getByRole("button", { name: "Standard position" }).click();
  await expect.poll(async () => (await pieces(page)).size).toBe(32);
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

test.describe("arranging by hand", () => {
  test("starts empty, and pieces can be dragged on from the tray", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Arrange a position by hand" }).click();
    await expect(page.locator("cg-board")).toBeVisible();
    expect((await pieces(page)).size).toBe(0);
    await expect(page.getByRole("button", { name: "Start game" })).toBeDisabled();

    async function dragFromTray(name: string, square: string) {
      await page.locator(".board").scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const from = (await page.getByRole("button", { name }).boundingBox())!;
      const to = await squareCentre(page, square);
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
      await page.waitForTimeout(40);
      await page.mouse.move(to.x, to.y, { steps: 5 });
      await page.waitForTimeout(40);
      await page.mouse.up();
    }

    await dragFromTray("Place white king", "e1");
    await dragFromTray("Place black king", "e8");
    await dragFromTray("Place white queen", "d4");
    await expect.poll(async () => (await pieces(page)).get("d4")).toBe("white queen");
    const board = await pieces(page);
    expect(board.size).toBe(3);
    expect(board.get("e1")).toBe("white king");
    expect(board.get("e8")).toBe("black king");
    expect(board.get("d4")).toBe("white queen");

    // A piece dropped on an occupied square replaces it.
    await dragFromTray("Place black rook", "d4");
    await expect.poll(async () => (await pieces(page)).get("d4")).toBe("black rook");
    expect((await pieces(page)).size).toBe(3);

    await page.getByRole("radio", { name: "White" }).check();
    await expect(page.getByRole("button", { name: "Start game" })).toBeEnabled();
  });
});

test.describe("editing a position", () => {
  test("opens with the 32 pieces of the standard position", async ({ page }) => {
    const board = await pieces(page);
    expect(board.size).toBe(32);
    expect(board.get("e1")).toBe("white king");
    await expect(page.getByText("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBeVisible();
  });

  test("tapping places a piece and replaces a wrong one", async ({ page }) => {
    await page.getByRole("button", { name: "Place black queen" }).click();
    await tap(page, "d4");
    await expect.poll(async () => (await pieces(page)).get("d4")).toBe("black queen");
    await tap(page, "a2");
    await expect.poll(async () => (await pieces(page)).get("a2")).toBe("black queen");
  });

  test("the erase tool removes only the tapped piece", async ({ page }) => {
    await page.getByRole("button", { name: "Remove pieces" }).click();
    await tap(page, "h1");
    await expect.poll(async () => (await pieces(page)).size).toBe(31);
    expect((await pieces(page)).has("h1")).toBe(false);
    await expect(page.locator(".fen")).toContainText(" w Qkq - ");
  });

  test("selecting a piece and then switching tool doesn't affect that piece", async ({ page }) => {
    await tap(page, "a2");
    await page.getByRole("button", { name: "Remove pieces" }).click();
    await tap(page, "h1");
    await expect.poll(async () => (await pieces(page)).has("h1")).toBe(false);
    expect((await pieces(page)).get("a2")).toBe("white pawn");
    expect((await pieces(page)).size).toBe(31);
  });

  test("tapping moves a piece, even onto another piece's square", async ({ page }) => {
    await tapMove(page, "a2", "a4");
    await expect.poll(async () => (await pieces(page)).get("a4")).toBe("white pawn");
    expect((await pieces(page)).has("a2")).toBe(false);
    await tapMove(page, "a4", "b7");
    await expect.poll(async () => (await pieces(page)).get("b7")).toBe("white pawn");
    expect((await pieces(page)).size).toBe(31);
  });

  test("dragging a piece back to its own square leaves it there", async ({ page }) => {
    test.skip(isPhone(page), "drag uses a mouse");
    await drag(page, "e2", "e2");
    expect((await pieces(page)).get("e2")).toBe("white pawn");
    expect((await pieces(page)).size).toBe(32);
  });

  test("dragging moves a piece, and off the board removes it", async ({ page }) => {
    test.skip(isPhone(page), "drag uses a mouse");
    await drag(page, "b1", "c3");
    await expect.poll(async () => (await pieces(page)).get("c3")).toBe("white knight");
    expect((await pieces(page)).has("b1")).toBe(false);

    const box = (await page.locator(".board").boundingBox())!;
    await drag(page, "c3", { x: box.x + box.width + 30, y: box.y + 20 });
    await expect.poll(async () => (await pieces(page)).size).toBe(31);
    expect((await pieces(page)).has("c3")).toBe(false);
  });

  test("a tap straight after a drag still registers", async ({ page }) => {
    test.skip(isPhone(page), "drag uses a mouse");
    await drag(page, "b1", "c3");
    await page.getByRole("button", { name: "Remove pieces" }).click();
    await tap(page, "h1");
    await expect.poll(async () => (await pieces(page)).has("h1")).toBe(false);
    expect((await pieces(page)).get("c3")).toBe("white knight");
  });

  test("rotating turns the pieces clockwise", async ({ page }) => {
    await page.getByRole("button", { name: "Rotate pieces" }).click();
    await expect.poll(async () => (await pieces(page)).get("a8")).toBe("white rook");
    expect((await pieces(page)).get("h1")).toBe("black rook");
  });

  test("an empty board can't start, and no list of problems appears", async ({ page }) => {
    await page.getByRole("button", { name: "Clear board" }).click();
    await expect.poll(async () => (await pieces(page)).size).toBe(0);
    await expect(page.getByText("White has no king. Add one.")).toHaveCount(0);
    await expect(page.getByText("Choose whose turn it is.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start game" })).toBeDisabled();
  });

  test("squares behind a blocking problem are highlighted", async ({ page }) => {
    await page.getByRole("button", { name: "Place white king" }).click();
    await tap(page, "a4");
    await expect(page.locator("cg-board square.needs-fixing:visible")).toHaveCount(2);
    await expect(page.getByText("White has 2 kings. Remove all but one.")).toBeVisible();
  });

  test("a king in check settles whose turn it is", async ({ page }) => {
    await loadFen(page, "4k3/8/8/8/8/8/4R3/4K3");
    await expect(page.getByText("Black is in check, so it must be Black's turn.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Black" })).toBeChecked();
  });

  test("an unreadable FEN gets a useful message and changes nothing", async ({ page }) => {
    await loadFen(page, "not a fen");
    await expect(page.getByText(/needs 8 ranks/)).toBeVisible();
    expect((await pieces(page)).size).toBe(32);
  });
});

test.describe("pasting moves", () => {
  test("the moves open a real game, where a pawn can't capture sideways", async ({ page }) => {
    await page.getByText("Paste moves").click();
    await page.getByLabel("Moves", { exact: true }).fill("1. e4 e5 2. Nf3 Nf6 3. Bc4 Nc6 4. Ng5 d5 5. exd5 h6");
    await page.getByRole("button", { name: "Load moves" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(status(page)).toHaveText("White to move.");

    await tapMove(page, "d5", "e5");
    let board = await pieces(page);
    expect(board.get("d5")).toBe("white pawn");
    expect(board.get("e5")).toBe("black pawn");
    await expect(status(page)).toHaveText("White to move.");

    // Taps after the refused move can leave a selection, so a flip there and back clears it.
    await page.getByRole("button", { name: "Flip board" }).click();
    await page.getByRole("button", { name: "Flip board" }).click();
    await tapMove(page, "d5", "c6");
    board = await pieces(page);
    expect(board.get("c6")).toBe("white pawn");
    expect(board.has("d5")).toBe(false);
    await expect(status(page)).toHaveText("Black to move.");
  });

  test("loads the position after the moves, and the game plays on from it", async ({ page }) => {
    await page.getByText("Paste moves").click();
    await page
      .getByLabel("Moves", { exact: true })
      .fill(
        "1. c4 b6 2. b3 c6 3. ♗ b2 ♝ b7 4. ♘ f3 f6 5. d3 e5 6. e4 d6 7. ♗ e2 ♞ d7 8. ♘ c3 ♞ e7 9. O-O g5 10. ♘ d2 h5 11. ♗ xh5+ ♞ g6",
      );
    await page.getByRole("button", { name: "Load moves" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(status(page)).toHaveText("White to move.");
    await tapMove(page, "h5", "g6");
    expect((await pieces(page)).get("g6")).toBe("white bishop");
    await expect(status(page)).toHaveText("Black to move, in check.");
  });

  test("a move that can't be played is named, and nothing changes", async ({ page }) => {
    await page.getByText("Paste moves").click();
    await page.getByLabel("Moves", { exact: true }).fill("1. e4 e5 2. Nf6");
    await page.getByRole("button", { name: "Load moves" }).click();
    await expect(page.getByText(/Couldn't play 2\. Nf6 for White/)).toBeVisible();
    expect((await pieces(page)).size).toBe(32);
  });
});

test.describe("playing from a position", () => {
  test("keeps the exact pieces and the side to move", async ({ page }) => {
    await startFrom(page, "4k3/8/8/8/8/8/4P3/4K3 b - - 12 40");
    expect([...(await pieces(page)).keys()].sort()).toEqual(["e1", "e2", "e8"]);
    await expect(status(page)).toHaveText("Black to move.");
  });

  test("legal moves play and are written down", async ({ page }) => {
    await page.getByRole("button", { name: "Start game" }).click();
    await tapMove(page, "e2", "e4");
    await expect(status(page)).toHaveText("Black to move.");
    await tapMove(page, "e7", "e5");
    await expect(status(page)).toHaveText("White to move.");
    await expect(page.locator(".sheet__row").first()).toContainText("e4");
    await expect(page.locator(".sheet__row").first()).toContainText("e5");
  });

  test("dragging an illegal move puts the piece back", async ({ page }) => {
    test.skip(isPhone(page), "drag uses a mouse");
    await page.getByRole("button", { name: "Start game" }).click();
    await drag(page, "e2", "e5");
    await expect(status(page)).toHaveText("White to move.");
    await expect.poll(async () => (await pieces(page)).get("e2")).toBe("white pawn");
    expect((await pieces(page)).has("e5")).toBe(false);
  });

  test("dragging a legal move plays it", async ({ page }) => {
    test.skip(isPhone(page), "drag uses a mouse");
    await page.getByRole("button", { name: "Start game" }).click();
    await drag(page, "g1", "f3");
    await expect(status(page)).toHaveText("Black to move.");
    await expect.poll(async () => (await pieces(page)).get("f3")).toBe("white knight");
  });

  test("the opponent's pieces can't be moved out of turn", async ({ page }) => {
    await page.getByRole("button", { name: "Start game" }).click();
    await tapMove(page, "e7", "e5");
    await expect(status(page)).toHaveText("White to move.");
    expect((await pieces(page)).get("e7")).toBe("black pawn");
  });

  test("castling moves both the king and the rook", async ({ page }) => {
    await startFrom(page, "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    await tapMove(page, "e1", "g1");
    await expect(status(page)).toHaveText("Black to move.");
    await expect.poll(async () => (await pieces(page)).get("f1")).toBe("white rook");
    expect((await pieces(page)).get("g1")).toBe("white king");
    await expect(page.locator(".sheet__row").first()).toContainText("O-O");
  });

  test("en passant removes the captured pawn", async ({ page }) => {
    await startFrom(page, "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
    await tapMove(page, "e5", "d6");
    await expect(status(page)).toHaveText("Black to move.");
    await expect.poll(async () => (await pieces(page)).has("d5")).toBe(false);
    expect((await pieces(page)).get("d6")).toBe("white pawn");
  });

  test("promotion asks which piece, and plays the choice", async ({ page }) => {
    await startFrom(page, "8/P6k/8/8/8/8/7K/8 w - - 0 1");
    await tapMove(page, "a7", "a8");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "White knight" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await pieces(page)).get("a8")).toBe("white knight");
  });

  test("cancelling a promotion puts the pawn back", async ({ page }) => {
    await startFrom(page, "8/P6k/8/8/8/8/7K/8 w - - 0 1");
    await tapMove(page, "a7", "a8");
    await page.getByRole("button", { name: "Cancel move" }).click();
    await expect.poll(async () => (await pieces(page)).get("a7")).toBe("white pawn");
    await expect(status(page)).toHaveText("White to move.");
    await tapMove(page, "h2", "h3");
    await expect(status(page)).toHaveText("Black to move.");
  });

  test("checkmate ends the game and records the result", async ({ page }) => {
    await startFrom(page, "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2");
    await tapMove(page, "d8", "h4");
    await expect(status(page)).toHaveText("Checkmate. Black wins.");
    await expect(page.locator(".sheet")).toContainText("0–1");
    await expect(page.locator("cg-board square.check")).toHaveCount(1);
    await tapMove(page, "a2", "a3");
    expect((await pieces(page)).get("a2")).toBe("white pawn");
  });

  test("stalemate and insufficient material are draws", async ({ page }) => {
    await startFrom(page, "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    await expect(status(page)).toHaveText("Stalemate. It's a draw.");
    await page.getByRole("button", { name: "Edit position" }).click();
    await startFrom(page, "8/8/8/4k3/8/4K3/8/8 w - - 0 1");
    await expect(status(page)).toHaveText("Draw: not enough pieces left to checkmate.");
  });

  test("undo, then restart, return to the exact position", async ({ page }) => {
    await startFrom(page, "4k3/8/8/8/8/8/4P3/4K3 w - - 3 20");
    await tapMove(page, "e2", "e4");
    await expect(status(page)).toHaveText("Black to move.");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(status(page)).toHaveText("White to move.");
    await expect.poll(async () => (await pieces(page)).get("e2")).toBe("white pawn");

    await tapMove(page, "e2", "e4");
    await expect(status(page)).toHaveText("Black to move.");
    await page.getByRole("button", { name: "Restart" }).click();
    expect((await pieces(page)).get("e4")).toBe("white pawn");
    await page.getByRole("button", { name: "Tap again to restart" }).click();
    await expect.poll(async () => (await pieces(page)).get("e2")).toBe("white pawn");
    await expect(page.getByText("4k3/8/8/8/8/8/4P3/4K3 w - - 3 20")).toBeVisible();
  });

  test("moves still work with the board flipped", async ({ page }) => {
    await page.getByRole("button", { name: "Start game" }).click();
    await page.getByRole("button", { name: "Flip board" }).click();
    await expect(page.locator(".board.orientation-black")).toHaveCount(1);
    await tapMove(page, "e2", "e4");
    await expect(status(page)).toHaveText("Black to move.");
    await expect.poll(async () => (await pieces(page)).get("e4")).toBe("white pawn");
  });

  test("editing returns to the position that was set up", async ({ page }) => {
    await startFrom(page, "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
    await tapMove(page, "e2", "e4");
    await expect(status(page)).toHaveText("Black to move.");
    await page.getByRole("button", { name: "Edit position" }).click();
    await page.getByRole("button", { name: "Tap again to discard moves" }).click();
    await expect(page.getByRole("heading", { name: "Set up the position" })).toBeVisible();
    await expect.poll(async () => (await pieces(page)).get("e2")).toBe("white pawn");
  });
});

test.describe("fitting the screen", () => {
  test("nothing scrolls sideways, on either screen", async ({ page }) => {
    // Compared with the device's width, because a phone's innerWidth grows to fit a too-wide page.
    const width = page.viewportSize()!.width;
    const overflow = async () => (await page.evaluate(() => document.documentElement.scrollWidth)) - width;
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("starting a game shows the board, not the bottom of the page", async ({ page }) => {
    await page.getByRole("button", { name: "Start game" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the board and the piece tools fit on a laptop screen together", async ({ page }) => {
    test.skip(isPhone(page), "desktop only");
    const tools = (await page.locator(".palette").boundingBox())!;
    expect(tools.y + tools.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.getByRole("button", { name: "Remove pieces" }).click();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("coordinate labels sit inside their own squares, facing either way", async ({ page }) => {
    await page.getByRole("button", { name: "Start game" }).click();
    const check = async () => {
      const box = (await page.locator(".board").boundingBox())!;
      const size = box.width / 8;
      const labels = await page.locator("coords.files coord").evaluateAll((all) =>
        all.map((coord) => ({ text: coord.textContent!, left: coord.getBoundingClientRect().left })),
      );
      const flipped = (await page.locator(".board.orientation-black").count()) > 0;
      for (const { text, left } of labels) {
        const file = text.charCodeAt(0) - 97;
        const column = flipped ? 7 - file : file;
        expect(Math.abs(left - (box.x + column * size))).toBeLessThan(size / 8);
      }
    };
    await check();
    await page.getByRole("button", { name: "Flip board" }).click();
    await expect(page.locator(".board.orientation-black")).toHaveCount(1);
    await check();
  });

  test("the board fills the width on a phone", async ({ page }) => {
    test.skip(!isPhone(page), "phone only");
    const box = (await page.locator(".board").boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBe(16);
    expect(box.width).toBe(width - 32);
    expect(box.height).toBe(box.width);
  });

  test("the board still lines up after the window is resized", async ({ page }) => {
    test.skip(isPhone(page), "desktop only");
    await page.getByRole("button", { name: "Start game" }).click();
    const before = (await page.locator(".board").boundingBox())!.width;
    await page.setViewportSize({ width: 700, height: 900 });
    await expect.poll(async () => (await page.locator(".board").boundingBox())!.width).not.toBe(before);
    await page.waitForTimeout(100); // The board re-measures itself just after the layout changes.
    await tapMove(page, "e2", "e4");
    await expect(status(page)).toHaveText("Black to move.");
    await expect.poll(async () => (await pieces(page)).get("e4")).toBe("white pawn");
  });

  test("tap targets are large enough on a phone", async ({ page }) => {
    test.skip(!isPhone(page), "phone only");
    for (const button of await page.locator(".tool, .actions button, button.primary").all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("installing", () => {
  test("the manifest and its icons load", async ({ page, request }) => {
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifest = await (await request.get(new URL(href!, page.url()).href)).json();
    expect(manifest.display).toBe("standalone");
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      const response = await request.get(new URL(icon.src, page.url()).href);
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain("image/png");
    }
  });
});
