/**
 * Cursor on shared MITM is intentionally not implemented.
 * Full Cursor agent host lives in the separate `cursor-local` subsystem
 * (dashboard → Cursor Local). Shared DNS MITM for Cursor must stay disabled
 * while cursor-local runs to avoid double-hijack.
 */
async function intercept(req, res) {
  res.writeHead(501, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: {
        message:
          "Cursor agent hosting is not handled by shared MITM. Use Dashboard → Cursor Local (cursor-local subsystem) instead, and disable Cursor DNS here.",
        type: "not_implemented",
        code: "use_cursor_local",
      },
    }),
  );
}

module.exports = { intercept };
