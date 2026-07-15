function healthHandler(_req, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      service: "cursor-local",
      pid: process.pid,
      phase: "C+",
      features: [
        "mocks",
        "bidi",
        "run_sse",
        "tools",
        "modes",
        "compaction",
        "byok-prompts",
        "tab-stub",
        "telemetry-ack",
      ],
    }),
  );
}

module.exports = { healthHandler };
