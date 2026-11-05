import { expect, test, type Page } from "@playwright/test";
import { pieces } from "./helpers";

const status = (page: Page) => page.locator(".status");
const ENGINE_TIMEOUT = { timeout: 30_000 };

async function startFrom(page: Page, fen: string) {
  await page.getByRole("button", { name: "Arrange a position by hand" }).click();
  await page.getByText("Load a FEN").click();
  await page.getByLabel("FEN", { exact: true }).fill(fen);
  await page.getByRole("button", { name: "Load FEN" }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
}

async function tap(page: Page, square: string) {
  await page.locator(".board").scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const box = (await page.locator(".board").boundingBox())!;
  const flipped = (await page.locator(".board.orientation-black").count()) > 0;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const x = box.x + (((flipped ? 7 - file : file) + 0.5) * box.width) / 8;
  const y = box.y + (((flipped ? rank : 7 - rank) + 0.5) * box.height) / 8;
  if ((page.viewportSize()?.width ?? 1000) < 600) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function tapMove(page: Page, from: string, to: string) {
  await tap(page, from);
  await tap(page, to);
}

async function chooseOpponent(page: Page, side: "White" | "Black", strength = "Beginner") {
  await page.getByRole("button", { name: "Play against computer" }).click();
  await page.getByRole("radio", { name: side }).check();
  await page.getByLabel("Strength").selectOption({ label: strength });
  await page.getByRole("button", { name: "Start playing" }).click();
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test.describe("playing the computer", () => {
  test("it answers your move with a legal move", async ({ page }) => {
    await startFrom(page, START);
    await chooseOpponent(page, "White");
    await tapMove(page, "e2", "e4");
    await expect(page.locator(".sheet__row").first().locator(".sheet__move").nth(1)).not.toBeEmpty(ENGINE_TIMEOUT);
    await expect(status(page)).toHaveText("White to move.");
    expect((await pieces(page)).size).toBe(32);
  });

  test("it moves first when it's the computer's turn, and the board faces you", async ({ page }) => {
    await startFrom(page, START);
    await chooseOpponent(page, "Black");
    await expect(page.locator(".board.orientation-black")).toHaveCount(1);
    await expect(status(page)).toHaveText("Black to move.", ENGINE_TIMEOUT);
    await expect(page.locator(".sheet__row").first().locator(".sheet__move").first()).not.toBeEmpty();
  });

  test("it plays on from the position in the FEN, and finds a mate", async ({ page }) => {
    await startFrom(page, "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
    await chooseOpponent(page, "Black", "Maximum");
    await expect(status(page)).toHaveText("Checkmate. White wins.", ENGINE_TIMEOUT);
    await expect.poll(async () => (await pieces(page)).get("f7")).toBe("white queen");
  });

  test("your pieces can't be moved during its turn", async ({ page }) => {
    await startFrom(page, START);
    await chooseOpponent(page, "White", "Maximum");
    await tapMove(page, "e2", "e4");
    await expect(status(page)).toContainText(/Computer is thinking|White to move/);
    await tapMove(page, "d2", "d4");
    await expect(status(page)).toHaveText("White to move.", ENGINE_TIMEOUT);
    expect((await pieces(page)).get("d2")).toBe("white pawn");
  });

  test("undo takes back your move and its reply", async ({ page }) => {
    await startFrom(page, START);
    await chooseOpponent(page, "White");
    await tapMove(page, "e2", "e4");
    await expect(status(page)).toHaveText("White to move.", ENGINE_TIMEOUT);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await pieces(page)).get("e2")).toBe("white pawn");
    await expect(status(page)).toHaveText("White to move.");
    await expect(page.locator(".sheet__row").first().locator(".sheet__move").first()).toBeEmpty();
  });

  test("restart returns to the position, and the computer moves again if it's first", async ({ page }) => {
    await startFrom(page, START);
    await chooseOpponent(page, "Black");
    await expect(status(page)).toHaveText("Black to move.", ENGINE_TIMEOUT);
    await page.getByRole("button", { name: "Restart" }).click();
    await page.getByRole("button", { name: "Tap again to restart" }).click();
    await expect(status(page)).toHaveText("Black to move.", ENGINE_TIMEOUT);
  });

  test("you can go back to two players at any time", async ({ page }) => {
    await startFrom(page, START);
    await chooseOpponent(page, "White");
    await page.getByRole("button", { name: "Switch to two players" }).click();
    await tapMove(page, "e2", "e4");
    await expect(status(page)).toHaveText("Black to move.");
    await page.waitForTimeout(800);
    await expect(status(page)).toHaveText("Black to move.");
  });

  test("a promotion by the computer is played correctly", async ({ page }) => {
    await startFrom(page, "8/8/8/8/8/1K6/7p/k7 b - - 0 1");
    await chooseOpponent(page, "White", "Maximum");
    await expect.poll(async () => (await pieces(page)).has("h2"), ENGINE_TIMEOUT).toBe(false);
    const pieceOnH1 = (await pieces(page)).get("h1");
    expect(pieceOnH1).toMatch(/black (queen|rook|knight|bishop)/);
  });

  test("the choice of strength is offered", async ({ page }) => {
    await startFrom(page, START);
    await page.getByRole("button", { name: "Play against computer" }).click();
    const options = await page.getByLabel("Strength").locator("option").allTextContents();
    expect(options).toEqual(["Beginner", "Casual", "Club", "Strong", "Maximum"]);
  });
});

test.describe("analysing a position", () => {
  test("shows an evaluation, best moves and an arrow for the current position", async ({ page }) => {
    await startFrom(page, START);
    await page.getByRole("button", { name: "Analyze position" }).click();
    await expect(page.getByTestId("evaluation")).toBeVisible(ENGINE_TIMEOUT);
    await expect(page.locator(".line")).toHaveCount(3, ENGINE_TIMEOUT);
    await expect(page.locator(".line").first()).toContainText("1.");
    await expect(page.locator("svg.cg-shapes line, .cg-shapes line").first()).toBeAttached();
  });

  test("analyses the actual position and not the opening", async ({ page }) => {
    await startFrom(page, "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
    await page.getByRole("button", { name: "Analyze position" }).click();
    await expect(page.getByText("White has checkmate in 1, starting with Qxf7#.")).toBeVisible(ENGINE_TIMEOUT);
    await expect(page.getByTestId("evaluation")).toContainText("White mates in 1");
  });

  test("works when Black is to move, and scores from White's side", async ({ page }) => {
    await startFrom(page, "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2");
    await page.getByRole("button", { name: "Analyze position" }).click();
    await expect(page.getByTestId("evaluation")).toContainText("Black mates in 1", ENGINE_TIMEOUT);
    await expect(page.locator(".line").first()).toContainText("2... Qh4#");
  });

  test("warns about a mate threat", async ({ page }) => {
    await startFrom(page, "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3");
    await page.getByRole("button", { name: "Analyze position" }).click();
    await expect(page.getByText(/White threatens checkmate in 1, starting with Qxf7#/)).toBeVisible(ENGINE_TIMEOUT);
  });

  test("updates when a move is played", async ({ page }) => {
    await startFrom(page, START);
    await page.getByRole("button", { name: "Analyze position" }).click();
    await expect(page.locator(".line").first()).toContainText("1.", ENGINE_TIMEOUT);
    await tapMove(page, "e2", "e4");
    await expect(page.locator(".line").first()).toContainText("1...", ENGINE_TIMEOUT);
  });

  test("says when the game is over", async ({ page }) => {
    await startFrom(page, "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    await page.getByRole("button", { name: "Analyze position" }).click();
    await expect(page.getByText("The game is over, so there's nothing left to analyse.")).toBeVisible();
  });

  test("can be closed, which removes the arrow", async ({ page }) => {
    await startFrom(page, START);
    await page.getByRole("button", { name: "Analyze position" }).click();
    await expect(page.getByTestId("evaluation")).toBeVisible(ENGINE_TIMEOUT);
    await page.getByRole("button", { name: "Hide analysis" }).click();
    await expect(page.getByTestId("evaluation")).toHaveCount(0);
    await expect(page.locator(".cg-shapes line")).toHaveCount(0);
  });

  test("a review needs moves to judge", async ({ page }) => {
    await startFrom(page, START);
    await page.getByRole("button", { name: "Analyze position" }).click();
    await expect(page.getByRole("button", { name: "Review moves" })).toBeDisabled();
    await expect(page.getByText(/A single position has no moves to judge/)).toBeVisible();
  });

  test("a review finds a blunder and marks it on the scoresheet", async ({ page }) => {
    await startFrom(page, START);
    await tapMove(page, "e2", "e4");
    await tapMove(page, "e7", "e5");
    await tapMove(page, "g1", "f3");
    await tapMove(page, "d8", "g5");
    await expect(page.locator(".sheet")).toContainText("Qg5");
    await page.getByRole("button", { name: "Analyze position" }).click();
    await page.getByRole("button", { name: "Review moves" }).click();
    await expect(page.locator(".reviewed")).toContainText("Qg5??", { timeout: 60_000 });
    await expect(page.locator(".reviewed")).toContainText("Blunder");
    await expect(page.locator(".sheet__mark").filter({ hasText: "??" })).toHaveCount(1);
  });
});

test.describe("if the engine can't load", () => {
  test("it says so, and two-player play carries on", async ({ page }) => {
    await page.route("**/engine/**", (route) => route.abort());
    await startFrom(page, START);
    await page.getByRole("button", { name: "Analyze position" }).click();
    await expect(page.getByRole("alert")).toContainText("couldn't start", { timeout: 40_000 });
    await tapMove(page, "e2", "e4");
    await expect(status(page)).toHaveText("Black to move.");
  });
});

test.describe("offline", () => {
  test.use({ serviceWorkers: "allow" });

  test("playing the computer and analysing work with no connection", async ({ page, context }) => {
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 20_000 })
      .toBe(true);
    // Stored once the worker takes control, so give that a moment to finish.
    await page.waitForTimeout(1500);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Photo to Chess" })).toBeVisible();

    await startFrom(page, START);
    await page.getByRole("button", { name: "Analyze position" }).click();
    await expect(page.getByTestId("evaluation")).toBeVisible(ENGINE_TIMEOUT);
    await page.getByRole("button", { name: "Hide analysis" }).click();

    await chooseOpponent(page, "White");
    await tapMove(page, "e2", "e4");
    await expect(status(page)).toHaveText("White to move.", ENGINE_TIMEOUT);

    await context.setOffline(false);
  });

  test("reading an image while offline says what's wrong", async ({ page, context }) => {
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await context.setOffline(true);
    await page.getByLabel("Image file").setInputFiles({
      name: "a.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    await expect(page.getByRole("alert")).toContainText("isn't reachable");
    await context.setOffline(false);
  });
});
