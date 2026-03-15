# Multiplayer Presence UI

## Overview

Add room presence awareness to the multiplayer DJ board: who's in the room (presence pills in the TopBar), join/leave notifications (toast), and a persistent username system with fun randomly generated names.

## 1. Username System

### 1.1 Random Name Generator

Generate fun DJ-style names from two word lists combined with a numeric suffix.

**Adjective pool (~20):** Iron, Neon, Cyber, Cosmic, Velvet, Turbo, Shadow, Crystal, Hyper, Golden, Stealth, Lunar, Phantom, Atomic, Blazing, Frozen, Thunder, Mystic, Savage, Radical

**Noun pool (~20):** Moose, Falcon, Panther, Cobra, Phoenix, Wolf, Tiger, Hawk, Viper, Lynx, Raven, Shark, Dragon, Mustang, Jaguar, Coyote, Condor, Mantis, Badger, Orca

**Format:** `{Adjective}{Noun}{NN}` — always append a 2-digit suffix (00-99). E.g. "IronMoose42", "NeonFalcon07", "CyberPanther88". This gives 20 x 20 x 100 = 40,000 unique names.

**Location:** New utility file `apps/web/src/utils/generateName.ts` exporting `generateRandomName(): string`. Pure function, no browser APIs.

### 1.2 localStorage Persistence

- **Key:** `puid-username`
- **First visit:** Generate a random name via the generator, store it.
- **Return visits:** Read from localStorage; skip generation.
- **On edit:** Overwrite localStorage immediately.
- **Guard:** All localStorage access must happen in `"use client"` components (both `page.tsx` files already are).

### 1.3 Home Screen (`apps/web/src/app/page.tsx`)

Add a username field above the existing Create Room / Join section:

```
Username: [IronMoose42    ] [pencil icon or "edit" affordance]
```

- Renders as an inline-editable text field.
- On page load, reads from localStorage (or generates + stores if absent).
- Edits update localStorage on blur / Enter.
- Max length: 32 characters (matches existing `MemberSchema` max).
- Non-empty validation — if user clears it, regenerate a random name.

### 1.4 Room Page Integration (`apps/web/src/app/room/[code]/page.tsx`)

- Replace the current `useState(() => \`User\${Math.floor(Math.random() * 1000)}\`)` on line 100 with a read from localStorage (falling back to generate + store).
- Pass the username to `useRealtimeRoom({ name })`.

## 2. Presence Pills (TopBar)

### 2.1 Props Change

`TopBar` receives new props:

```typescript
export type TopBarProps = {
  roomCode: string;
  latencyMs: number;
  members: Member[];    // NEW — full members array from RoomState
  clientId: string;     // NEW — current user's clientId
  onRename: (newName: string) => void;  // NEW — callback when user renames
};
```

### 2.2 Layout

Existing content (room code, copy buttons, latency) stays on the left. Presence pills are pushed to the right via `margin-left: auto`.

If more than 5 members, show the first 4 pills + a "+N more" overflow indicator to prevent TopBar overflow on narrow screens.

### 2.3 Pill Rendering

Each member rendered as a small pill/chip:

```
[● IronMoose42 (You)]  [● NeonFalcon]  [● CyberPanther]
```

- `●` is a small colored circle matching the member's assigned `color`.
- Current user's pill appears first, with "(You)" suffix and a `1px solid` border in their color for differentiation.
- Other members sorted by `joinedAt` ascending.
- Pill style: `background: #374151`, `border-radius: 12px`, `padding: 4px 10px`, `font-size: 0.75rem`, `color: #f9fafb`.

### 2.4 Inline Rename

- Clicking the current user's pill replaces the name text with a small `<input>` field (same size as the pill).
- Press Enter or blur to confirm. Escape to cancel.
- On confirm: call `onRename(newName)` prop, which sends `MEMBER_RENAME` to the server and updates localStorage.
- Validate: non-empty, max 32 chars. If empty, revert to previous name.
- Focus management: on click, focus moves to input. On Escape, focus returns to the pill.
- Throttle: one rename per 5 seconds client-side to prevent spam.

## 3. Join/Leave Toast Notifications

### 3.1 Toast Component

New file: `apps/web/src/components/Toast.tsx`

- Fixed position, top-right corner of viewport (`position: fixed; top: 16px; right: 16px; z-index: 9999`).
- Each toast: a small card with the member's color dot, message text, and auto-dismiss.
- Renders a vertical stack of active toasts with `8px` gap between them.

