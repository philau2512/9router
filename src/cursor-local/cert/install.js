/**
 * Install/uninstall cursor-local CA — reuses elevated patterns from shared MITM.
 * Uses own CN: "9Router Cursor-Local Root CA"
 */
const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");
const { promisify } = require("util");
const { DEFAULTS } = require("../config/defaults");
const { log, err } = require("../logger");

const execAsync = promisify(exec);
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const ROOT_CA_CN = DEFAULTS.caCommonName;

function getCertFingerprint(certPath) {
  const pem = fs.readFileSync(certPath, "utf-8");
  const der = Buffer.from(
    pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""),
    "base64",
  );
  return crypto
    .createHash("sha1")
    .update(der)
    .digest("hex")
    .toUpperCase()
    .match(/.{2}/g)
    .join(":");
}

async function checkCertInstalled(certPath) {
  if (!fs.existsSync(certPath)) return false;
  if (IS_WIN) {
    try {
      const fp = getCertFingerprint(certPath).replace(/:/g, "");
      await execAsync(`certutil -store Root ${fp}`, { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
  if (IS_MAC) {
    try {
      const fp = getCertFingerprint(certPath).replace(/:/g, "");
      const { stdout } = await execAsync(
        `security find-certificate -a -c "${ROOT_CA_CN}" -Z login.keychain-db 2>/dev/null || security find-certificate -a -c "${ROOT_CA_CN}" -Z /Library/Keychains/System.keychain 2>/dev/null`,
      );
      return new RegExp(`SHA-1 hash:\\s*${fp}`, "i").test(stdout || "");
    } catch {
      return false;
    }
  }
  // Linux: best-effort — treat as not installed
  return false;
}

async function installCert(certPath, sudoPassword) {
  if (!fs.existsSync(certPath)) {
    throw new Error(`Certificate not found: ${certPath}`);
  }
  if (await checkCertInstalled(certPath)) {
    log("CA already trusted");
    return { installed: true, already: true };
  }

  if (IS_WIN) {
    // Reuse elevated PowerShell helper from shared MITM
    const { runElevatedPowerShell, quotePs } = require("../../mitm/winElevated.js");
    const script = `
      certutil -delstore Root ${quotePs(ROOT_CA_CN)} 2>$null | Out-Null
      $exit = & certutil -addstore Root ${quotePs(certPath)} 2>&1
      if ($LASTEXITCODE -ne 0) { throw "certutil exit $LASTEXITCODE" }
    `;
    try {
      await runElevatedPowerShell(script);
      log("CA installed to Windows Root store");
      return { installed: true };
    } catch (e) {
      throw new Error(`Failed to install CA: ${e.message}`);
    }
  }

  if (IS_MAC) {
    const { execWithPassword } = require("../../mitm/dns/dnsConfig.js");
    const installLogin = `security add-trusted-cert -d -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db "${certPath}"`;
    try {
      if (sudoPassword) {
        await execWithPassword(installLogin, sudoPassword);
      } else {
        await execAsync(installLogin);
      }
      log("CA installed to macOS login keychain");
      return { installed: true };
    } catch (e) {
      err(`CA install mac failed: ${e.message}`);
      throw new Error(
        e.message?.includes("canceled")
          ? "User canceled certificate authorization"
          : `Certificate install failed: ${e.message}`,
      );
    }
  }

  throw new Error(
    "Linux CA auto-install not supported for cursor-local yet — trust the cert manually: " +
      certPath,
  );
}

async function uninstallCert(certPath, sudoPassword) {
  if (!(await checkCertInstalled(certPath))) {
    log("CA not in system store");
    return;
  }
  if (IS_WIN) {
    const { runElevatedPowerShell, quotePs } = require("../../mitm/winElevated.js");
    const script = `certutil -delstore Root ${quotePs(ROOT_CA_CN)} 2>$null | Out-Null`;
    await runElevatedPowerShell(script);
    log("CA removed from Windows Root store");
    return;
  }
  if (IS_MAC) {
    const { execWithPassword } = require("../../mitm/dns/dnsConfig.js");
    const cmd = `security delete-certificate -c "${ROOT_CA_CN}" ~/Library/Keychains/login.keychain-db 2>/dev/null || true`;
    if (sudoPassword) await execWithPassword(cmd, sudoPassword).catch(() => {});
    else await execAsync(cmd).catch(() => {});
    log("CA removed from macOS keychain (best-effort)");
  }
}

module.exports = {
  checkCertInstalled,
  installCert,
  uninstallCert,
  getCertFingerprint,
  ROOT_CA_CN,
};
