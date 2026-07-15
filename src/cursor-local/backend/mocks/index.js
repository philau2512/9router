/**
 * Local Ultra mocks — byok parity for auth/plan/models + dashboard.
 */
const { loadConfig } = require("../../config/loadConfig");
const { listModels } = require("../../config/modelMap");
const {
  writeUnaryProto,
  writeUnaryJson,
  readBody,
} = require("../proto/connect");
const {
  encodeAvailableModelsResponse,
  encodeServerTimeResponse,
  encodeGetMeResponse,
  encodeGetEmailResponse,
  encodeGetPlanInfoResponse,
  encodeEmpty,
} = require("../proto/agentMessages");
const { DEFAULTS } = require("../../config/defaults");
const { isTabPath, proxyTabRequest } = require("../tab/proxy");
const { log } = require("../../logger");

function matchPath(pathOnly, suffix) {
  return pathOnly === suffix || pathOnly.endsWith(suffix);
}

function buildModelsPayload() {
  return listModels(loadConfig());
}

async function tryHandleMock(req, res, pathOnly) {
  const method = (req.method || "GET").toUpperCase();

  if (pathOnly.includes("/tev1/") || pathOnly.includes("/rgstr")) {
    await readBody(req).catch(() => {});
    res.writeHead(204);
    res.end();
    return true;
  }

  if (isTabPath(pathOnly)) {
    return proxyTabRequest(req, res, pathOnly);
  }

  // JSON auth
  if (matchPath(pathOnly, "/auth/full_stripe_profile")) {
    writeUnaryJson(res, {
      membershipType: DEFAULTS.membershipType,
      subscriptionStatus: DEFAULTS.subscriptionStatus,
      lastPaymentFailed: false,
      pendingCancellationDate: "",
      daysRemainingOnTrial: 0,
      paymentId: "local_ultra",
    });
    return true;
  }
  if (matchPath(pathOnly, "/auth/stripe_profile")) {
    writeUnaryJson(res, "local_ultra");
    return true;
  }
  if (matchPath(pathOnly, "/auth/poll")) {
    writeUnaryJson(res, {
      accessToken: DEFAULTS.injectAuthToken,
      refreshToken: DEFAULTS.injectAuthToken,
      authId: "local_auth",
    });
    return true;
  }
  if (matchPath(pathOnly, "/auth/has_valid_payment_method")) {
    writeUnaryJson(res, { hasValidPaymentMethod: true });
    return true;
  }
  if (matchPath(pathOnly, "/oauth/token")) {
    await readBody(req);
    writeUnaryJson(res, {
      access_token: DEFAULTS.injectAuthToken,
      id_token: DEFAULTS.injectAuthToken,
      shouldLogout: false,
    });
    return true;
  }
  if (matchPath(pathOnly, "/auth/logout") || pathOnly.endsWith("/logout")) {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathOnly.includes("AvailableModels") && !pathOnly.includes("CppService")) {
    await readBody(req);
    const models = buildModelsPayload();
    log(`mock AvailableModels count=${models.length}`);
    writeUnaryProto(res, encodeAvailableModelsResponse(models));
    return true;
  }

  if (pathOnly.includes("ServerTime")) {
    await readBody(req);
    writeUnaryProto(res, encodeServerTimeResponse());
    return true;
  }

  if (pathOnly.includes("AuthService/GetEmail") || pathOnly.endsWith("/GetEmail")) {
    await readBody(req);
    writeUnaryProto(res, encodeGetEmailResponse(DEFAULTS.injectAccountEmail));
    return true;
  }

  if (pathOnly.includes("GetMe")) {
    await readBody(req);
    writeUnaryProto(res, encodeGetMeResponse(DEFAULTS.injectAccountEmail));
    return true;
  }

  if (pathOnly.includes("GetPlanInfo")) {
    await readBody(req);
    writeUnaryProto(res, encodeGetPlanInfoResponse());
    return true;
  }

  if (pathOnly.includes("IsOnNewPricing")) {
    await readBody(req);
    writeUnaryProto(res,
      require("../proto/wire").concat(
        require("../proto/wire").encodeBool(1, true),  // isOnNewPricing
        require("../proto/wire").encodeBool(2, false), // isOptedOut
        require("../proto/wire").encodeBool(3, true),  // hasAutoSpillover
        require("../proto/wire").encodeInt64(4, 1),    // dashboardUserId
      ),
    );
    return true;
  }

  if (pathOnly.includes("GetCurrentPeriodUsage")) {
    await readBody(req);
    const billingStart = Date.now() - 15 * 24 * 3600 * 1000;
    const billingEnd = Date.now() + 15 * 24 * 3600 * 1000;
    const { concat, encodeString, encodeInt64, encodeBool, encodeMessage } = require("../proto/wire");
    const planUsage = concat(
      encodeInt64(1, 0),  // autoPercentUsed
      encodeInt64(2, 0),  // autoSpend
      encodeInt64(3, 20000), // includedSpend
      encodeInt64(4, 20000), // limit
      encodeInt64(5, 20000), // remaining
      encodeInt64(6, 0),     // totalPercentUsed
      encodeInt64(7, 0),     // totalSpend
    );
    const body = concat(
      encodeString(1, "Ultra plan active"),
      encodeInt64(2, billingEnd),
      encodeInt64(3, billingStart),
      encodeBool(4, true),
      encodeMessage(5, planUsage),
      encodeInt64(6, 99999999), // displayThreshold
    );
    writeUnaryProto(res, body);
    return true;
  }

  if (pathOnly.includes("BootstrapStatsig") || pathOnly.includes("GetFirstWindowStatsig")) {
    await readBody(req);
    const { concat, encodeString, encodeInt64 } = require("../proto/wire");
    const statsigConfig = JSON.stringify({
      feature_gates: {},
      dynamic_configs: {},
      layer_configs: {},
      has_updates: true,
      hash_used: "none",
      user: { userID: "local_ultra", email: DEFAULTS.injectAccountEmail },
      sdk_params: { stableID: "local_ultra", disableDiagnosticsLogging: true },
    });
    const body = concat(
      encodeString(1, statsigConfig),    // config JSON
      encodeInt64(2, Date.now()),        // generatedAtMs
    );
    writeUnaryProto(res, body);
    return true;
  }

  if (pathOnly.includes("GetDefaultModelNudgeData")) {
    await readBody(req);
    const models = buildModelsPayload();
    const { concat, encodeString } = require("../proto/wire");
    const ids = models.map((m) => m.id).filter(Boolean);
    const body = ids.length
      ? concat(
          ...ids.map((id) => encodeString(1, id)), // modelsWithNoDefaultSwitch
          encodeString(2, "0"),                     // nudgeDate
        )
      : require("../proto/wire").encodeString(2, "0");
    writeUnaryProto(res, body);
    return true;
  }

  if (
    pathOnly.includes("GetServerConfig") ||
    pathOnly.includes("GetDefaultModel") ||
    pathOnly.includes("BootstrapStatsig") ||
    pathOnly.includes("GetFirstWindowStatsig") ||
    pathOnly.includes("GetCurrentPeriodUsage") ||
    pathOnly.includes("GetUsageLimitStatus") ||
    pathOnly.includes("IsOnNewPricing") ||
    pathOnly.includes("GetUserPrivacyMode") ||
    pathOnly.includes("GetTeams") ||
    pathOnly.includes("GetManagedSkills") ||
    pathOnly.includes("GetGithubInstallations") ||
    pathOnly.includes("GetEffectiveUserPlugins") ||
    pathOnly.includes("SubmitLogs") ||
    pathOnly.includes("AnalyticsService") ||
    pathOnly.includes("Batch") ||
    pathOnly.includes("RepositoryService") ||
    pathOnly.includes("UploadService") ||
    pathOnly.includes("GetHardLimit") ||
    pathOnly.includes("CheckQueuePosition") ||
    pathOnly.includes("GetUsageBasedPremium") ||
    pathOnly.includes("ListInvoice") ||
    pathOnly.includes("GetTokenUsage") ||
    pathOnly.includes("CountTokens") ||
    pathOnly.includes("KnowledgeBase") ||
    pathOnly.includes("DocsService") ||
    pathOnly.includes("NameAgent") ||
    pathOnly.includes("ReportClient") ||
    pathOnly.includes("InAppAd") ||
    pathOnly.includes("NetworkService") ||
    pathOnly.includes("GetUserInfo") ||
    pathOnly.includes("index") ||
    pathOnly.includes("Index") ||
    pathOnly.includes("Codebase") ||
    pathOnly.includes("SemanticSearch")
  ) {
    await readBody(req);
    writeUnaryProto(res, encodeEmpty());
    return true;
  }

  if (
    method === "POST" &&
    (pathOnly.includes("/aiserver.v1.") ||
      pathOnly.includes("/agent.v1.") ||
      pathOnly.includes("DashboardService") ||
      pathOnly.includes("AnalyticsService") ||
      pathOnly.includes("AiService") ||
      pathOnly.includes("AuthService"))
  ) {
    if (
      pathOnly.includes("BidiAppend") ||
      pathOnly.includes("RunSSE") ||
      pathOnly.includes("/Run") ||
      pathOnly.includes("RunPoll")
    ) {
      return false;
    }
    await readBody(req);
    if (process.env.CURSOR_LOCAL_DEBUG === "1") {
      log(`mock empty unary ${pathOnly}`);
    }
    writeUnaryProto(res, encodeEmpty());
    return true;
  }

  return false;
}

module.exports = { tryHandleMock, buildModelsPayload };
