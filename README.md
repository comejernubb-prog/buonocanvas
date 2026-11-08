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
