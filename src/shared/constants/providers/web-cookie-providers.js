/**
 * Web cookie providers (use browser session cookie instead of API key).
 * @module providers/web-cookie-providers
 */

// Web Cookie Providers (use browser session cookie instead of API key)
export const WEB_COOKIE_PROVIDERS = {
  "grok-web": {
    id: "grok-web",
    alias: "gw",
    name: "Grok Web (Subscription)",
    icon: "auto_awesome",
    color: "#1DA1F2",
    textIcon: "GW",
    website: "https://grok.com",
    authType: "cookie",
    authHint: "Paste your sso= cookie value from grok.com",
    passthroughModels: true,
    serviceKinds: ["llm"],
  },
  "perplexity-web": {
    id: "perplexity-web",
    alias: "pw",
    name: "Perplexity Web (Pro/Max)",
    icon: "search",
    color: "#20808D",
    textIcon: "PW",
    website: "https://www.perplexity.ai",
    authType: "cookie",
    authHint:
      "Paste your __Secure-next-auth.session-token cookie value from perplexity.ai",
    serviceKinds: ["llm"],
  },
};
