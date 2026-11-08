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

No card is needed for the free plan, but expect two problems, both seen on the live service:

- **It didn't wake from sleep.** It spun down after 15 idle minutes and then gave no answer for
  almost 5 minutes when called, twice, with no startup in its logs and no incident on Render's status
  page. The cause isn't known. A **Manual Deploy** brings it back.
- **A tenth of a CPU is too little for the screenshot reader on a photo,** which ran past the
  20-second limit. With marked corners, the same photo took 2.3 seconds.

1. **New**, then **Web Service**. For a public repository, **Public Git Repository** with its
   address needs no GitHub app, but then Render doesn't redeploy on push: use **Manual Deploy** after
   updates. **Git Provider** connects GitHub and redeploys automatically.
2. **Language** Docker, **Branch** `main`, **Region** the one nearest your users, **Root directory**
   `services/vision`. The Dockerfile path can stay empty, as it defaults to the one in that folder.
3. **Instance type:** Free. Render preselects a paid plan, so check this.
4. **Environment variable** `PTC_ALLOWED_ORIGINS` as above. Under **Advanced**, **Health check path**
   `/healthz`.

The service's address is `https://<name>.onrender.com`. The free plan sleeps after about 15 minutes
without use, and waking it takes up to a minute, which a user sees as a slow first read. It also
has a tenth of a CPU, so reading takes a few seconds. A paid instance stays awake and is faster.

### Hugging Face Spaces, paid

Docker Spaces need a paid plan (PRO). As of November 2026 only Static Spaces are free.

1. Create a new **Space**: SDK **Docker**, blank template, visibility Public.
2. Add the two files from `deploy/huggingface` to the Space. They install the service from GitHub, so
   the Space needs no code or models of its own. Change the repository address and
   `PTC_ALLOWED_ORIGINS` in the Dockerfile if yours differ.
3. When it's built, the address is `https://<user>-<space>.hf.space`. Use it for
   `VITE_RECOGNITION_URL` in step 3. After changing the service, use **Factory rebuild** in the
   Space's settings to pick up the latest `main`.

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
   - `SKIP_DEPENDENCY_INSTALL` = `1`. Required: without it, Cloudflare finds the top-level
     `pyproject.toml`, which only holds tool settings, tries `pip install .`, and the build fails.
     The build command installs the web app's dependencies itself.
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
