# BUONO Canvas

This repository contains BUONO Infinity Canvas, a shared drawing board for BUONO DESIGN STUDIO.

## Production

- GitHub repository: `comejernubb-prog/buonocanvas`.
- Cloudflare Workers project: `buonocanvas`.
- Production branch: `cloudflare-fresh-start`. Start implementation work from the latest commit on that branch.
- Live site: https://buonocanvas.comejernubb.workers.dev/
- Verified deployment baseline: `CF 1`, Git commit `90c6a66`. Check the live site and current branch head before relying on this baseline.
- Cloudflare builds from the repository root with `node cloudflare/build.mjs`, then deploys with `npx wrangler deploy`. Push to the production branch only when the task authorizes deploying.
- The Cloudflare workspace started empty by request. Do not import the old Railway data. GitHub stores source code; Cloudflare Durable Objects store the shared boards and original image files.
- `www.buonocanvas.com` is a desired custom domain. Its registration and connection were not confirmed.

## Code and verification

- `index.html` contains the canvas UI. `cloudflare/build.mjs` prepares the static assets and sets the visible Cloudflare release label. `cloudflare/workspace.mjs` implements the Worker and realtime sync. `wrangler.jsonc` configures the Worker and its bindings.
- Run `npm ci`, `npm test`, and `node cloudflare/build.mjs` before deploying changes. Use Wrangler for Cloudflare-specific local checks. For sync changes, verify persistence and updates across two sessions with disposable data. After deploying, check the Cloudflare build result, the live page, and `/health`. State which checks actually ran.
- Preserve original image bytes, cross-device sync, and support for opening the app directly. Keep Prompt as the default font and a small release label near the logo.

## Product context

- Keep the toolbar compact and light gray. Preserve mouse-wheel zoom, middle-button drag to pan, iPad pinch zoom, and zoom-to-fit.
- Keep plain text editing stable when entering and leaving edit mode. Text Blocks use separate editable title and body fields. They support individual text styling, images and GIFs, and Tab from title to body.
- Text Block connectors should preview while dragging, snap to top/right/bottom/left ports, and allow curve adjustment. BUONO Timeline's Project Hub is the interaction reference.
- Excalidraw is a reference for text interaction: https://github.com/excalidraw/excalidraw and https://github.com/excalidraw/excalidraw-mcp.
- Earlier requests included removing the standalone Sticky Note tool. Treat later, explicit feature requests as authoritative.
- The latest bug report from the separate Codex session was not available at handoff. Use the user's actual bug description or the corresponding PR as the implementation scope.
