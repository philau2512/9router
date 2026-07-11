// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft)

const ENDPOINTS = {
  openai: "https://api.openai.com/v1/images/generations",
  minimax: "https://api.minimaxi.com/v1/images/generations",
  openrouter: "https://openrouter.ai/api/v1/images/generations",
  recraft: "https://external.api.recraft.ai/v1/images/generations",
  xai: "https://api.x.ai/v1/images/generations",
};

export default function createOpenAIAdapter(providerId) {
  return {
    buildUrl: () => ENDPOINTS[providerId],
    buildHeaders: (creds) => {
      const headers = { "Content-Type": "application/json" };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      if (providerId === "openrouter") {
        headers["HTTP-Referer"] = "https://endpoint-proxy.local";
        headers["X-Title"] = "Endpoint Proxy";
      }
      return headers;
    },
    buildBody: (model, body) => {
      const {
        prompt,
        n = 1,
        size = "1024x1024",
        quality,
        style,
        response_format,
        background,
        image_detail,
        output_format,
      } = body;
      // xAI: forward known image options; skip empty/"auto" where provider rejects them
      if (providerId === "xai") {
        const req = { model, prompt, n };
        if (size && size !== "auto") req.size = size;
        if (quality && quality !== "auto") req.quality = quality;
        if (background && background !== "auto") req.background = background;
        if (response_format) req.response_format = response_format;
        if (image_detail) req.image_detail = image_detail;
        if (output_format) req.output_format = output_format;
        return req;
      }
      const req = { model, prompt, n, size };
      if (quality) req.quality = quality;
      if (style) req.style = style;
      if (response_format) req.response_format = response_format;
      return req;
    },
    normalize: (responseBody) => responseBody,
  };
}
