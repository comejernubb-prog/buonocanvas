# buonocanvas v14 — Excalidraw-style arrows

## v14 changes (arrows & lines)

Arrows and lines were rebuilt on the model of Excalidraw's linear elements. **Arrowhead styles (none, open, triangle, dot, ring, diamond, bar) and the exact stroke-width controls are unchanged.**

- **Binding to shapes**: an end binds to any shape it is dropped on or near (≈16 px). The arrow end sits on the shape's real outline (rectangle, ellipse, diamond, triangle, note, text, image) with a 5 px gap, on the line from the bind point towards the next point, so arrows always *point at* the shape and slide around its outline when either shape moves. The target shows a highlighted outline and a focus dot while you drag.
- **Precise ("inside") binding**: keep the pointer still deep inside a shape for 0.7 s and the end pins exactly to that point (filled focus dot).
- **Multi-point drawing**: drag to draw a two-point arrow, or click to start, click to add points, and finish with Enter, Esc, a double-click, a click on the last point or a click onto a shape.
- **Editing**: every point has a handle; drag the small ○ between two points to insert one; double-click a point to remove it; double-click the line to add a point there. Ends rebind/unbind as you drag them.
- **Arrow types**: Sharp (straight segments), Curved (smooth curve through the points) and Elbow (orthogonal routing out of the bound sides, snapping to side midpoints), switchable from the floating stroke bar or the Inspector. New arrows default to Curved, new lines to Sharp.
- **Modifiers**: Shift locks the segment to 0° · 45° · 90° (dashed guide + angle chip); Ctrl/Cmd or Alt draws without binding.
- **Compatibility**: v12/v13 arrows (x/y/w/h + bends + 8-port anchors) render and bind as before (ports become outline bindings aimed at the same spot) and are only converted to the new point list when you edit them; nothing is rewritten just by opening a board. Old Bézier tangent handles are dropped when a curved legacy arrow is edited; it becomes a smooth curve through the same points.
- Arrow labels and elbow-segment dragging (both in Excalidraw) are not implemented yet.

---

# buonocanvas v13 — Drawing, image and export upgrade + touch/Pencil input, stable sessions, Excalidraw-style notes and text

A minimal architecture-first infinite canvas with live collaboration, original image asset storage, SVG/PNG/PDF export and a SQLite cloud workspace on Railway. v13 is an incremental upgrade based on reviewing Excalidraw's publicly available implementation, not a replacement of the BUONOCANVAS engine.

## v13 capabilities

| Group | Capabilities |
| --- | --- |
| A1 | Solid/dashed/dotted stroke; configurable dash length, spacing, line cap and line join |
| B1 | Independent source/target arrowhead styles: none, open arrow, triangle, dot, ring, diamond, bar |
| B2/B3 | Adaptive curved connector hit testing; preserve two-knot Bézier editing and the eight-port shape binding model |
| C1 | Original byte-preserving multiple-image imports for the supported formats; never resample originals on upload |
| C2 | Non-destructive percentage crop, 0/90/180/270-degree rotation and horizontal/vertical flip |
| C3 | Cull images far outside the viewport; original assets remain privately cacheable |
| D1 | Entire canvas, current viewport or selected elements; adjustable margin and transparency for raster/SVG |
| D2 | 1×/2×/4× bitmap export presets capped at 16,384 px per side / 32 megapixels for browser safety |
| D3 | Native vector strokes, arrowheads and shapes in direct PDF; Unicode ActualText annotations for raster glyphs; browser Print PDF option for selectable text when the print engine and fonts support it |
| D4 | Editable PNG with versioned iTXt JSON metadata: import the PNG again to recreate editable canvas elements |
| E1 | Independent v13 geometry/PNG module, backup module, smoke tests and automated GitHub CI |
| E2 | Daily rotating SQLite snapshots on /data, plus an authenticated full tar.gz archive of the database AND all original asset bytes |

### Data integrity and backup

- **Production data is preserved.** The app continues to use one SQLite database at `/data/buonocanvas.sqlite` and SHA-256 original assets under `/data/assets`. No destructive data migration is needed.
- **Download Full Backup** in the Export dialog produces an authenticated `.tar.gz` containing the consistent SQLite snapshot, `assets/` directory and a `manifest.json`. Store the downloaded file **outside Railway**. The automatic `/data/backups/snapshot-YYYY-MM-DD.sqlite` copies are kept for up to seven days but are on the **same** persistent volume; they are NOT offsite backups and contain only the database.
- Download or print a PDF for finished handoff. For the most dependable text selection and Thai font embedding, choose **Print PDF**, then select Save as PDF in a modern browser. The direct-download PDF preserves existing glyph appearance as raster images and adds accessibility ActualText metadata; not all PDF viewers use this for text selection.
- **Editable PNG is not an offline image archive.** It embeds the editable board structure with asset URLs referencing the current authenticated BUONOCANVAS server. The recipient must have access to those assets. Use Full Backup to preserve every original image byte; use `.buonocanvas.json` as an additional editable scene backup.
- A PNG edited, recompressed or processed by another application may lose its editability metadata. This is a deliberate opt-in export; avoid embedding confidential canvas data in publicly shared images.

