/**
 * Root CA + leaf certs for cursor-local MITM (distinct CN from shared MITM).
 */
const fs = require("fs");
const forge = require("node-forge");
const { PATHS, ensureDirs } = require("../paths");
const { DEFAULTS } = require("../config/defaults");
const { log } = require("../logger");

function isCertExpired(certPath) {
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(certPath, "utf8"));
    const threshold = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return cert.validity.notAfter < threshold;
  } catch {
    return true;
  }
}

function generateRootCA() {
  ensureDirs();
  const exists =
    fs.existsSync(PATHS.caKey) && fs.existsSync(PATHS.caCert);
  if (exists && !isCertExpired(PATHS.caCert)) {
    return { key: PATHS.caKey, cert: PATHS.caCert };
  }
  if (exists) {
    try {
      fs.unlinkSync(PATHS.caKey);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(PATHS.caCert);
    } catch {
      /* ignore */
    }
  }

  log("Generating Cursor-Local Root CA...");
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: "commonName", value: DEFAULTS.caCommonName },
    { name: "organizationName", value: DEFAULTS.caOrg },
    { name: "countryName", value: "US" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  fs.writeFileSync(PATHS.caKey, forge.pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(PATHS.caCert, forge.pki.certificateToPem(cert));
  log("Root CA ready");
  return { key: PATHS.caKey, cert: PATHS.caCert };
}

function loadRootCA() {
  if (!fs.existsSync(PATHS.caKey) || !fs.existsSync(PATHS.caCert)) {
    throw new Error("Cursor-Local Root CA missing — generate first");
  }
  return {
    key: forge.pki.privateKeyFromPem(fs.readFileSync(PATHS.caKey, "utf8")),
    cert: forge.pki.certificateFromPem(fs.readFileSync(PATHS.caCert, "utf8")),
    keyPem: fs.readFileSync(PATHS.caKey, "utf8"),
    certPem: fs.readFileSync(PATHS.caCert, "utf8"),
  };
}

function generateLeafCert(domain, rootCA) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Math.floor(Math.random() * 1e9).toString();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  cert.setSubject([{ name: "commonName", value: domain }]);
  cert.setIssuer(rootCA.cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true,
    },
    { name: "extKeyUsage", serverAuth: true, clientAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: domain },
        { type: 2, value: `*.${domain}` },
      ],
    },
  ]);
  cert.sign(rootCA.key, forge.md.sha256.create());
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}

const leafCache = new Map();

function getCertForDomain(domain) {
  const host = String(domain || "")
    .split(":")[0]
    .toLowerCase();
  if (!host) return null;
  if (leafCache.has(host)) return leafCache.get(host);
  try {
    const root = loadRootCA();
    const leaf = generateLeafCert(host, root);
    const result = {
      key: leaf.key,
      cert: `${leaf.cert}\n${root.certPem}`,
    };
    leafCache.set(host, result);
    return result;
  } catch (e) {
    log(`leaf cert failed for ${host}: ${e.message}`);
    return null;
  }
}

module.exports = {
  generateRootCA,
  loadRootCA,
  generateLeafCert,
  getCertForDomain,
  isCertExpired,
};
