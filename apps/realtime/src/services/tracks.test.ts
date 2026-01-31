/**
 * Tests for track service.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { trackService, TrackValidationError } from "./tracks.js";
import { trackStore } from "../db/trackStore.js";

describe("TrackService", () => {
  beforeEach(() => {
    trackStore.clear();
  });

  describe("upload", () => {
    it("should upload a valid MP3 track", async () => {
      const buffer = Buffer.from("fake mp3 data");
      const result = await trackService.upload({
        buffer,
        filename: "test.mp3",
        mimeType: "audio/mpeg",
        title: "Test Track",
        durationSec: 180,
        ownerId: "user123",
      });

      expect(result.trackId).toBeTruthy();
      expect(result.url).toContain("http");
      expect(result.url).toContain(".mp3");
      expect(result.deduplication).toBe(false);
    });

    it("should upload a valid WAV track", async () => {
      const buffer = Buffer.from("fake wav data");
      const result = await trackService.upload({
        buffer,
        filename: "test.wav",
        mimeType: "audio/wav",
        title: "Test WAV",
        durationSec: 120,
      });

      expect(result.trackId).toBeTruthy();
      expect(result.deduplication).toBe(false);
    });

    it("should reject file exceeding size limit", async () => {
      const buffer = Buffer.alloc(51 * 1024 * 1024); // 51MB

      await expect(
        trackService.upload({
          buffer,
          filename: "toolarge.mp3",
          mimeType: "audio/mpeg",
          title: "Too Large",
          durationSec: 180,
        })
      ).rejects.toThrow(TrackValidationError);
    });

    it("should reject invalid mime type", async () => {
      const buffer = Buffer.from("fake data");

      await expect(
        trackService.upload({
          buffer,
          filename: "test.txt",
          mimeType: "text/plain",
          title: "Invalid",
          durationSec: 180,
        })
      ).rejects.toThrow(TrackValidationError);
    });

    it("should reject track exceeding duration limit", async () => {
      const buffer = Buffer.from("fake data");

      await expect(
        trackService.upload({
          buffer,
          filename: "toolong.mp3",
          mimeType: "audio/mpeg",
          title: "Too Long",
          durationSec: 16 * 60, // 16 minutes
        })
      ).rejects.toThrow(TrackValidationError);
    });

    it("should reject track with zero duration", async () => {
      const buffer = Buffer.from("fake data");

      await expect(
        trackService.upload({
          buffer,
          filename: "zeroduration.mp3",
          mimeType: "audio/mpeg",
          title: "Zero Duration",
          durationSec: 0,
        })
      ).rejects.toThrow(TrackValidationError);
    });

    it("should deduplicate identical files", async () => {
      const buffer = Buffer.from("unique data");

      const result1 = await trackService.upload({
        buffer,
        filename: "test1.mp3",
        mimeType: "audio/mpeg",
        title: "Original",
        durationSec: 180,
      });

      const result2 = await trackService.upload({
        buffer,
        filename: "test2.mp3",
        mimeType: "audio/mpeg",
        title: "Duplicate",
        durationSec: 180,
      });

      expect(result1.trackId).toBe(result2.trackId);
      expect(result1.deduplication).toBe(false);
      expect(result2.deduplication).toBe(true);
    });

    it("should accept all allowed audio formats", async () => {
      const formats = [
        { mime: "audio/mpeg", ext: "mp3" },
        { mime: "audio/wav", ext: "wav" },
        { mime: "audio/x-wav", ext: "wav" },
        { mime: "audio/aiff", ext: "aiff" },
        { mime: "audio/x-aiff", ext: "aiff" },
        { mime: "audio/flac", ext: "flac" },
      ];

      for (const format of formats) {
        const buffer = Buffer.from(`fake ${format.ext} data ${Math.random()}`);
        const result = await trackService.upload({
          buffer,
          filename: `test.${format.ext}`,
          mimeType: format.mime,
          title: `Test ${format.ext.toUpperCase()}`,
          durationSec: 180,
        });

        expect(result.trackId).toBeTruthy();
      }
    });
  });

  describe("getById", () => {
    it("should retrieve uploaded track", async () => {
      const buffer = Buffer.from("test data");
      const uploadResult = await trackService.upload({
        buffer,
        filename: "test.mp3",
        mimeType: "audio/mpeg",
        title: "Test Track",
        durationSec: 180,
      });

      const track = await trackService.getById(uploadResult.trackId);

      expect(track).toBeTruthy();
      expect(track?.title).toBe("Test Track");
      expect(track?.durationSec).toBe(180);
    });

    it("should return null for non-existent track", async () => {
      const track = await trackService.getById("nonexistent");
      expect(track).toBeNull();
    });
  });

  describe("getUrl", () => {
    it("should return URL for existing track", async () => {
      const buffer = Buffer.from("test data");
      const uploadResult = await trackService.upload({
        buffer,
        filename: "test.mp3",
        mimeType: "audio/mpeg",
        title: "Test Track",
        durationSec: 180,
      });

      const url = await trackService.getUrl(uploadResult.trackId);

      expect(url).toBeTruthy();
      expect(url).toContain("http");
    });

    it("should return null for non-existent track", async () => {
      const url = await trackService.getUrl("nonexistent");
      expect(url).toBeNull();
    });
  });
});
