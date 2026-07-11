// Perplexity Agent API — OpenAI Responses API format with web search capability.
// Uses /v1/responses endpoint (not /chat/completions).
// See upstream commit ce6bdf7fc.
const perplexityAgentProvider = {
  id: "perplexity-agent",
  priority: 181,
  alias: "perplexity-agent",
  aliases: ["pplx-agent", "pplx-responses"],
  uiAlias: "pa",
  display: {
    name: "Perplexity Agent",
    icon: "travel_explore",
    color: "#20808D",
    textIcon: "PA",
    website: "https://www.perplexity.ai",
    notice: {
      text: "Perplexity Agent API exposes GPT, Claude, Gemini, Grok, GLM, Kimi, and Sonar models through one OpenAI-compatible Responses API.",
      apiKeyUrl: "https://www.perplexity.ai/settings/api",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.perplexity.ai/v1/responses",
    validateUrl: "https://api.perplexity.ai/v1/models",
    format: "openai-responses",
  },
  serviceKinds: ["llm", "webSearch"],
  searchViaChat: {
    defaultModel: "perplexity/sonar",
    endpoint: "https://api.perplexity.ai/v1/responses",
    pricingUrl: "https://docs.perplexity.ai/docs/agent-api/models",
  },
  modelsFetcher: { url: "https://api.perplexity.ai/v1/models", type: "openai" },
  passthroughModels: true,
};

export default perplexityAgentProvider;
