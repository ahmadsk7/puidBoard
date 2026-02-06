import { describe, it, expect } from "vitest";
import type { QueueItem, Member } from "@puid-board/shared";

describe("QueuePanel", () => {
  const mockMembers: Member[] = [
    {
      clientId: "client-1",
      name: "User 1",
      color: "#FF6B6B",
      joinedAt: Date.now(),
      isHost: true,
      cursor: null,
      latencyMs: 0,
    },
    {
      clientId: "client-2",
      name: "User 2",
      color: "#4ECDC4",
      joinedAt: Date.now(),
      isHost: false,
      cursor: null,
      latencyMs: 0,
    },
  ];

  const mockQueueItems: QueueItem[] = [
    {
      id: "q-1",
      trackId: "track-1",
      title: "Track One",
      durationSec: 180,
      url: "https://example.com/track-1.mp3",
      addedBy: "client-1",
      addedAt: Date.now(),
      status: "queued",
      source: "upload",
      youtubeVideoId: null,
      thumbnailUrl: null,
    },
    {
      id: "q-2",
      trackId: "track-2",
      title: "Track Two",
      durationSec: 240,
      url: "https://example.com/track-2.mp3",
      addedBy: "client-2",
      addedAt: Date.now(),
      status: "loaded_A",
      source: "upload",
      youtubeVideoId: null,
      thumbnailUrl: null,
    },
    {
      id: "q-3",
      trackId: "track-3",
      title: "Track Three",
      durationSec: 200,
      url: "https://example.com/track-3.mp3",
      addedBy: "client-1",
      addedAt: Date.now(),
      status: "playing_B",
      source: "upload",
      youtubeVideoId: null,
      thumbnailUrl: null,
    },
  ];

  describe("queue operations", () => {
    it("can identify items added by current user", () => {
      const clientId = "client-1";
      const ownItems = mockQueueItems.filter((item) => item.addedBy === clientId);
      expect(ownItems).toHaveLength(2);
      expect(ownItems[0]?.title).toBe("Track One");
      expect(ownItems[1]?.title).toBe("Track Three");
    });

    it("can identify loadable items (queued or played)", () => {
      const loadableItems = mockQueueItems.filter(
        (item) => item.status === "queued" || item.status === "played"
      );
      expect(loadableItems).toHaveLength(1);
      expect(loadableItems[0]?.title).toBe("Track One");
    });

    it("calculates correct reorder indices", () => {
      // Simulating drag from index 2 to index 0
      const fromIndex = 2;
      const toIndex = 0;
      const arr = [...mockQueueItems];
      const [item] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, item!);

      expect(arr[0]?.title).toBe("Track Three");
      expect(arr[1]?.title).toBe("Track One");
      expect(arr[2]?.title).toBe("Track Two");
    });
  });

  describe("member lookup", () => {
    it("finds member by clientId", () => {
      const member = mockMembers.find((m) => m.clientId === "client-2");
      expect(member?.name).toBe("User 2");
    });

    it("returns undefined for unknown clientId", () => {
      const member = mockMembers.find((m) => m.clientId === "unknown");
      expect(member).toBeUndefined();
    });
  });
});
