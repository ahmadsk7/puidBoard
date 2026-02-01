/**
 * Security module for Virtual DJ Rooms.
 *
 * Exports rate limiting and validation utilities.
 */

// Rate limiting
export {
  rateLimiter,
  RATE_LIMITS,
  isRateLimitedEventType,
  getRateLimitConfig,
  type RateLimitConfig,
} from "./limits.js";

// Validation
export {
  // Result types
  type ValidationSuccess,
  type ValidationError,
  type ValidationResult,
  type ValidationErrorCode,
  // Permission config
  HOST_ONLY_ACTIONS,
  // Bounds validation
  validateControlValue,
  validateSeekPosition,
  validateCuePosition,
  validateQueueIndex,
  validateCursorPosition,
  // Permission checks
  isHost,
  validateHostPermission,
  isMemberOfRoom,
  // Client/room validation
  validateClientInRoom,
  validateRoomExists,
  validateDeckExists,
  validateQueueItemExists,
  // Combined helpers
  validateEventClient,
  // Logging
  logRateLimitViolation,
  logValidationFailure,
  logPermissionDenied,
} from "./validate.js";
