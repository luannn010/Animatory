# Chat "Thinking" Disclosure — Design

**Date:** 2026-06-04
**Status:** Draft (awaiting review)
**Depends on:** chat engine v2 (A1/A2), refine chat. Backend already streams
reasoning as `thinking` SSE events (`delta.reasoning_content`), gated by the
per-turn `thinking` flag.

## 1. Goal & Scope

Give the refine chat a Claude/Codex-style reasoning affordance: while the model
reasons, show the reasoning live in muted text under a "Thinking…" header; the
moment the answer begins, auto-collapse it to a "▸ Thought for a moment" line
the user can re-expand; keep that collapsed disclosure on the completed turn so
the reasoning is recoverable after the answer arrives.

Today the reasoning streams under a collapsible "Thinking…" block **only while
streaming** ([RefineChat.tsx:143-158](../../../frontend/src/components/refine/RefineChat.tsx));
on completion it is discarded — `assistantTurn` keeps only `content` + `toolCount`
([chatTurn.ts:14](../../../frontend/src/components/refine/chatTurn.ts)). The gap:
reasoning is not auto-collapsed when the answer starts, and it is not retained on
the finished turn.

**Frontend-only.** No backend or `chat_store` change. Reasoning is kept **in
memory for the session only** — reloading or reopening a session shows just the
answers (reasoning is treated as ephemeral, matching the chosen scope).

Out of scope: persisting reasoning across reload (would need a `chat_store`
schema + backend change); measuring/displaying a reasoning duration ("Thought for
5s") — the label is the static phrase "Thought for a moment"; changing the
default of the Thinking toggle (stays off; reasoning only appears when the user
enables Thinking).

## 2. Components & Data

### 2.1 `ChatDisplayMessage` gains `thinking`

```ts
export interface ChatDisplayMessage {
  role: 'user' | 'assistant'
  content: string
  toolCount?: number
  thinking?: string   // raw reasoning text, assistant turns only; in-memory only
}
```

### 2.2 `assistantTurn` carries reasoning

```ts
export function assistantTurn(reply: string, toolCount: number, thinking?: string): ChatDisplayMessage
```

Behaviour is otherwise unchanged: the empty-turn fallbacks ("Proposed changes." /
"No response.") still apply to `content`; `thinking` is attached only when a
non-empty string is passed (omitted otherwise, so `storedToDisplay` — which has
no reasoning to supply — produces turns with no disclosure, exactly as a reloaded
session should).

### 2.3 `ThinkingDisclosure` (new shared subcomponent, in `RefineChat.tsx`)

```tsx
function ThinkingDisclosure({ text, defaultOpen, label }: {
  text: string; defaultOpen: boolean; label: string
}): JSX.Element
```

Renders a toggle button (`▾`/`▸ {label}`, muted `text-steel`, focus ring) over a
collapsible `pre` of the reasoning in muted `text-stone` (small, mono,
`max-h-40 overflow-y-auto whitespace-pre-wrap`) — i.e. the existing visual,
factored out. Manages its own open/closed state, seeded from `defaultOpen`.

## 3. Data flow

### 3.1 Capture the streamed reasoning (`ChapterView`)

A `streamThinkingRef` mirrors the existing `streamReplyRef`:

- In `runTurn`, reset `streamThinkingRef.current = ''` alongside `streamReplyRef`.
- `onThinking: d => { streamThinkingRef.current += d; setStreamThinking(t => t + d) }`.
- `onDone`: commit `assistantTurn(reply, toolCount, streamThinkingRef.current)`
  (only when not errored, as today).
- `onAbortChat`: when committing a partial turn, also pass
  `streamThinkingRef.current` so a stopped turn keeps whatever it reasoned.

No other ChapterView logic changes.

### 3.2 Render — live stream (`RefineChat`)

Replace the inline live "Thinking…" block with the disclosure, keyed so it
auto-collapses when the answer starts:

```tsx
{streaming && (
  <div className="space-y-2">
    {thinkingEnabled && streamThinking && (
      <ThinkingDisclosure
        key={streamReply ? 'answering' : 'thinking'}   // remount flips open→closed
        text={streamThinking}
        defaultOpen={!streamReply}
        label={streamReply ? 'Thought for a moment' : 'Thinking…'}
      />
    )}
    <Bubble role="assistant" content={streamReply || '…'} />
  </div>
)}
```

`answerStarted = !!streamReply`. While the answer has not started, the disclosure
is open and labelled "Thinking…". When the first reply delta arrives, the changed
`key` remounts it `defaultOpen={false}` → it auto-collapses to "▸ Thought for a
moment"; the user can still click to expand. This removes the component-level
`showThoughts` state and its `useState` from `RefineChat`.

### 3.3 Render — completed turn (`RefineChat` `Bubble`)

`Bubble` takes an optional `thinking` prop; assistant turns with reasoning render
a collapsed disclosure above the answer:

```tsx
function Bubble({ role, content, toolCount, thinking }: {
  role: 'user' | 'assistant'; content: string; toolCount?: number; thinking?: string
}) {
  return (
    <div className={role === 'user' ? 'text-right' : 'text-left'}>
      {role === 'assistant' && thinking && (
        <div className="mb-1">
          <ThinkingDisclosure text={thinking} defaultOpen={false} label="Thought for a moment" />
        </div>
      )}
      <span className={/* unchanged bubble classes */}>{content}</span>
      {role === 'assistant' && toolCount ? (
        <div className="text-[10px] text-stone mt-0.5">proposed {toolCount} edit{toolCount === 1 ? '' : 's'}</div>
      ) : null}
    </div>
  )
}
```

The messages map passes `thinking={m.thinking}`.

## 4. ui-taste

One accent (`#3772cf`) only — the disclosure is fully muted (`text-steel`
control, `text-stone` body), no accent. Token-only spacing/radius. Toggle keeps a
`focus-visible:ring-2 focus-visible:ring-[#3772cf]`. `transition-colors` only.
`▾`/`▸` are text glyphs already used in this file (no new emoji). Reasoning block
keeps the bordered `bg-surface` container for separation from the answer.

## 5. Testing

- **`assistantTurn`** (vitest, `chatTurn.test.ts` — new): preserves a passed
  `thinking` string on the turn; omits `thinking` when none/empty is passed; the
  "Proposed changes." / "No response." content fallbacks are unchanged.
- **Components** verified by `npm run build` (no DOM test lib, per convention):
  the `showThoughts` `useState` removal and the new props compile cleanly.

## 6. Scene02 data correction (separate one-off)

Not a feature — a content fix applied alongside. Locate the parsed chapter whose
scene mis-attributes the "dog friends" lines (`"Từ An, sao rồi? Thành công
chưa?"`, `"Đúng đó, mau nói kết quả đi…"`, etc.) entirely to **Triệu Cao**,
re-attribute them to **Đám bạn chó** / **Trương An Thế** / **Từ An** by reading
the chapter source, and save the result as the chunk's `*_scenes.edited.json`
(the normal edited-scenes path) so the app shows the corrected dialogue. No code
change; the locator/source endpoint from the focus-panel work guides the
attribution.
