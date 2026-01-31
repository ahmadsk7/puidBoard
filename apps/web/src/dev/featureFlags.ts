/**
 * Feature flags for local development.
 * Used to toggle mock/simulator behavior without the real backend.
 */

/** Use in-memory mock room instead of realtime server (Dev A harness) */
export const USE_MOCK_ROOM =
  process.env.NEXT_PUBLIC_USE_MOCK_ROOM === "true" ||
  process.env.NEXT_PUBLIC_USE_MOCK_ROOM === "1";
