# buonocanvas v13 — Drawing, image and export upgrade

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

# buonocanvas v12 — Original-image fidelity, vector PDF, editable line thickness

A minimalist real-time shared infinite canvas. Source: GitHub; deployment: Railway; boards: SQLite on the attached `/data` persistent volume; live collaboration: WebSocket with object revisions.

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
