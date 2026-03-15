# Multiplayer Presence UI

## Overview

Add room presence awareness to the multiplayer DJ board: who's in the room (presence pills in the TopBar), join/leave notifications (toast), and a persistent username system with fun randomly generated names.

## 1. Username System

### 1.1 Random Name Generator

Generate fun DJ-style names from two word lists combined with an optional numeric suffix.

**Adjective pool (~20):** Iron, Neon, Cyber, Cosmic, Velvet, Turbo, Shadow, Crystal, Hyper, Golden, Stealth, Lunar, Phantom, Atomic, Blazing, Frozen, Thunder, Mystic, Savage, Radical

**Noun pool (~20):** Moose, Falcon, Panther, Cobra, Phoenix, Wolf, Tiger, Hawk, Viper, Lynx, Raven, Shark, Dragon, Mustang, Jaguar, Coyote, Condor, Mantis, Badger, Orca

**Format:** `{Adjective}{Noun}` — e.g. "IronMoose", "NeonFalcon", "CyberPanther". Append a random 1-3 digit number if desired for uniqueness (e.g. "TurboWolf42").

**Location:** New utility file `apps/web/src/utils/generateName.ts` exporting `generateRandomName(): string`.

### 1.2 localStorage Persistence

- **Key:** `puid-username`
- **First visit:** Generate a random name via the generator, store it.
- **Return visits:** Read from localStorage; skip generation.
- **On edit:** Overwrite localStorage immediately.

### 1.3 Home Screen (`apps/web/src/app/page.tsx`)

Add a username field above the existing Create Room / Join section:

```
Username: [IronMoose42    ] [pencil icon or "edit" affordance]
```

- Renders as an inline-editable text field.
- On page load, reads from localStorage (or generates + stores if absent).
- Edits update localStorage on blur / Enter.
- Max length: 20 characters.
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
- On confirm: call `onRename(newName)` prop, which sends `MEMBER_RENAME` event and updates localStorage.
- Validate: non-empty, max 20 chars. If empty, revert to previous name.

## 3. Join/Leave Toast Notifications

### 3.1 Toast Component

New file: `apps/web/src/components/Toast.tsx`

- Fixed position, top-right corner of viewport (`position: fixed; top: 16px; right: 16px; z-index: 9999`).
- Each toast: a small card with the member's color dot, message text, and auto-dismiss.
- Renders a vertical stack of active toasts with `8px` gap between them.

### 3.2 Toast Content

- **Join:** `"● {name} joined"` — dot uses the member's color.
- **Leave:** `"● {name} left"` — dot uses the member's color, text slightly dimmed.

### 3.3 Behavior

- Auto-dismiss after 3 seconds.
- Fade-out animation over the last 500ms (opacity 1 → 0).
- Max 3 visible toasts. If a 4th arrives, the oldest is immediately dismissed.
- Don't show a toast for the current user joining (they already know).

### 3.4 Integration

- The room page component (`RoomContent` or the parent) listens for member changes by comparing `members` array across state updates.
- When a new member appears (by `clientId`) that wasn't in the previous state → show join toast.
- When a member disappears → show leave toast.
- Implemented as a `useToasts()` hook + `<ToastContainer />` component.

## 4. Backend: MEMBER_RENAME Event

### 4.1 Shared Schema (`packages/shared/src/events.ts`)

Add new event type to `ClientMutationEvent`:

```typescript
{
  type: "MEMBER_RENAME";
  roomId: string;
  clientId: string;
  clientSeq: number;
  payload: { name: string };
}
```

### 4.2 Server Handler (`apps/realtime/src/handlers/`)

New handler (can be added to an existing handler file or a small new file):

- Validate: `name` is a non-empty string, trimmed, max 20 chars.
- Find the member in room state by `clientId`.
- Update `member.name` to the new name.
- Bump room version.
- Broadcast updated room snapshot to all members.

### 4.3 No New Server Events for Join/Leave

Join and leave detection is handled client-side by diffing the `members` array across state snapshots. The server already broadcasts `ROOM_SNAPSHOT` on member join/leave, so no new server events are needed for toasts.

## 5. File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/utils/generateName.ts` | NEW — random DJ name generator |
| `apps/web/src/app/page.tsx` | Add username field with localStorage |
| `apps/web/src/app/room/[code]/page.tsx` | Read username from localStorage, pass `members`/`clientId`/`onRename` to TopBar, add toast integration |
| `apps/web/src/components/TopBar.tsx` | Add presence pills, inline rename |
| `apps/web/src/components/Toast.tsx` | NEW — toast notification component + `useToasts` hook |
| `packages/shared/src/events.ts` | Add `MEMBER_RENAME` event type |
| `apps/realtime/src/handlers/` | Add rename handler |
| `apps/realtime/src/protocol/handlers.ts` | Register rename handler |

## 6. Out of Scope

- Avatars / profile pictures
- Persistent accounts / auth
- Kick/ban functionality
- Typing indicators
- Sound effects for join/leave