### Deployment and verification

- Railway service `buonocanvas-github` tracks GitHub `main`, Dockerfile builds with Node 24, and attaches the existing `/data` volume.
- All migrations are additive in the object model. Existing `boards` and `elements` tables remain unchanged.
- Run `npm test` for authentication, original bytes, backup and vector PDF smoke tests plus image geometry and editable PNG validation.
- Changes must pass CI before merging to `main`.

---


A minimalist real-time shared infinite canvas. Source: GitHub; deployment: Railway; boards: SQLite on the attached `/data` persistent volume; live collaboration: WebSocket with object revisions.

## v13.1 changes

- **Sticky notes (Excalidraw design)**: square 250 px warm-yellow paper (`#FFDF6B`; pink, green, blue, orange picks), 4% corner radius, hard 3 px shadow at 16% plus hairline edge, centred label auto-fitted from the chosen size (default 28) down to 16 px, and a creation-date footer ("9 Nov"). Click to place, or drag to size it; typing starts immediately. Corner-resizing keeps it square and scales the text (Shift resizes freely); the note grows taller when text no longer fits.
- **Text (Excalidraw behaviour)**: new text is auto-width (grows while typing, no wrapping) until you drag a side handle, which fixes the width and wraps; corners scale the type. Double-click empty canvas to add text, double-click / Enter on a rectangle, diamond, ellipse or triangle to add a centred label, Enter edits the selected text/note. Esc or Ctrl/Cmd+Enter **finishes** editing (it no longer discards). Left / centre / right alignment in the text bar. Labels and note footers are exported to PDF.
- **Shift axis lock**: drawing a line/arrow or dragging its end with Shift locks to 0° / 45° / 90°, shows a dashed guide and an angle chip, skips port snapping and keeps a straight connector straight. Shift-dragging objects moves them along one axis.
- **Middle mouse + wheel**: middle-drag panning is incremental with a 4 px start threshold and ignores movement while the wheel is spinning, so pressing the wheel while scrolling no longer makes the view jump. Wheel device (mouse vs trackpad) is decided once per scroll burst so a fast scroll can't flip between zoom and pan.
- Contextual hints under the toolbar (as in the reference).

## v13 changes

**Input (mouse, trackpad, Apple Pencil)**
- **Wheel / trackpad**: pinch-to-zoom (Chrome/Edge/Firefox send it as Ctrl+wheel, Safari as gesture events), **two-finger scroll pans**, a **mouse wheel zooms** (Shift+wheel pans sideways), Ctrl/Cmd+scroll always zooms. Zoom range 10%–800%. Pan/zoom is local-only and no longer triggers a cloud sync.
- **Apple Pencil / touch**: `touch-action: none` + callout/selection suppression. Once a Pencil is seen, the Pencil draws/selects, **one finger pans** (a quick tap still selects) and **two fingers pinch-zoom**; a finger touching while the Pencil is busy is ignored (palm rejection). Without a Pencil, a finger acts like a mouse, and a second finger cancels the stray stroke and pinches. The Pencil's eraser button erases.
- **Pencil tool stays active** after each stroke (no more switching back to Select), strokes use high-rate coalesced samples, are simplified/rounded before saving and are rendered smoothed. Pressure sensitivity is *not* implemented (strokes have a single width).

**Arrows**
- The head direction is taken from the actual curve one head-length behind the tip instead of the last Bézier handle, so it always points along the line and no longer twitches.
- Port snapping has hysteresis (acquire at 14 px, release at 24 px; larger for touch/pen) instead of a constant 24 px grab, so the tip no longer feels "sticky". Hold **Alt** to disable snapping.
- Handles keep their look but have much larger invisible hit areas (16 px mouse / 24 px touch & pen; arrow body 14/22 px), which was the main cause of "missing" a node and losing the selection.

**Stability**
- Server: unhandled errors from an aborted upload used to crash the process (verified against v12). All requests are now guarded, plus graceful SIGTERM shutdown, WebSocket heartbeat (server ping every 20 s, 60 s reaper; client ping + wake-up check after the tab/iPad sleeps), `synchronous=NORMAL` (still durable across process crashes in WAL mode), audit-table trimming, tolerant reads of unreadable rows, and correct remote-lock release.
- Client: a dropped connection no longer blocks the UI or wipes the selection. A small banner shows "Reconnecting…", edits made offline are re-applied on top of the fresh server copy on reconnect (server wins only for objects someone else changed), selection is kept, and undo history is kept unless the board changed remotely. Conflict reloads also keep the selection. Reconnect uses exponential backoff.