### 3.2 Toast Content

- **Join:** `"● {name} joined"` — dot uses the member's color.
- **Leave:** `"● {name} left"` — dot uses the member's color, text slightly dimmed.
- **Rename:** `"● {oldName} is now {newName}"` — dot uses the member's color.

### 3.3 Behavior

- Auto-dismiss after 3 seconds.
- Fade-out animation over the last 500ms (opacity 1 → 0).
- Max 3 visible toasts. If a 4th arrives, the oldest is immediately dismissed.
- Don't show a toast for the current user joining (they already know).

### 3.4 Integration

The `RealtimeClient` already receives discrete `MEMBER_JOINED` and `MEMBER_LEFT` events from the server. Use these directly:

- Add `onMemberJoined` and `onMemberLeft` listener callbacks to `RealtimeClient`, following the existing pattern of `onSamplerPlay`/`onSamplerChange`.
- Add `onMemberRenamed` listener for rename broadcasts.
- Expose these in `useRealtimeRoom` hook as callback options.
- The room page subscribes to these callbacks and triggers toasts via a `useToasts()` hook + `<ToastContainer />` component.
- Don't fire join toast for the current user's own `clientId`.

## 4. Backend: MEMBER_RENAME Event

### 4.1 Event Architecture

`MEMBER_RENAME` is a **standalone client-to-server event**, NOT a `ClientMutationEvent`. It follows the same pattern as `JOIN_ROOM` / `LEAVE_ROOM` — member metadata, not room state mutations.

**Client-to-server event** (`MEMBER_RENAME`):
```typescript
// In packages/shared/src/events.ts — standalone schema, not in ClientMutationEventSchema
const MemberRenamePayloadSchema = z.object({
  name: z.string().min(1).max(32).trim(),
});

const MemberRenameEventSchema = z.object({
  type: z.literal("MEMBER_RENAME"),
  roomId: z.string(),
  clientId: z.string(),
  payload: MemberRenamePayloadSchema,
});
```

**Server-to-client broadcast** (`MEMBER_RENAMED`):
```typescript
const MemberRenamedBroadcastSchema = z.object({
  type: z.literal("MEMBER_RENAMED"),
  clientId: z.string(),
  oldName: z.string(),
  newName: z.string(),
});
```

### 4.2 Server Handler (`apps/realtime/src/handlers/`)

New handler file `apps/realtime/src/handlers/member.ts`:

- Validate payload with `MemberRenamePayloadSchema`.
- Find the member in room state by `clientId`.
- Update `member.name` to the new trimmed name.
- Bump room version.
- Broadcast `MEMBER_RENAMED` event (with `oldName` and `newName`) to all members in the room.

Register this handler in `apps/realtime/src/protocol/handlers.ts`.

### 4.3 Client Handler (`apps/web/src/realtime/client.ts`)

Add a listener for `MEMBER_RENAMED` in `registerSocketHandlers()`:

- Update the member's name in the local state's `members` array.
- Fire `onMemberRenamed` callback with `{ clientId, oldName, newName }`.

## 5. File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/utils/generateName.ts` | NEW — random DJ name generator |
| `apps/web/src/app/page.tsx` | Add username field with localStorage |
| `apps/web/src/app/room/[code]/page.tsx` | Read username from localStorage, pass `members`/`clientId`/`onRename` to TopBar, add toast integration |
| `apps/web/src/components/TopBar.tsx` | Add presence pills, inline rename |
| `apps/web/src/components/Toast.tsx` | NEW — toast notification component + `useToasts` hook |
| `packages/shared/src/events.ts` | Add `MemberRenameEventSchema`, `MemberRenamedBroadcastSchema` (standalone, not in mutation union) |
| `apps/realtime/src/handlers/member.ts` | NEW — rename handler |
| `apps/realtime/src/protocol/handlers.ts` | Register `MEMBER_RENAME` handler |
| `apps/web/src/realtime/client.ts` | Add `MEMBER_RENAMED` listener, expose `onMemberJoined`/`onMemberLeft`/`onMemberRenamed` callbacks |
| `apps/web/src/realtime/useRealtimeRoom.ts` | Expose member event callbacks |

## 6. Out of Scope

- Avatars / profile pictures
- Persistent accounts / auth
- Kick/ban functionality
- Typing indicators
- Sound effects for join/leave
