import { engine } from "@opentui/core";
import { type JSX, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import { setupDefaultUI } from "../contributions/default";
import type { SessionHost } from "../core/session";
import {
  type NoticeLevel,
  notice,
  reduceSessionEntries,
  type SessionEntry,
  sessionEntriesFromMessages,
} from "../core/session-entries";
import { StageView, setupStageUI } from "./stage";
import type { TimelineItem } from "./controllers";
import { createItemActions, type TimelineScrollBox } from "./item-actions";
import { createExtensionUI } from "./extension-ui";
import { allocateHeights, createHarnessUI, type HarnessUIActions, type HarnessUIInstance } from "./harness-ui";
import { EditorView } from "./editor";
import { createSessionItemTypes, projectSession, TimelineView } from "./timeline";

import { useVersion } from "./state";

export interface ScreenLayoutProps<Render = unknown> {
  ui: HarnessUIInstance<Render>;
  timeline: JSX.Element;
  stage?: () => JSX.Element;
  onOverlayHeight?(rows: number): void;
}

/**
 * Timeline fills the screen; the editor is drawn over its bottom edge and stage
 * sits directly on top of the editor. Only the focused region's renderable takes
 * focus, and both overlays are recomputed from terminal size and content.
 */
export function ScreenLayout<Render>(props: ScreenLayoutProps<Render>): JSX.Element {
  const { regions, editor, stage } = props.ui.controllers;
  const dimensions = useTerminalDimensions();
  const version = useVersion(regions, editor, stage);

  const focusedRegion = () => (version(), regions.current());
  const snapshot = () => (version(), editor.snapshot());
  const stageActive = () => (version(), stage.hasActive());

  const hasStage = () => stageActive() ? Boolean(props.stage) : Boolean(snapshot().assist?.items.length);
  const assistView = () => (
    <box flexDirection="column">
      <For each={snapshot().assist?.items ?? []}>
        {(item, index) => <text>{`${index() === snapshot().assist?.cursor ? "▶ " : "  "}${item}`}</text>}
      </For>
    </box>
  );

  // The one global key handler: resolve the focused region's binding, suppress
  // the key's native handling, then run the action exactly once.
  useKeyboard((key) => {
    const action = regions.resolve(key);
    if (!action) {
      return;
    }
    key.preventDefault();
    action();
  });

  const allocation = createMemo(() =>
    allocateHeights(
      dimensions().height,
      { preferredHeight: snapshot().preferredHeight },
      {
        preferredHeight: stageActive()
          ? (stage.active()?.preferredHeight ?? 0)
          : (editor.snapshot().assist?.items.length ?? 0),
      },
    ),
  );

  // The editor has no side border, so its body spans the whole terminal width
  // at every height and the textarea wrap measurement uses the same width.
  const bodyWidth = () => Math.max(1, dimensions().width);

  createEffect(() => {
    props.onOverlayHeight?.(allocation().editor + allocation().stage);
  });

  // A stage with no room left cannot hold focus; read
  // the reactive focus so a later request cannot leave it on a collapsed stage.
  createEffect(() => {
    if (allocation().stage === 0 && focusedRegion() === "stage") {
      regions.requestFocus("editor");
    }
  });

  return (
    <box width="100%" height="100%">
      <box
        id="harness-timeline"
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={1}
        focusable
        focused={focusedRegion() === "timeline"}
        onMouseDown={() => regions.requestFocus("timeline")}
      >
        {/* Keep the timeline laid out at full terminal size, but clip its paint at
            the transparent overlays so timeline glyphs do not show through. */}
        <box
          id="harness-timeline-clip"
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height={Math.max(0, dimensions().height - allocation().editor - allocation().stage)}
          overflow="hidden"
        >
          <box
            position="absolute"
            top={0}
            left={0}
            width={dimensions().width}
            height={dimensions().height}
            flexDirection="column"
          >
            {props.timeline}
          </box>
        </box>
      </box>
      {hasStage() && allocation().stage > 0 ? (
        <box
          id="harness-stage"
          position="absolute"
          left={0}
          bottom={allocation().editor}
          width="100%"
          height={allocation().stage}
          zIndex={3}
          focusable
          focused={focusedRegion() === "stage"}
          onMouseDown={() => regions.requestFocus("stage")}
        >
          {stageActive() ? props.stage?.() : assistView()}
        </box>
      ) : null}
      <box
        id="harness-editor"
        position="absolute"
        left={0}
        bottom={0}
        width="100%"
        height={allocation().editor}
        zIndex={2}
        title={allocation().chrome > 0 ? `${focusedRegion() === "editor" ? "▶" : " "} ${snapshot().label ?? "prompt"} [${focusedRegion()}]` : undefined}
        onMouseDown={() => regions.requestFocus("editor")}
        // Border color is constant while chrome is absent: the `borderColor`
        // setter re-enables a border when it changes, and the `border` prop is
        // applied after it so the chrome-less frame wins.
        borderColor={
          allocation().chrome > 0 && focusedRegion() === "editor" ? "#89b4fa" : "#45475a"
        }
        border={allocation().chrome > 0 ? ["top", "bottom"] : false}
      >
        <EditorView
          text={snapshot().text}
          cursor={snapshot().cursor}
          bodyWidth={bodyWidth()}
          focused={focusedRegion() === "editor"}
          bodyHeight={allocation().body}
          onContentChange={(text, cursor) => editor.setText(text, cursor)}
          onCursorChange={(offset) => editor.setCursor(offset)}
          onHeightChange={(lines) => editor.reportHeight(lines)}
        />
      </box>
    </box>
  );
}

/** Session events and contributions meet at the screen, not in its views. */
export function Screen(props: { host: SessionHost; startupNotices: readonly SessionEntry[] }) {
  const renderer = useRenderer();
  const [entries, setEntries] = createSignal<readonly SessionEntry[]>(props.startupNotices);
  // Messages waiting for the current run; each enters the timeline when it starts.
  const [queued, setQueued] = createSignal<readonly string[]>([]);
  let scrollbox: TimelineScrollBox | undefined;
  const [overlayHeight, setOverlayHeight] = createSignal(0);

  const addNotice = (level: NoticeLevel, text: string) =>
    setEntries((current) => [...current, notice(level, text)]);

  /** Resolves once pi accepts or rejects the text, not when the run finishes. */
  const submit = (text: string) =>
    new Promise<boolean>((resolve) => {
      props.host.runtime.session
        .prompt(text, {
          // pi applies streamingBehavior only when a run is in progress.
          streamingBehavior: "followUp",
          // Called once the prompt is accepted (started, queued, or handled),
          // never for a rejected one; pi's RPC mode answers its client from it.
          preflightResult: () => resolve(true),
        })
        .then(
          () => resolve(true),
          (error) => {
            addNotice("error", error instanceof Error ? error.message : String(error));
            resolve(false);
          },
        );
    });

  const ui = createHarnessUI<JSX.Element>({ sendPrompt: submit });
  const editor = ui.controllers.editor;
  const stageUI = setupStageUI(ui);
  const extensionUI = createExtensionUI({ ui, ...stageUI, notify: addNotice });
  const types = createSessionItemTypes();
  const itemTypeRegistrations = [ui.timeline.registerType(types.user), ui.timeline.registerType(types.assistant), ui.timeline.registerType(types.code), ui.timeline.registerType(types.tool), ui.timeline.registerType(types.notice)];
  const itemActions = createItemActions({ timeline: ui.controllers.timeline, scrollbox: () => scrollbox, overlayHeight, renderer, notify: addNotice });
  let sessionItemIds = new Set<string>();
  const projectionCache = new Map<string, { version: number; items: readonly TimelineItem<JSX.Element>[] }>();
  let resetTimeline = false;
  createEffect(() => {
    if (resetTimeline) projectionCache.clear();
    const projected = entries().flatMap((entry) => {
      let cached = projectionCache.get(entry.id);
      if (!cached || cached.version !== entry.version) {
        cached = { version: entry.version, items: projectSession([entry], types) };
        projectionCache.set(entry.id, cached);
      }
      return cached.items;
    });
    const byId = new Map(projected.map((entry) => [entry.id, entry]));
    const items: TimelineItem<JSX.Element>[] = resetTimeline ? [] : ui.controllers.timeline.items().flatMap((entry) => {
      const replacement = byId.get(entry.id);
      return sessionItemIds.has(entry.id) ? (replacement ? [replacement] : []) : [entry];
    });
    const present = new Set(items.map((entry) => entry.id));
    for (const entry of projected) {
      if (present.has(entry.id)) continue;
      present.add(entry.id);
      const prefix = entry.id.includes(":part:") ? entry.id.split(":part:")[0] + ":part:" : undefined;
      const previous = prefix ? items.findLastIndex((old) => old.id.startsWith(prefix)) : -1;
      items.splice(previous < 0 ? items.length : previous + 1, 0, entry);
    }
    sessionItemIds = new Set(byId.keys());
    resetTimeline = false;
    ui.controllers.timeline.replace(items);
  });

  const runStage = (action: string) => {
    const active = ui.controllers.stage.active();
    if (active) { void Promise.resolve().then(() => active.runAction(action)).catch((error) => addNotice("error", String(error))); return; }
    const assist = editor.snapshot().assist;
    if (!assist) return;
    if (action === "next" || action === "previous") {
      editor.setAssist({ ...assist, cursor: Math.max(0, Math.min(assist.items.length - 1, assist.cursor + (action === "next" ? 1 : -1))) });
    } else {
      if (action === "confirm" && assist.items[assist.cursor] !== undefined) editor.setText(assist.items[assist.cursor]!);
      editor.setAssist(undefined);
      ui.regions.requestFocus("editor");
    }
  };

  const actions: HarnessUIActions = {
    submit: () => {
      if (editor.activeDraft()) {
        editor.submitDraft();
      } else {
        void editor.submitPrompt();
      }
    },
    cancel: () => {
      if (editor.activeDraft()) {
        editor.cancelDraft();
        return;
      }
      const session = props.host.runtime.session;
      if (session.isStreaming) {
        void session.abort();
      }
    },
    quit: () => {
      void disposeUI().then(() => props.host.dispose()).finally(() => renderer.destroy());
    },
    focusFromEditor: (target) => editor.requestFocus(target),
    moveTimelineCursor: itemActions.move,
    scrollTimeline: itemActions.scroll,
    copyTimelineItem: () => { void itemActions.copy(); },
    moveStageCursor: (delta) => runStage(delta > 0 ? "next" : "previous"),
    confirmStage: () => runStage("confirm"),
    cancelStage: () => runStage("cancel"),
  };

  const registrations = [...itemTypeRegistrations, ...setupDefaultUI(ui, actions)];
  let disposing: Promise<void> | undefined;
  const disposeUI = () => disposing ??= (async () => {
    extensionUI.dispose(); stageUI.dispose();
    for (const registration of registrations) registration.dispose();
    await itemActions.dispose();
  })();
  onCleanup(() => { void disposeUI(); });

  onCleanup(() => engine.detach());
  onMount(() => {
    engine.attach(renderer);
    props.host
      .bind({
        uiContext: extensionUI.context,
        onEvent: (event) => {
          if (event.type === "queue_update") {
            setQueued([...event.steering, ...event.followUp]);
          }
          setEntries((current) => reduceSessionEntries(current, event));
        },
        onExtensionError: (error) =>
          addNotice("error", `${error.extensionPath} (${error.event}): ${error.error}`),
        onShutdownRequest: actions.quit,
        onHistoryReplaced: (session) => {
          resetTimeline = true;
          setEntries(sessionEntriesFromMessages(session.messages));
          setQueued([...session.getSteeringMessages(), ...session.getFollowUpMessages()]);
        },
      })
      .catch((error) => addNotice("error", String(error)));
  });

  return (
    <ScreenLayout
      ui={ui}
      onOverlayHeight={setOverlayHeight}
      stage={() => <StageView ui={ui} />}
      timeline={
        <>
          <TimelineView timeline={ui.controllers.timeline} queued={queued()} overlayHeight={overlayHeight()} scrollRef={(element) => (scrollbox = element)} />
        </>
      }
    />
  );
}