**Performance**
- `index.html` and `pdf-vector.js` are pre-compressed (brotli/gzip) with ETag/304.
- Rendering is incremental: per-element DOM cache, only changed objects are re-parsed, pan/zoom only changes one transform, inspector/board list skip identical re-renders.

**Sticky notes**: rounded card, layered soft shadow, hairline border, word-wrapped text (Prompt 500), pastel colour rotation + colour row in the Inspector, auto-grow height when the text is longer than the card, PDF export matches. Notes no longer use the stroke thickness controls.

---

# buonocanvas v12 — Original-image fidelity, vector PDF, editable line thickness

## v12 changes

- **Exact thickness**: contextual stepper `−  [number] px  +` changes stroke width on selected Arrow, Line, Rectangle, Diamond, Ellipse, Triangle, Pencil and Note; applies to all selected drawable shapes. Works for new shapes via the active tool's default thickness. Supported range: **0.5–48 canvas px**, increments **0.5 px**. The Inspector has the same numeric stepper. Stroke widths remain stored per object and synchronized between collaborators.
- **Original-image storage**: new JPEG, PNG, WebP, GIF and AVIF files (when browser can decode them) are saved to `/data/assets` as **unchanged original byte sequences**, keyed by SHA-256 hash. **No resizing, resampling, quality reduction or transcoding on ingest**, including drag/drop and copy/paste (the OS/browser controls what bytes a clipboard paste actually supplies). Server accepts up to **50 MiB per image** and returns an explicit error otherwise instead of silently degrading images. The image's visual display size inside a board remains editable independently of its native resolution.
- **Image sharing**: Canvas JSON stores a small authenticated `/api/assets/<sha>.<ext>` reference rather than a large embedded base64 string. Other authorized browsers fetch the same exact file. Download original returns the stored bytes and retains source format. Legacy data-URL images are still rendered but the previous reduced images **cannot** be retroactively restored.
- **JPEG export**: exports the selected scope at **up to 4096 px on the longest side**, using quality **0.90** and max 2× the design-space pixel size. This intentionally optimizes the **export** file size; it does *not* change the originals retained in Cloud assets.
- **PDF export**: a browser-side native PDF writer emits **real vector path commands** (`m`, `l`, `c`, `re`, `S`, `B`, etc.) for rectangles, ellipse, triangle, arrows/lines and cubic Bézier paths. JPEG images embed the same original JPEG encoded bytes in an `/Image` XObject (DCTDecode). PNG/WebP/GIF/AVIF are rendered *losslessly* into FlateDecode image XObjects; animated images use their current still frame. Text is drawn into a high-resolution transparent image so its original Prompt/Thai appearance does not require shipping font binaries—**text is raster in PDF; drawing strokes and shapes are vector**. For editable text, use the canvas's JSON export or SVG when supported by the consumer.
- **SVG export**: reference images are included as original bytes in data URLs, so the file remains portable and can be opened offline.
- **Triangle tool**: a simple triangle vector shape, customizable in the same way as other geometry.

## Deployment

Single Railway replica, `node:24-alpine`, zero external production dependencies. Requires:

- `APP_PASSWORD`: existing access code, minimum 8 characters (do **not** commit it to GitHub)
- `SESSION_SECRET`: at least 32 characters (keep existing value)
- `NODE_ENV=production`
- `DATA_DIR=/data` and persistent Railway volume at `/data` (keep existing data, do not detach/replace)

Endpoints: `GET /health`, `POST /api/login`, `GET /api/session`, authenticated `POST /api/assets` and authenticated `GET /api/assets/<sha>.<ext>`, WebSocket `/ws`.

**Security**: an authenticated session cookie is required to upload/download images; uploads validate the Origin, constrain payload size, inspect magic bytes, and use immutable SHA-256 filenames. The shared workspace password provides the same access to all boards and assets. The 500 MB volume is finite and is **not** an independent offsite backup. Configure Railway volume backups separately. Large-image uploads may exhaust it; the app rejects failures explicitly instead of altering the original file.

**Format limits**: 50 MiB maximum per asset; image export bounded to 4096 px JPEG; PDF non-JPEG image conversion has a browser-memory safety ceiling of ~35 megapixels. For unusually large projects, prefer original image downloads and vector SVG export. PDF viewer image decoding depends on supported formats and browser capabilities. Modern browsers with `CompressionStream('deflate')` are required to export PDFs containing non-JPEG photos or rendered text.

