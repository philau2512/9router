// Antigravity image adapter - delegates to the executor for correct request
// envelope (project, model, requestType, sessionId) and auth headers.
import { nowSec } from "./_base.js";
import { getExecutor } from "../../executors/index.js";

// Convert image input (data URI or raw base64) to Gemini inlineData part
function resolveImageInput(input) {
  if (!input || typeof input !== "string") return null;
  // data:image/png;base64,... format
  const dataUriMatch = input.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    return { inlineData: { mimeType: dataUriMatch[1], data: dataUriMatch[2] } };
  }
  // Raw base64 string (assume PNG)
  if (/^[A-Za-z0-9+/]/.test(input) && input.length > 100 && !input.startsWith("http")) {
    return { inlineData: { mimeType: "image/png", data: input } };
  }
  return null;
}

const antigravityAdapter = {
  // Delegate to executor instead of building URL/headers/body manually
  useExecutor: true,

  // Stubs - required by imageGenerationCore interface but unused with useExecutor
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),

  async executeViaExecutor(model, body, credentials, log) {
    const executor = getExecutor("antigravity");
    if (!executor) throw new Error("Antigravity executor not found");

    // Build parts: text prompt + optional input image for editing
    const parts = [{ text: body.prompt }];
    const imageInput = body.image || (Array.isArray(body.images) && body.images[0]);
    if (imageInput) {
      const inlineData = resolveImageInput(imageInput);
      if (inlineData) parts.unshift(inlineData);
    }

    const { response } = await executor.execute({
      model,
      body: {
        contents: [{ role: "user", parts }],
        generationConfig: {
          numberOfImages: body.n || 1,
          outputMimeType: (body.output_format || "png").toLowerCase() === "jpeg" ? "image/jpeg" : "image/png",
          aspectRatio: body.size === "1024x1024" ? "1:1" : body.size === "16:9" || body.size === "1920x1080" ? "16:9" : "1:1",
        },
      },
      credentials,
    });

    if (!response.ok) {
      throw new Error(`Failed to generate image via antigravity executor: ${response.statusText}`);
    }

    return response.json();
  },

  normalize: (responseBody, prompt) => {
    const candidates = responseBody.candidates || responseBody.response?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];
    const images = parts.filter((p) => p.inlineData?.data).map((p) => ({
      b64_json: p.inlineData.data,
    }));
    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};

export default antigravityAdapter;
