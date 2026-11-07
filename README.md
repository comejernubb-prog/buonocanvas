# buonocanvas v8 — Cloud Collaboration

Local-first visual whiteboard, upgraded to a **shared, authenticated cloud workspace**. The source is on GitHub; Railway deploys the web service. A Railway volume mounted at `/data` stores the SQLite database (`/data/buonocanvas.sqlite`) across restarts and deployments.

## Deployment

Docker image: `node:24-alpine` with Node built-in `node:sqlite` and a small RFC6455 WebSocket implementation (zero production npm dependencies). Run the service as **one replica only** because the database and live room state are process-local. Health endpoint: `GET /health`.

Required Railway environment variables (set in Railway Settings, **not** GitHub):

- `APP_PASSWORD`: shared team workspace access code, 12+ characters
- `SESSION_SECRET`: random secret, 32+ characters; changing it signs all devices out
- `NODE_ENV=production`

Volume: `buonocanvas-data`, attached to the service at `/data`. Set `DATA_DIR=/data` if your service does not supply the `RAILWAY_VOLUME_MOUNT_PATH` automatically.

## Collaboration protocol

- All devices authenticate using the same workspace code. Sessions are signed HttpOnly cookies with 30-day expiry.
- Each browser tab gets a distinct WebSocket actor ID. Server snapshots initialize canvases on connect; updates are sent via WebSocket using per-canvas / per-element deltas.
- Persistent SQLite holds boards, live element JSON, immutable revision counters (including deleted-object tombstones), and a lightweight audit trail.
- Editing different elements concurrently merges automatically at the **object level**.
- Editing the **same** element: a short, renewable 12-second in-memory edit lease is attempted at drag start. The server checks both lease and the base element revision atomically before committing. A conflicting edit is rejected, the client reloads the authoritative object, and the user sees a conflict message. **No silent last-writer-wins overwriting**.
- Text editing, grouping, images and arrows are synchronized as elements. Other devices see committed/streamed changes. Undo/Redo stacks remain per browser session; remote edits are rebased into local history so Ctrl+Z cannot erase someone else's objects.
- Presence (participant count, name) and live pointer positions are delivered over WebSocket; offline editing is paused on disconnect to avoid split-brain edits. Reconnect always resynchronizes from the server.

## Important limits

- One shared workspace password: **everyone with this secret can edit every canvas**; there are no per-user accounts or permission levels. Rotate secret in Railway when access should be revoked.
- A single Railway instance is required; not a high-availability multi-node CRDT deployment. Service redeploys may briefly disconnect collaborators.
- Embedded image data are stored in SQLite JSON. Each image/element payload is capped at **8 MB**; WebSocket messages max **16 MB**. For large architectural image boards, migrate assets to object storage.
- The access code should be shared securely, not committed to the repository.
- Protect `/data/buonocanvas.sqlite` using Railway volume backups. A volume survives deployments but a single volume is not itself a separate offsite backup.
- This build intentionally starts with a **new cloud dataset**; legacy localStorage boards are not migrated.

## Local testing

```bash
APP_PASSWORD='replace-with-12-plus-characters' SESSION_SECRET='replace-with-32-plus-characters' DATA_DIR=./data npm start
```

Open `http://localhost:3000`, enter your access code, and open another browser / private context to collaborate. All device-specific pan and zoom positions remain local; canvas objects, titles, backgrounds and grid are shared.


## v10 — Smooth Bézier connector editing

- There is **one Arrow tool**. No separate Straight/Bent mode and no floating connector-mode menu or editor hint.
- Draw an arrow normally, then **double-click the arrow line** to enter curve-edit mode.
- The connector is rendered as three continuously joined **cubic Bézier** segments through two draggable inner knots.
- Drag either large inner knot to bend the stroke into an arc or S-curve, or drag the stroke itself to move the nearest knot.
- Four small violet tangent handles let you refine curvature. Dragging one mirrors its opposite handle, maintaining a smooth join.
- Start/end anchors remain attached to shapes and images; arrowheads follow the terminal curve's tangent.
- Existing v9 arrow data remains readable. Previously saved bend points now render as smooth curves. Existing cloud/database/WebSocket protocol is unchanged; optional per-object `curveTangents` are persisted within the current JSON schema.
- Editing works at browser zoom levels using screen-space hit detection; SVG export retains Bézier geometry. Undo/Redo preserves node and tangent edits.

Validation: Node JavaScript syntax check and automated Chromium pointer tests for double-click activation, knot drag, tangent drag, direct-line drag, moving attached objects, and hiding the removed UI.

## v11 — Compact single-row toolbar and shared connector editor

- The drawing toolbar now sits **inside the top header** on the same row as the menu, compact infinity logo, cloud status, and actions. The canvas starts directly below a **40px header**; no separate floating toolbar or extra logo strip. Narrow displays can horizontally scroll the toolbar.
- Arrow and Line are now both editable **smooth cubic Bézier connectors**.
- Newly drawn arrows and lines have **one editable midpoint knot** (initially collinear, so visually straight). Drag this midpoint to curve the connector immediately.
- **Double-click the stroke** (or its selected midpoint) to insert a second knot. Afterward, both knots and their mirrored tangent handles can be dragged to create continuous S-curves. No separate Straight/Bent selector.
- Lines retain the same stroke editing behavior as arrows, but **render circular endpoint markers at both ends** instead of an arrowhead.
- Both types can snap endpoint bindings to shape/image ports, keep connections on object movement, and retain knot geometry through cloud sync.
- Existing older documents with 0 or 2 stored bends remain readable; this is a front-end-only change and leaves the SQLite/WebSocket backend, sessions, and Railway volume untouched.

Testing performed: JavaScript syntax validation and browser interaction checks for desktop toolbar layout, Arrow and Line midpoint drags, double-click adding a second knot, tangent editing, endpoint circles, and responsive layout code review.
