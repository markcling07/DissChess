# Publishing

The app has two parts, hosted separately:

| Part | What it is | Suggested host | Other choices |
|---|---|---|---|
| Web app (`apps/web`) | Static files once built: the board, editor, engine and piece sets | Cloudflare Pages | Netlify, Vercel, GitHub Pages |
| Image reader (`services/vision`) | A Python service in a container, from `services/vision/Dockerfile` | Google Cloud Run | Render, Fly.io, Railway |

Both hosts give HTTPS, which the camera and offline mode need. Publish in this order, because each
part needs the other's address.

## 1. Put the code on GitHub

1. On GitHub, create a new **empty** repository: no README, licence or `.gitignore`, since the
   project has its own. Public is simplest, because the AGPL asks that people using the hosted app can
   get its source.
2. Connect and push from the project folder:

   ```bash
   git remote add origin https://github.com/<you>/photo-to-chess.git
   ```

   ```bash
   git push -u origin main
   ```

Test photos (`corpus/`), training data and reports are ignored and never uploaded. ChessReD in
particular is for testing only and must stay off GitHub.

## 2. Host the image reader

### Google Cloud Run

Needs a Google Cloud project with billing turned on. Cloud Run charges only while it reads images,
and its free monthly allowance covers light use.

1. In the Cloud Run console, choose **Deploy container**, then **Continuously deploy from a
   repository**, and connect the GitHub repository.
2. Branch `^main$`, build type **Dockerfile**, source location `/services/vision/Dockerfile`.
3. Settings:
   - **Authentication:** allow unauthenticated invocations, as the app is public.
   - **Region:** the one nearest your users, such as `asia-southeast1` (Singapore).
   - **Memory** 1 GiB, **CPU** 1. **Concurrency** 4: the service reads two images at a time and
     queues the rest.
   - **Minimum instances** 0, so it costs nothing when idle. The first image after a quiet spell
     takes a few seconds longer. **Maximum instances** 2, which caps the bill.
   - **Request timeout** 30 seconds.
   - **Variable** `PTC_ALLOWED_ORIGINS` set to the web app's address from step 3, such as
     `https://photo-to-chess.pages.dev`. Several can be given, separated by commas. Until it's set,
     browsers refuse the replies.
4. Deploy, then open `<service address>/healthz`. It should show `{"status":"ok"}`.

With the `gcloud` command line instead:

```bash
gcloud run deploy ptc-vision --source services/vision --region asia-southeast1 --allow-unauthenticated --memory 1Gi --concurrency 4 --max-instances 2 --timeout 30 --set-env-vars PTC_ALLOWED_ORIGINS=https://photo-to-chess.pages.dev
```

A budget alert in the billing console is worth setting too.

### Render, the simpler alternative

1. **New**, then **Web Service**, and connect the GitHub repository.
2. **Root directory** `services/vision`, **Runtime** Docker. **Health check path** `/healthz`.
3. **Environment variable** `PTC_ALLOWED_ORIGINS` as above.

The free plan sleeps after a while without use, and waking it takes up to a minute, which a user
would see as a slow first read. A paid instance stays awake.

## 3. Host the web app on Cloudflare Pages

1. In Cloudflare, go to **Workers & Pages**, create a **Pages** project with **Connect to Git**, and
   choose the repository.
2. Build settings:
   - **Framework preset:** none.
   - **Build command:** `pnpm install --frozen-lockfile && pnpm --filter @photo-to-chess/web build`
   - **Build output directory:** `apps/web/dist`
3. Environment variables:
   - `NODE_VERSION` = `24`
   - `VITE_RECOGNITION_URL` = the image reader's address from step 2, with no slash at the end
   - `VITE_SOURCE_URL` = the GitHub repository's address. It's shown as a source code link on the
     start screen.
   - If the build fails while installing before your build command runs, also set
     `SKIP_DEPENDENCY_INSTALL` = `1`. The build command installs dependencies itself.
4. Deploy. The address is shown when it's done, such as `https://photo-to-chess.pages.dev`. If it
   differs from what you put in `PTC_ALLOWED_ORIGINS`, update that variable on the image reader.

The `VITE_` settings are written into the files at build time, so changing one needs a new
deployment. `apps/web/public/_headers` sets caching and security headers on Cloudflare Pages and
Netlify. Other hosts need the same headers set in their own way, above all `Cache-Control: no-cache`
on `/sw.js`, or updates may not reach installed copies.

## 4. Check it

On a computer and on a phone:

- [ ] The start screen loads and shows the source code link.
- [ ] **Arrange a position by hand**, then start and play a few moves.
- [ ] Upload a screenshot of a digital board. It's read and the position check opens. If it says
      the reader isn't reachable, check `VITE_RECOGNITION_URL` and `PTC_ALLOWED_ORIGINS`.
- [ ] On a phone, **Take a photo** asks for camera permission.
- [ ] Play against the computer, and open the analysis.
- [ ] Change the **Pieces** menu, reload, and the choice is kept.
- [ ] Turn on flight mode and reload. Playing and analysing still work. Reading images doesn't, and
      says so.
- [ ] Optional: install it to the home screen from the browser's menu.

Photos of real boards stay hidden unless the address ends in `?photos=1`. Build with
`VITE_PHOTO_CORNERS` = `1` only once they've been tried on real boards.

## Privacy

Images are read in memory and never stored by the app. The host's logs still record each request's
time, address and query, such as tapped corners, but not the image. Say so in a privacy policy,
which the app stores will require.

## Updating

Pushing to `main` rebuilds both parts when the hosts are connected to GitHub. The service worker
picks up the new version of the web app on the next visit after it loads.
