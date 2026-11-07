# buonocanvas v7

Minimal, local-first visual whiteboard by BUONO Design Studio.

## Source of truth

GitHub `main` should be the canonical source; Railway deploys from this repository. The previous Railway Function should be retired **only after** the GitHub-backed service is healthy.

## Run locally

```bash
node server.mjs
# http://localhost:3000
```

## Deploy on Railway

1. Create a private repository named `buonocanvas` on GitHub.
2. Commit all repository files (`index.html`, `server.mjs`, `package.json`, `Dockerfile`, etc.) on the `main` branch.
3. On Railway select New Service → GitHub Repo → your private `buonocanvas` repository, and choose `main`.
4. Railway automatically uses the root `Dockerfile` to build and run the service; the server listens on `PORT` and `0.0.0.0`.
5. Set the healthcheck path to `/health`. Generate a public Railway domain or attach an existing domain after verifying it is free.
6. Verify `GET /` returns `buonocanvas` and `GET /health` returns `OK`.
7. When the new deployment is **SUCCESS**, switch the desired public domain and remove the old Railway Function.

## Data storage and access

This version saves boards in browser `localStorage`, **not** in GitHub or a Railway database. The application is publicly viewable to anyone who has the URL; it does not have user authentication or cloud sync. No previous browser data needs migrating.

## Keyboard shortcuts

`Ctrl+G` group, `Alt+G` or `Ctrl+Shift+G` ungroup; these use physical keyboard key codes for Thai/English layout independence. Select an arrow and choose **Bent** to expose two bend handles.

## Deploy safety

Never store passwords, API secrets, or private board exports in this repository. The HTML pulls Google Prompt via Google Fonts; internet access is required for the font to download on a fresh browser.
