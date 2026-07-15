/**
 * StartProxy equivalent (cursor-byok order):
 * backend → inject auth → MITM proxy → CA install → settings apply
 */
const { loadConfig } = require("../config/loadConfig");
const { createBackendServer } = require("../backend/server");
const { createMitmProxy } = require("../mitm/proxy");
const { generateRootCA } = require("../cert/generate");
const { installCert, checkCertInstalled } = require("../cert/install");
const { applyProxySettings } = require("../inject/settings");
const { injectCursorUserInfo } = require("../inject/stateDb");
const { PATHS, ensureDirs } = require("../paths");
const { log, err } = require("../logger");
const fs = require("fs");

let runtime = {
  backend: null,
  mitm: null,
  config: null,
  state: {
    running: false,
    ready: false,
    backendRunning: false,
    proxyRunning: false,
    certTrusted: false,
    settingsApplied: false,
    authInjected: false,
    lastError: null,
    phase: "C",
  },
};

async function waitHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
      lastErr = new Error(`status ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`backend health timeout: ${lastErr?.message || "unknown"}`);
}

async function startLifecycle(options = {}) {
  ensureDirs();
  const config = loadConfig();
  runtime.config = config;
  runtime.state.lastError = null;

  const fail = async (step, e) => {
    err(`start failed step=${step}: ${e.message}`);
    runtime.state.lastError = `${step}: ${e.message}`;
    try {
      await stopLifecycle({ silent: true });
    } catch {
      /* ignore */
    }
    throw e;
  };

  try {
    // 1. CA
    generateRootCA();

    // 2. Backend
    runtime.backend = createBackendServer({
      backendListenAddr: config.backendListenAddr,
    });
    await runtime.backend.start().catch((e) => fail("start_backend", e));
    runtime.state.backendRunning = true;
    await waitHealth(
      `http://${config.backendListenAddr}/healthz`,
    ).catch((e) => fail("wait_backend", e));
    log("backend ready");

    // 3. Inject auth (fail-open like byok)
    try {
      injectCursorUserInfo(config.injectAccountEmail, config.injectAuthToken);
      runtime.state.authInjected = true;
    } catch (e) {
      err(`inject auth (non-fatal): ${e.message}`);
      runtime.state.authInjected = false;
    }

    // 4. MITM proxy
    runtime.mitm = createMitmProxy({
      proxyListenAddr: config.proxyListenAddr,
      backendListenAddr: config.backendListenAddr,
    });
    await runtime.mitm.start().catch((e) => fail("start_mitm", e));
    runtime.state.proxyRunning = true;

    // 5. Install CA (may prompt UAC)
    try {
      const result = await installCert(PATHS.caCert, options.sudoPassword);
      runtime.state.certTrusted =
        result?.installed || (await checkCertInstalled(PATHS.caCert));
    } catch (e) {
      await fail("install_ca", e);
    }

    // 6. Cursor settings + NODE_EXTRA_CA (hard fail like byok)
    try {
      applyProxySettings(config.proxyListenAddr, PATHS.caCert);
      runtime.state.settingsApplied = true;
    } catch (e) {
      await fail("apply_settings", e);
    }

    runtime.state.running = true;
    runtime.state.ready = true; // full activation complete (manager waits on this)
    writeRuntimePid();
    runtime.state.phase = "C";
    log("cursor-local start completed (phase C agent host)");
    return getLifecycleStatus();
  } catch (e) {
    if (!runtime.state.lastError) runtime.state.lastError = e.message;
    throw e;
  }
}

function writeRuntimePid() {
  ensureDirs();
  const payload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    backendListenAddr: runtime.config?.backendListenAddr,
    proxyListenAddr: runtime.config?.proxyListenAddr,
    state: { ...runtime.state, phase: runtime.state.phase || "C" },
  };
  fs.writeFileSync(PATHS.pid, `${JSON.stringify(payload, null, 2)}\n`);
}

async function stopLifecycle(options = {}) {
  const config = runtime.config || loadConfig();
  const silent = !!options.silent;

  if (runtime.mitm) {
    try {
      await runtime.mitm.stop();
    } catch (e) {
      if (!silent) err(`stop mitm: ${e.message}`);
    }
    runtime.mitm = null;
    runtime.state.proxyRunning = false;
  }

  if (config.restoreSettingsOnStop !== false) {
    try {
      const { clearProxySettings } = require("../inject/settings");
      clearProxySettings();
      runtime.state.settingsApplied = false;
    } catch (e) {
      if (!silent) err(`clear settings: ${e.message}`);
    }
  }

  if (config.restoreAuthOnStop !== false && runtime.state.authInjected) {
    try {
      const { restoreCursorUserInfo } = require("../inject/stateDb");
      restoreCursorUserInfo();
      runtime.state.authInjected = false;
    } catch (e) {
      if (!silent) err(`restore auth: ${e.message}`);
    }
  }

  if (runtime.backend) {
    try {
      await runtime.backend.stop();
    } catch (e) {
      if (!silent) err(`stop backend: ${e.message}`);
    }
    runtime.backend = null;
    runtime.state.backendRunning = false;
  }

  runtime.state.running = false;
  runtime.state.ready = false;
  try {
    if (fs.existsSync(PATHS.pid)) fs.unlinkSync(PATHS.pid);
  } catch {
    /* ignore */
  }
  if (!silent) log("cursor-local stop completed");
  return getLifecycleStatus();
}

function getLifecycleStatus() {
  return {
    running: runtime.state.running,
    ready: !!runtime.state.ready,
    pid: process.pid,
    backendListenAddr: runtime.config?.backendListenAddr || null,
    proxyListenAddr: runtime.config?.proxyListenAddr || null,
    backendRunning: runtime.state.backendRunning,
    proxyRunning: runtime.state.proxyRunning,
    certTrusted: runtime.state.certTrusted,
    settingsApplied: runtime.state.settingsApplied,
    authInjected: runtime.state.authInjected,
    lastError: runtime.state.lastError,
    phase: runtime.state.phase || "C",
  };
}

module.exports = {
  startLifecycle,
  stopLifecycle,
  getLifecycleStatus,
};
