# Multiplayer Presence UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add room presence pills, join/leave toasts, and a persistent username system with fun random names to the multiplayer DJ board.

**Architecture:** New utility for name generation + localStorage persistence. TopBar extended with presence pills and inline rename. New Toast component for join/leave/rename notifications. Backend gets a standalone MEMBER_RENAME event (not a mutation event), following the JOIN_ROOM/LEAVE_ROOM pattern. Client gets onMemberJoined/onMemberLeft/onMemberRenamed callbacks.

**Tech Stack:** React 18, Next.js 14, Socket.IO, Zod, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-15-multiplayer-presence-ui-design.md`

---

## Chunk 1: Name Generator + Username Persistence

### Task 1: Random Name Generator

**Files:**
- Create: `apps/web/src/utils/generateName.ts`
- Create: `apps/web/src/utils/generateName.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// apps/web/src/utils/generateName.test.ts
import { describe, it, expect } from "vitest";
import { generateRandomName } from "./generateName";

describe("generateRandomName", () => {
  it("returns a non-empty string", () => {
    const name = generateRandomName();
    expect(name.length).toBeGreaterThan(0);
  });

  it("matches the AdjectiveNounNN format", () => {
    const name = generateRandomName();
    // Should be a word-like string ending in 2 digits
    expect(name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/);
  });

  it("is at most 32 characters", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateRandomName().length).toBeLessThanOrEqual(32);
    }
  });

  it("produces varied names", () => {
    const names = new Set<string>();
    for (let i = 0; i < 50; i++) names.add(generateRandomName());
    expect(names.size).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/utils/generateName.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/utils/generateName.ts
const ADJECTIVES = [
  "Iron", "Neon", "Cyber", "Cosmic", "Velvet",
  "Turbo", "Shadow", "Crystal", "Hyper", "Golden",
  "Stealth", "Lunar", "Phantom", "Atomic", "Blazing",
  "Frozen", "Thunder", "Mystic", "Savage", "Radical",
];

const NOUNS = [
  "Moose", "Falcon", "Panther", "Cobra", "Phoenix",
  "Wolf", "Tiger", "Hawk", "Viper", "Lynx",
  "Raven", "Shark", "Dragon", "Mustang", "Jaguar",
  "Coyote", "Condor", "Mantis", "Badger", "Orca",
];

export function generateRandomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  const num = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  return `${adj}${noun}${num}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/utils/generateName.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/generateName.ts apps/web/src/utils/generateName.test.ts
git commit -m "feat: add DJ-style random name generator"
```

### Task 2: Username localStorage Helper

**Files:**
- Create: `apps/web/src/utils/username.ts`
- Create: `apps/web/src/utils/username.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// apps/web/src/utils/username.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { getUsername, setUsername } from "./username";

// Vitest has a jsdom environment that provides localStorage
describe("username persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("generates and stores a name on first call", () => {
    const name = getUsername();
    expect(name.length).toBeGreaterThan(0);
    expect(localStorage.getItem("puid-username")).toBe(name);
  });

  it("returns the same name on subsequent calls", () => {
    const first = getUsername();
    const second = getUsername();
    expect(second).toBe(first);
  });

  it("setUsername updates localStorage", () => {
    setUsername("CoolDJ42");
    expect(getUsername()).toBe("CoolDJ42");
    expect(localStorage.getItem("puid-username")).toBe("CoolDJ42");
  });

  it("setUsername with empty string regenerates a name", () => {
    setUsername("");
    const name = getUsername();
    expect(name.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/utils/username.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/utils/username.ts
import { generateRandomName } from "./generateName";

const STORAGE_KEY = "puid-username";

export function getUsername(): string {
  if (typeof window === "undefined") return generateRandomName();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored.trim().length > 0) return stored;
  const name = generateRandomName();
  localStorage.setItem(STORAGE_KEY, name);
  return name;
}

export function setUsername(name: string): void {
  if (typeof window === "undefined") return;
  const trimmed = name.trim().slice(0, 32);
  if (trimmed.length === 0) {
    const generated = generateRandomName();
    localStorage.setItem(STORAGE_KEY, generated);
    return;
  }
  localStorage.setItem(STORAGE_KEY, trimmed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/utils/username.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/username.ts apps/web/src/utils/username.test.ts
git commit -m "feat: add localStorage username persistence"
```

### Task 3: Add Username Field to Home Screen

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Update the home page**

In `apps/web/src/app/page.tsx`:

1. Import `getUsername` and `setUsername` from `@/utils/username`.
2. Add state: `const [username, setUsernameState] = useState(() => getUsername())`.
3. Add an `<input>` field above the "Create Room" section with:
   - Value bound to `username`
   - `onChange` updates local state
   - `onBlur` and Enter keypress call `setUsername(username)` to persist
   - `maxLength={32}`
   - Label: "Username"
   - If the user clears the field completely, on blur call `setUsername("")` which regenerates, then update local state with `getUsername()`.

The field should match the existing page styling (system-ui font, similar input styling to the join-code input).

- [ ] **Step 2: Verify manually**

Run: `cd apps/web && npm run dev`
- Visit `http://localhost:3000`
- Verify username field appears with a randomly generated name
- Edit it, refresh page — verify the edit persists
- Clear the field and blur — verify a new random name is generated

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat: add username field to home screen with localStorage"
```

### Task 4: Use Persistent Username in Room Page

**Files:**
- Modify: `apps/web/src/app/room/[code]/page.tsx:100`

- [ ] **Step 1: Replace random name with localStorage username**

In `apps/web/src/app/room/[code]/page.tsx`:

1. Import `getUsername` from `@/utils/username`.
2. Replace line 100:
   ```typescript
   // OLD:
   const [name] = useState(() => `User${Math.floor(Math.random() * 1000)}`);
   // NEW:
   const [name] = useState(() => getUsername());
   ```

- [ ] **Step 2: Verify manually**

- Set username to "TestDJ99" on home screen
- Create a room
- Verify the TopBar shows the room (later tasks will show the name in pills)
- Check server logs to confirm the name "TestDJ99" was sent

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/room/[code]/page.tsx
git commit -m "feat: use persistent username when joining rooms"
```

---

## Chunk 2: Shared Event Schemas + Server Handler

### Task 5: Add MEMBER_RENAME and MEMBER_RENAMED Schemas

**Files:**
- Modify: `packages/shared/src/events.ts`

- [ ] **Step 1: Add schemas after the LEAVE_ROOM / REJOIN_ROOM section (~line 526)**

Add the following after `RejoinRoomEventSchema` (around line 526) but before the Union Types section:

```typescript
// ============================================================================
// Member Rename Events
// ============================================================================

/** Rename request (client → server) */
export const MemberRenamePayloadSchema = z.object({
  name: z.string().min(1).max(32).trim(),
});
export type MemberRenamePayload = z.infer<typeof MemberRenamePayloadSchema>;

export const MemberRenameEventSchema = z.object({
  type: z.literal("MEMBER_RENAME"),
  roomId: RoomIdSchema,
  clientId: ClientIdSchema,
  payload: MemberRenamePayloadSchema,
});
export type MemberRenameEvent = z.infer<typeof MemberRenameEventSchema>;

/** Rename broadcast (server → client) */
export const MemberRenamedEventSchema = z.object({
  type: z.literal("MEMBER_RENAMED"),
  roomId: RoomIdSchema,
  serverTs: z.number(),
  payload: z.object({
    clientId: ClientIdSchema,
    oldName: z.string(),
    newName: z.string(),
  }),
});
export type MemberRenamedEvent = z.infer<typeof MemberRenamedEventSchema>;
```

Then update the `ClientEventSchema` union (~line 571) to include `MemberRenameEventSchema`:

```typescript
export const ClientEventSchema = z.union([
  ClientMutationEventSchema,
  TimePingEventSchema,
  JoinRoomEventSchema,
  CreateRoomEventSchema,
  LeaveRoomEventSchema,
  RejoinRoomEventSchema,
  MemberRenameEventSchema,  // ADD THIS
]);
```

And update the `ServerEventSchema` discriminated union (~line 582) to include `MemberRenamedEventSchema`:

```typescript
export const ServerEventSchema = z.discriminatedUnion("type", [
  BeaconTickEventSchema,
  RoomSnapshotEventSchema,
  TimePongEventSchema,
  MemberJoinedEventSchema,
  MemberLeftEventSchema,
  MemberRenamedEventSchema,  // ADD THIS
]);
```

- [ ] **Step 2: Build shared package to verify types compile**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/events.ts
git commit -m "feat: add MEMBER_RENAME and MEMBER_RENAMED event schemas"
```

### Task 6: Server-Side Rename Handler

**Files:**
- Create: `apps/realtime/src/handlers/member.ts`
- Modify: `apps/realtime/src/protocol/handlers.ts`

- [ ] **Step 1: Create the member rename handler**

```typescript
// apps/realtime/src/handlers/member.ts
import type { Server, Socket } from "socket.io";
import {
  MemberRenameEventSchema,
  type MemberRenamedEvent,
} from "@puid-board/shared";
import { roomStore } from "../rooms/store.js";

export function handleMemberRename(
  io: Server,
  socket: Socket,
  data: unknown
): void {
  const parsed = MemberRenameEventSchema.safeParse(data);
  if (!parsed.success) {
    console.log(`[MEMBER_RENAME] invalid payload socket=${socket.id}`);
    socket.emit("ERROR", {
      type: "VALIDATION_ERROR",
      message: "Invalid MEMBER_RENAME payload",
    });
    return;
  }

  const client = roomStore.getClient(socket.id);
  if (!client || !client.roomId) {
    socket.emit("ERROR", {
      type: "NOT_IN_ROOM",
      message: "Not in a room",
    });
    return;
  }

  const room = roomStore.getRoom(client.roomId);
  if (!room) return;

  const member = room.members.find((m) => m.clientId === client.clientId);
  if (!member) return;

  const oldName = member.name;
  const newName = parsed.data.payload.name;

  if (oldName === newName) return; // No change

  member.name = newName;
  room.version++;

  const broadcast: MemberRenamedEvent = {
    type: "MEMBER_RENAMED",
    roomId: room.roomId,
    serverTs: Date.now(),
    payload: {
      clientId: client.clientId,
      oldName,
      newName,
    },
  };

  io.to(room.roomId).emit("MEMBER_RENAMED", broadcast);

  console.log(
    `[MEMBER_RENAME] "${oldName}" -> "${newName}" clientId=${client.clientId} roomId=${room.roomId}`
  );
}

export function registerMemberHandlers(io: Server, socket: Socket): void {
  socket.on("MEMBER_RENAME", (data: unknown) => {
    handleMemberRename(io, socket, data);
  });
}
```

- [ ] **Step 2: Register in protocol/handlers.ts**

In `apps/realtime/src/protocol/handlers.ts`:

1. Add import: `import { registerMemberHandlers } from "../handlers/member.js";`
2. Add call at end of `registerHandlers()` function (after `registerSamplerHandlers`):
   ```typescript
   // Register member handlers (rename)
   registerMemberHandlers(io, socket);
   ```

- [ ] **Step 3: Build server to verify**

Run: `cd apps/realtime && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/realtime/src/handlers/member.ts apps/realtime/src/protocol/handlers.ts
git commit -m "feat: add server-side MEMBER_RENAME handler"
```

---

## Chunk 3: Client-Side Event Handling

### Task 7: Add Member Event Callbacks to RealtimeClient

**Files:**
- Modify: `apps/web/src/realtime/client.ts`

- [ ] **Step 1: Add listener sets and callback registration methods**

In `apps/web/src/realtime/client.ts`:

1. Add import for `MemberRenamedEvent` from `@puid-board/shared` (line 7-15 import block).

2. Add three new listener sets to the class (after `samplerPlayListeners` around line 58):
   ```typescript
   private memberJoinedListeners = new Set<(payload: { clientId: string; name: string; color: string }) => void>();
   private memberLeftListeners = new Set<(payload: { clientId: string; name: string; color: string }) => void>();
   private memberRenamedListeners = new Set<(payload: { clientId: string; oldName: string; newName: string }) => void>();
   ```

3. Add three registration methods (after `onSamplerPlay` around line 104):
   ```typescript
   onMemberJoined(listener: (payload: { clientId: string; name: string; color: string }) => void): () => void {
     this.memberJoinedListeners.add(listener);
     return () => this.memberJoinedListeners.delete(listener);
   }

   onMemberLeft(listener: (payload: { clientId: string; name: string; color: string }) => void): () => void {
     this.memberLeftListeners.add(listener);
     return () => this.memberLeftListeners.delete(listener);
   }

   onMemberRenamed(listener: (payload: { clientId: string; oldName: string; newName: string }) => void): () => void {
     this.memberRenamedListeners.add(listener);
     return () => this.memberRenamedListeners.delete(listener);
   }
   ```

- [ ] **Step 2: Fire callbacks in existing MEMBER_JOINED handler**

In `registerSocketHandlers()`, in the `MEMBER_JOINED` handler (around line 313-328), add after `this.notifyStateListeners()`:

```typescript
this.memberJoinedListeners.forEach((l) => l({
  clientId: event.payload.clientId,
  name: event.payload.name,
  color: event.payload.color,
}));
```

- [ ] **Step 3: Fire callbacks in existing MEMBER_LEFT handler + capture name before removal**

In the `MEMBER_LEFT` handler (around line 331-340), capture the member's name/color before filtering:

```typescript
this.socket.on("MEMBER_LEFT", (event: MemberLeftEvent) => {
  if (!this.state) return;
  const leaving = this.state.members.find((m) => m.clientId === event.payload.clientId);
  this.state = {
    ...this.state,
    members: this.state.members.filter(
      (m) => m.clientId !== event.payload.clientId
    ),
  };
  this.notifyStateListeners();
  if (leaving) {
    this.memberLeftListeners.forEach((l) => l({
      clientId: event.payload.clientId,
      name: leaving.name,
      color: leaving.color,
    }));
  }
});
```

- [ ] **Step 4: Add MEMBER_RENAMED socket handler**

Add a new socket handler in `registerSocketHandlers()` (after the MEMBER_LEFT handler):

```typescript
this.socket.on("MEMBER_RENAMED", (event: MemberRenamedEvent) => {
  if (!this.state) return;
  this.state = {
    ...this.state,
    members: this.state.members.map((m) =>
      m.clientId === event.payload.clientId
        ? { ...m, name: event.payload.newName }
        : m
    ),
  };
  this.notifyStateListeners();
  this.memberRenamedListeners.forEach((l) => l({
    clientId: event.payload.clientId,
    oldName: event.payload.oldName,
    newName: event.payload.newName,
  }));
});
```

- [ ] **Step 5: Add `sendRename` method to RealtimeClient**

Add a public method (after `sendEvent` around line 212):

```typescript
/** Send a rename request to the server */
sendRename(newName: string): void {
  if (!this.socket?.connected || !this.state || !this.clientId) return;
  this.socket.emit("MEMBER_RENAME", {
    type: "MEMBER_RENAME",
    roomId: this.state.roomId,
    clientId: this.clientId,
    payload: { name: newName },
  });
}
```

- [ ] **Step 6: Build to verify types**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/realtime/client.ts
git commit -m "feat: add member joined/left/renamed callbacks to RealtimeClient"
```

### Task 8: Expose Member Callbacks in useRealtimeRoom Hook

**Files:**
- Modify: `apps/web/src/realtime/useRealtimeRoom.ts`

- [ ] **Step 1: Add callback subscriptions**

In `apps/web/src/realtime/useRealtimeRoom.ts`:

1. Add to `UseRealtimeRoomOptions`:
   ```typescript
   onMemberJoined?: (payload: { clientId: string; name: string; color: string }) => void;
   onMemberLeft?: (payload: { clientId: string; name: string; color: string }) => void;
   onMemberRenamed?: (payload: { clientId: string; oldName: string; newName: string }) => void;
   ```

2. Add to `UseRealtimeRoomResult`:
   ```typescript
   sendRename: (newName: string) => void;
   ```

3. Destructure new options in the hook (line 39):
   ```typescript
   const { roomCode, name, create = false, autoCreate = false, onMemberJoined, onMemberLeft, onMemberRenamed } = options;
   ```

4. Add subscriptions inside the main `useEffect` (after `unsubError` around line 106):
   ```typescript
   const unsubJoined = onMemberJoined ? client.onMemberJoined(onMemberJoined) : undefined;
   const unsubLeft = onMemberLeft ? client.onMemberLeft(onMemberLeft) : undefined;
   const unsubRenamed = onMemberRenamed ? client.onMemberRenamed(onMemberRenamed) : undefined;
   ```

5. Clean up in the return function:
   ```typescript
   unsubJoined?.();
   unsubLeft?.();
   unsubRenamed?.();
   ```

6. Add `sendRename` callback:
   ```typescript
   const sendRename = useCallback(
     (newName: string) => {
       client.sendRename(newName);
     },
     [client]
   );
   ```

7. Return `sendRename` in the result object.

**Important:** The `onMemberJoined`/`onMemberLeft`/`onMemberRenamed` callbacks must be wrapped in refs (not passed directly to useEffect deps) to avoid re-subscribing on every render. Use `useRef` for each callback and update on render:

```typescript
const onMemberJoinedRef = useRef(onMemberJoined);
onMemberJoinedRef.current = onMemberJoined;
// Then in useEffect:
const unsubJoined = client.onMemberJoined((p) => onMemberJoinedRef.current?.(p));
```

- [ ] **Step 2: Build to verify types**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/realtime/useRealtimeRoom.ts
git commit -m "feat: expose member event callbacks and sendRename in useRealtimeRoom"
```

---

## Chunk 4: Toast Component

### Task 9: Toast Component and useToasts Hook

**Files:**
- Create: `apps/web/src/components/Toast.tsx`

- [ ] **Step 1: Create the Toast component**

```typescript
// apps/web/src/components/Toast.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface ToastItem {
  id: string;
  message: string;
  color: string;
  type: "join" | "leave" | "rename";
}

const MAX_TOASTS = 3;
const TOAST_DURATION_MS = 3000;
const FADE_DURATION_MS = 500;

export function useToasts() {
  const [toasts, setToasts] = useState<(ToastItem & { fadingOut: boolean })[]>([]);
  const counterRef = useRef(0);

  const addToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `toast-${++counterRef.current}`;
    setToasts((prev) => {
      const next = [...prev, { ...toast, id, fadingOut: false }];
      // Trim to max
      if (next.length > MAX_TOASTS) {
        return next.slice(next.length - MAX_TOASTS);
      }
      return next;
    });

    // Start fade-out
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, fadingOut: true } : t))
      );
    }, TOAST_DURATION_MS - FADE_DURATION_MS);

    // Remove
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return { toasts, addToast };
}

