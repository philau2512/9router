/**
 * Auth barrel — preserves legacy imports while implementations remain split by concern.
 */

export {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
} from "./provider-credentials.js";

export * from "./api-key-validation.js";
export * from "./api-key-access.js";
export * from "./api-key-helpers.js";