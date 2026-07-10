import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { openaiToAntigravityResponse } from "./openai-to-antigravity.js";

// Gemini, Gemini CLI, and Vertex share the same response envelope as Antigravity:
//   { response: { candidates[], usageMetadata, responseId } }
// Reuse the existing Antigravity handler for all three formats.
register(FORMATS.OPENAI, FORMATS.GEMINI,     null, openaiToAntigravityResponse);
register(FORMATS.OPENAI, FORMATS.GEMINI_CLI, null, openaiToAntigravityResponse);
register(FORMATS.OPENAI, FORMATS.VERTEX,     null, openaiToAntigravityResponse);