export function ToastContainer({
  toasts,
}: {
  toasts: (ToastItem & { fadingOut: boolean })[];
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            background: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 8,
            color: toast.type === "leave" ? "#9ca3af" : "#f9fafb",
            fontSize: "0.8125rem",
            fontFamily: "system-ui, sans-serif",
            opacity: toast.fadingOut ? 0 : 1,
            transition: `opacity ${FADE_DURATION_MS}ms ease-out`,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: toast.color,
              flexShrink: 0,
            }}
          />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify manually by importing in the room page temporarily (or skip — integration comes in Task 11)**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/Toast.tsx
git commit -m "feat: add Toast component with useToasts hook"
```

---

## Chunk 5: TopBar Presence Pills + Inline Rename

### Task 10: Add Presence Pills and Inline Rename to TopBar

**Files:**
- Modify: `apps/web/src/components/TopBar.tsx`
- Modify: `apps/web/src/components/TopBar.test.tsx`

- [ ] **Step 1: Update TopBar props and add presence pills**

In `apps/web/src/components/TopBar.tsx`:

1. Add import: `import type { Member } from "@puid-board/shared";`

2. Update `TopBarProps`:
   ```typescript
   export type TopBarProps = {
     roomCode: string;
     latencyMs: number;
     members?: Member[];
     clientId?: string;
     onRename?: (newName: string) => void;
   };
   ```
   (Keep `members`, `clientId`, `onRename` optional so existing usages in loading/error states don't break.)

3. Add state for inline editing:
   ```typescript
   const [editing, setEditing] = useState(false);
   const [editName, setEditName] = useState("");
   const [lastRenameAt, setLastRenameAt] = useState(0);
   const editInputRef = useRef<HTMLInputElement>(null);
   ```

4. Build the pills list:
   - Current user's pill first (find by `clientId`)
   - Then other members sorted by `joinedAt`
   - If > 5 total, show first 4 + "+N" pill
   - Current user's pill gets `(You)` suffix and a `border: 1px solid {color}`
   - Current user's pill is clickable → enters editing mode

5. When editing:
   - Replace pill text with `<input>` (same dimensions)
   - On Enter or blur: validate (non-empty, max 32), call `onRename`, exit editing
   - On Escape: revert, exit editing
   - Throttle: skip if `Date.now() - lastRenameAt < 5000`
   - `useEffect` to focus the input when `editing` becomes true

6. Render pills in a `<div>` with `style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}` placed inside the header after the latency span.

Pill styles:
```typescript
const pillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 10px",
  background: "#374151",
  borderRadius: 12,
  fontSize: "0.75rem",
  color: "#f9fafb",
  whiteSpace: "nowrap" as const,
};
```

- [ ] **Step 2: Update TopBar test**

In `apps/web/src/components/TopBar.test.tsx`, the existing tests import `getLatencyColor` and `generateRoomCode` which are pure functions — they should still pass without changes since those exports haven't changed. Verify:

Run: `cd apps/web && npx vitest run src/components/TopBar.test.tsx`
Expected: PASS (no new required props break the unit tests since they only test exported functions, not the component render)

- [ ] **Step 3: Verify manually**

- Open a room with 2 browser tabs
- Verify pills show for both members
- Verify "(You)" suffix on your own pill
- Click your pill — verify inline edit appears
- Type new name, press Enter — verify rename works

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/TopBar.tsx apps/web/src/components/TopBar.test.tsx
git commit -m "feat: add presence pills and inline rename to TopBar"
```

