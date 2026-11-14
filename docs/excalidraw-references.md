# Excalidraw references for BUONO Canvas

- [Excalidraw](https://github.com/excalidraw/excalidraw) is the primary reference for canvas interaction.
- [Excalidraw MCP](https://github.com/excalidraw/excalidraw-mcp) is the reference for tool-driven diagram generation and delivery. Its package depends on Excalidraw for interactive editing.

## Text tool

[Upstream WYSIWYG editor](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/wysiwyg/textWysiwyg.tsx) positions a textarea over the canvas. It focuses without scrolling, updates the editor geometry with zoom, and cleans up the editor before submission. Escape and Ctrl/Cmd+Enter submit. The keyboard handler accounts for IME composition.

BUONO Canvas keeps its own document format and uses an overlay textarea. A new text draft only becomes a canvas element once submitted with nonblank text. When reviewing changes, verify click-to-type, outside-click submission, keyboard submission, reopening existing text, IME input, and zoom during editing in a browser.
