-- Track assets schema for Virtual DJ Rooms
-- This defines the canonical structure for track metadata storage

CREATE TABLE IF NOT EXISTS tracks (
  -- Primary key
  id VARCHAR(36) PRIMARY KEY,

  -- Track metadata
  title VARCHAR(255) NOT NULL,
  duration_sec DECIMAL(10, 2) NOT NULL,

  -- Ownership (nullable for sample pack tracks)
  owner_id VARCHAR(255),

  -- Source info
  source VARCHAR(50) NOT NULL DEFAULT 'upload', -- 'upload' or 'sample_pack'

  -- File metadata
  mime_type VARCHAR(50) NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  file_hash VARCHAR(64) NOT NULL, -- SHA-256 hash for deduplication

  -- Storage
  storage_key VARCHAR(255) NOT NULL, -- Path/key in object storage

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Constraints
  CONSTRAINT valid_mime_type CHECK (
    mime_type IN (
      'audio/mpeg',      -- MP3
      'audio/wav',       -- WAV
      'audio/x-wav',     -- WAV (alternate)
      'audio/aiff',      -- AIFF
      'audio/x-aiff',    -- AIFF (alternate)
      'audio/flac'       -- FLAC
    )
  ),
  CONSTRAINT valid_file_size CHECK (file_size_bytes > 0 AND file_size_bytes <= 52428800), -- 50MB max
  CONSTRAINT valid_duration CHECK (duration_sec > 0 AND duration_sec <= 900) -- 15 minutes max
);

-- Index for quick lookups by owner
CREATE INDEX IF NOT EXISTS idx_tracks_owner_id ON tracks(owner_id);

-- Index for quick lookups by hash (deduplication)
CREATE INDEX IF NOT EXISTS idx_tracks_file_hash ON tracks(file_hash);

-- Index for created_at (for recent tracks queries)
CREATE INDEX IF NOT EXISTS idx_tracks_created_at ON tracks(created_at DESC);