---

## Chunk 6: Integration — Wire Everything Together

### Task 11: Wire TopBar Props + Toasts in Room Page

**Files:**
- Modify: `apps/web/src/app/room/[code]/page.tsx`

- [ ] **Step 1: Update RoomContent to pass new TopBar props**

In `apps/web/src/app/room/[code]/page.tsx`:

1. Import `{ useToasts, ToastContainer }` from `@/components/Toast`.
2. Import `{ setUsername }` from `@/utils/username`.

3. Update `RoomContent` props to include `sendRename`:
   ```typescript
   function RoomContent({
     state,
     clientId,
     latencyMs,
     sendEvent,
     nextSeq,
     sendRename,
   }: {
     state: RoomState;
     clientId: string;
     latencyMs: number;
     sendEvent: (e: ClientMutationEvent) => void;
     nextSeq: () => number;
     sendRename?: (newName: string) => void;
   }) {
   ```

4. Add `handleRename` callback inside `RoomContent`:
   ```typescript
   const handleRename = useCallback((newName: string) => {
     setUsername(newName);
     sendRename?.(newName);
   }, [sendRename]);
   ```

5. Pass new props to `<TopBar>`:
   ```typescript
   <TopBar
     roomCode={state.roomCode}
     latencyMs={latencyMs}
     members={state.members}
     clientId={clientId}
     onRename={handleRename}
   />
   ```

