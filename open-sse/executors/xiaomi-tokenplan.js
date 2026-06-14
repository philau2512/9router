import { DefaultExecutor } from "./default.js";
import { resolveXiaomiTokenplanBaseUrl } from "../config/providers.js";
import { getModelTargetFormat } from "../config/providerModels.js";
import { FORMATS } from "../translator/formats.js";

export class XiaomiTokenplanExecutor extends DefaultExecutor {
  constructor() {
    super("xiaomi-tokenplan");
  }

  // Claude-native aliases route to the Anthropic-compatible messages endpoint
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrl = resolveXiaomiTokenplanBaseUrl(credentials);
    // getModelTargetFormat keys its lookup by provider id (first arg), NOT model id —
    // passing `model` as the first arg always returns null and silently downgrades the
    // Claude route to /chat/completions, causing 400 "Param Incorrect: 'function' is not set"
    if (getModelTargetFormat(this.provider, model) === FORMATS.CLAUDE) {
      return `${baseUrl.replace(/\/v1\/?$/, "/anthropic/v1")}/messages`;
    }
    return `${baseUrl}/chat/completions`;
  }
}
