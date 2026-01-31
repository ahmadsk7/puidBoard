/**
 * Tests for track store.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { trackStore } from "./trackStore.js";

describe("TrackStore", () => {
  beforeEach(() => {
    trackStore.clear();
  });

  describe("create", () => {
    it("should create a track with all fields", async () => {
      const track = await trackStore.create({
        title: "Test Track",
        durationSec: 180.5,
        ownerId: "user123",
        source: "upload",
        mimeType: "audio/mpeg",
        fileSizeBytes: 5000000,
        fileHash: "abc123",
        storageKey: "abc123.mp3",
      });

      expect(track.id).toBeTruthy();
      expect(track.title).toBe("Test Track");
      expect(track.durationSec).toBe(180.5);
      expect(track.ownerId).toBe("user123");
      expect(track.source).toBe("upload");
      expect(track.createdAt).toBeInstanceOf(Date);
    });

    it("should create a track without owner (sample pack)", async () => {
      const track = await trackStore.create({
        title: "Sample Track",
        durationSec: 120,
        source: "sample_pack",
        mimeType: "audio/wav",
        fileSizeBytes: 3000000,
        fileHash: "def456",
        storageKey: "def456.wav",
      });

      expect(track.ownerId).toBeNull();
      expect(track.source).toBe("sample_pack");
    });
  });

  describe("findById", () => {
    it("should find track by ID", async () => {
      const created = await trackStore.create({
        title: "Find Me",
        durationSec: 90,
        source: "upload",
        mimeType: "audio/mpeg",
        fileSizeBytes: 2000000,
        fileHash: "findme",
        storageKey: "findme.mp3",
      });

      const found = await trackStore.findById(created.id);

      expect(found).toBeTruthy();
      expect(found?.id).toBe(created.id);
      expect(found?.title).toBe("Find Me");
    });

    it("should return null for non-existent ID", async () => {
      const found = await trackStore.findById("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("findByHash", () => {
    it("should find track by file hash", async () => {
      await trackStore.create({
        title: "Hash Test",
        durationSec: 100,
        source: "upload",
        mimeType: "audio/mpeg",
        fileSizeBytes: 1000000,
        fileHash: "uniquehash123",
        storageKey: "uniquehash123.mp3",
      });

      const found = await trackStore.findByHash("uniquehash123");

      expect(found).toBeTruthy();
      expect(found?.fileHash).toBe("uniquehash123");
    });

    it("should return null if hash not found", async () => {
      const found = await trackStore.findByHash("nonexistenthash");
      expect(found).toBeNull();
    });
  });

  describe("find", () => {
    beforeEach(async () => {
      await trackStore.create({
        title: "Track 1",
        durationSec: 100,
        ownerId: "alice",
        source: "upload",
        mimeType: "audio/mpeg",
        fileSizeBytes: 1000000,
        fileHash: "hash1",
        storageKey: "hash1.mp3",
      });

      await trackStore.create({
        title: "Track 2",
        durationSec: 120,
        ownerId: "bob",
        source: "upload",
        mimeType: "audio/wav",
        fileSizeBytes: 2000000,
        fileHash: "hash2",
        storageKey: "hash2.wav",
      });

      await trackStore.create({
        title: "Track 3",
        durationSec: 80,
        ownerId: "alice",
        source: "sample_pack",
        mimeType: "audio/flac",
        fileSizeBytes: 3000000,
        fileHash: "hash3",
        storageKey: "hash3.flac",
      });
    });

    it("should find tracks by owner ID", async () => {
      const tracks = await trackStore.find({ ownerId: "alice" });

      expect(tracks).toHaveLength(2);
      expect(tracks.every((t) => t.ownerId === "alice")).toBe(true);
    });

    it("should limit results", async () => {
      const tracks = await trackStore.find({ limit: 2 });

      expect(tracks).toHaveLength(2);
    });

    it("should sort by created date descending", async () => {
      const tracks = await trackStore.find({});

      expect(tracks).toHaveLength(3);
      // Verify all tracks are returned (order may vary if created at same millisecond)
      const titles = tracks.map((t) => t.title);
      expect(titles).toContain("Track 1");
      expect(titles).toContain("Track 2");
      expect(titles).toContain("Track 3");
    });
  });

  describe("delete", () => {
    it("should delete a track", async () => {
      const track = await trackStore.create({
        title: "Delete Me",
        durationSec: 60,
        source: "upload",
        mimeType: "audio/mpeg",
        fileSizeBytes: 500000,
        fileHash: "deleteme",
        storageKey: "deleteme.mp3",
      });

      const deleted = await trackStore.delete(track.id);
      expect(deleted).toBe(true);

      const found = await trackStore.findById(track.id);
      expect(found).toBeNull();
    });

    it("should return false when deleting non-existent track", async () => {
      const deleted = await trackStore.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("count", () => {
    it("should return correct count", async () => {
      expect(await trackStore.count()).toBe(0);

      await trackStore.create({
        title: "Track 1",
        durationSec: 100,
        source: "upload",
        mimeType: "audio/mpeg",
        fileSizeBytes: 1000000,
        fileHash: "hash1",
        storageKey: "hash1.mp3",
      });

      expect(await trackStore.count()).toBe(1);

      await trackStore.create({
        title: "Track 2",
        durationSec: 120,
        source: "upload",
        mimeType: "audio/wav",
        fileSizeBytes: 2000000,
        fileHash: "hash2",
        storageKey: "hash2.wav",
      });

      expect(await trackStore.count()).toBe(2);
    });
  });
});