- [ ] **Step 2: Add toast integration to RealtimeRoomContent**

In `RealtimeRoomContent`:

1. Add `useToasts()` hook.
2. Pass member event callbacks to `useRealtimeRoom`:
   ```typescript
   const { toasts, addToast } = useToasts();

   const { state, clientId, latencyMs, status, error, sendEvent, sendRename } = useRealtimeRoom({
     roomCode: isCreating ? undefined : roomCode,
     name,
     create: isCreating,
     autoCreate: false,
     onMemberJoined: useCallback((p) => {
       // Don't toast for self
       if (clientId && p.clientId === clientId) return;
       addToast({ message: `${p.name} joined`, color: p.color, type: "join" });
     }, [addToast, clientId]),
     onMemberLeft: useCallback((p) => {
       addToast({ message: `${p.name} left`, color: p.color, type: "leave" });
     }, [addToast]),
     onMemberRenamed: useCallback((p) => {
       addToast({ message: `${p.oldName} is now ${p.newName}`, color: "#9ca3af", type: "rename" });
     }, [addToast]),
   });
   ```

   **Note:** The `clientId` reference in `onMemberJoined` may be stale. Use a ref instead:
   ```typescript
   const clientIdRef = useRef<string | null>(null);
   clientIdRef.current = clientId;
   // Then in callback:
   if (clientIdRef.current && p.clientId === clientIdRef.current) return;
   ```

