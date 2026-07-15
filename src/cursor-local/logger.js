const fs = require("fs");
const { PATHS, ensureDirs } = require("./paths");

function ts() {
  return new Date().toISOString();
}

function write(level, msg) {
  const line = `${ts()} [${level}] ${msg}`;
  try {
    ensureDirs();
    fs.appendFileSync(PATHS.logFile, `${line}\n`);
  } catch {
    /* ignore disk errors */
  }
  // File only by default — avoids double lines when manager redirects stdout→log
  // Set CURSOR_LOCAL_LOG_STDOUT=1 to also print
  if (process.env.CURSOR_LOCAL_LOG_STDOUT === "1") {
    if (level === "ERROR") console.error(line);
    else console.log(line);
  } else if (level === "ERROR") {
    console.error(line);
  }
}

module.exports = {
  log: (msg) => write("INFO", msg),
  warn: (msg) => write("WARN", msg),
  err: (msg) => write("ERROR", msg),
  debug: (msg) => {
    if (process.env.CURSOR_LOCAL_DEBUG === "1") write("DEBUG", msg);
  },
};