## Verification performed

- `node --check` for server, front-end script and PDF writer.
- Local Node HTTP API: authorization, same-origin validation, raw upload and readback; SHA-256 of a 3600×2200 JPEG was identical before and after the server upload.
- PDF writer: generated native vector PDF; inspected via PyMuPDF and confirmed vector drawing commands and embedded JPEG XObject with **byte-identical original JPEG payload**.
- Automated full-browser UI tests were **not available** in this container because Chromium is configured with a managed `URLBlocklist: ["*"]` policy. Perform a two-device manual acceptance check after deployment.


### Selection hit priority for overlapping connectors

When an Arrow/Line runs across or close to a free Text Box, clicking inside the text's on-screen layout box selects the **text**, even if the connector's invisible SVG hit stroke or an editing handle is on top. The selection test is performed in world coordinates, so it works at different pan/zoom levels and on touch devices. Shapes/images on top retain their normal stacking behavior. Click an uncovered part of the connector to select and edit the line. No document, database, or sync format changes are required. Regression coverage: `tests/hit-testing.test.mjs`.

## v15 — Reconnect reliability, Prompt typography, responsive rendering

**Problems addressed**
- A `Reconnecting…` bubble used to cover the top toolbar, especially on narrow displays.
- iPad/Safari background-tab wake-ups used a four-second ping timeout and could falsely close healthy WebSocket sessions.
- Every pointermove rebuilt the canvas inspector, board list, text controls, stroke controls, and hints even when only the viewport moved.
- Google Fonts was fetched from a third-party host at runtime, producing a fallback font when blocked/unavailable.

**Changes**
- Prompt (Thai and Latin glyphs, weights 300–800) is installed from the OFL-1.1 licensed `@fontsource/prompt` package at build time and served by the **same Railway origin** under `/fonts/`. Browser font requests are cacheable.
- The connection indicator lives near the **bottom-left**, is non-interactive, and appears only if a reconnect takes longer than 1.8 seconds. It never obscures drawing tools.
- Browser WebSocket lifecycle is visibility-aware with an extended wake-up grace period, adaptive backoff and a guard against duplicate connection attempts.
- The UI now paints the SVG each animation frame but batches expensive sidebar/inspector rebuilds. Image culling work is also throttled while panning/pinching.
- Slow-client cursor data is discarded instead of piling up; important board edits are still sent and checked using object revisions.
- Lost save acknowledgements trigger a full reconnect and safe revision-based replay rather than leaving the queue permanently stuck.
- Authenticated `GET /api/diagnostics` exposes uptime, active connections and backpressure counters without revealing content or secrets.

**Verification**
- The Docker build runs the complete test suite **twice** before allowing a Railway deployment.
- Tests cover authentication, database/image backup, original image bytes, PDF vector structures, Prompt WOFF2, client reconnect/visibility handling, throttled UI frame work, and an actual two-peer WebSocket editing/reconnect scenario.
- Production remains a **single Railway replica** attached to the original `/data` volume; no database schema migration or record deletion is performed.

**Operational limits**
- Network interruptions cannot be eliminated. Pending edits are retained in the **current open browser tab** and replayed after reconnect; do not close the tab while offline.
- Tests in the deployment environment do not replace physical device checks on every version of Windows, macOS and iPadOS.

## v16 — Smart Hand navigation and fluid viewport

- Hand is the **default active tool**. Left-dragging empty canvas begins panning immediately.
- On mouse / pen hover near an object (within about 8 screen px), cursor switches to selection and left-dragging moves/selects that object. Clicking uncovered canvas keeps the grab cursor and pans; explicit Selection (V) is still available for marquee selection.
- Text selection takes precedence over overlapping arrow hit areas, including while Hand is active.
- **Middle-button pan starts at the first pixel** even immediately after rotating the scroll wheel. No four-pixel dead zone and no 300-ms wheel lockout.
- Wheel input is coalesced per animation frame; cursor-centered zoom preserves the world-coordinate point beneath the mouse.
- View-only pan/zoom updates the **SVG camera transform** without rerendering or culling every image and shape every frame. A complete scene recull happens after a brief idle interval.
- On iPad, a finger drags the canvas, a quick tap selects an object, two-finger pinch zooms, while Apple Pencil remains a precision pointer. Explicit drawing tools remain distinct.
- Panning does not trigger an unnecessary full database diff.
- No changes to saved drawings, authentication, WebSocket protocol, SQLite schema, original image bytes, or Railway persistent storage.

**Tests:** Node regression tests cover hover proximity, cursor defaults, text-first selection, camera-only render and removed middle-button freeze. Headless Chromium drives actual left-/middle-button drags, wheel zoom center anchoring, and object selection before deployment.