3. Add `<ToastContainer toasts={toasts} />` just before the closing `</div>` of the return.

4. Pass `sendRename` down to `RoomContent`:
   ```typescript
   <RoomContent
     state={state}
     clientId={clientId}
     latencyMs={latencyMs}
     sendEvent={sendEvent}
     nextSeq={nextSeq}
     sendRename={sendRename}
   />
   ```

- [ ] **Step 3: Update MockRoomContent similarly**

Pass `members` and `clientId` props to TopBar in `MockRoomContent`:
```typescript
<RoomContent
  state={state}
  clientId={state.hostId}
  latencyMs={latencyMs}
  sendEvent={sendEvent}
  nextSeq={() => room.nextClientSeq()}
/>
```
(This already passes `state` which contains `members`, so TopBar will render the host pill.)

- [ ] **Step 4: Verify full flow**

1. Start the realtime server: `cd apps/realtime && npm run dev`
2. Start the web app: `cd apps/web && npm run dev`
3. Open two browser windows to the same room
4. Verify:
   - Both users see presence pills with their names and colors
   - Join toast appears when second user joins (not shown to self)
   - Click your pill → rename → other user sees rename toast + pill updates
   - Close a tab → leave toast appears for the other user (after grace period)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/room/[code]/page.tsx
git commit -m "feat: integrate presence pills and join/leave/rename toasts in room page"
```

### Task 12: Final Verification

- [ ] **Step 1: Run all tests**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: TypeScript check across all packages**

Run: `cd packages/shared && npx tsc --noEmit && cd ../../apps/web && npx tsc --noEmit && cd ../realtime && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Manual end-to-end test**

1. Set username on home screen
2. Create room
3. Join from second browser
4. Verify presence pills for both users
5. Rename via pill click
6. Disconnect second browser — verify leave toast
7. Reconnect — verify rejoin works and name persists

- [ ] **Step 4: Final commit if any fixes needed**
