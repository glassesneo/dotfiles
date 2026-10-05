import type { TextareaRenderable } from "@opentui/core";
import { createEffect } from "solid-js";
import type { JSX } from "@opentui/solid";

export interface EditorViewProps {
  /** The draft the controller currently shows; edits from elsewhere arrive here. */
  text: string;
  cursor: number;
  /** Body width in columns; a change re-wraps and re-measures the body. */
  bodyWidth: number;
  focused: boolean;
  bodyHeight: number;
  onContentChange: (text: string, cursor: number) => void;
  onCursorChange: (offset: number) => void;
  /** Wrapped line count for the current width, so the screen can size the editor. */
  onHeightChange: (virtualLines: number) => void;
}

/**
 * The single OpenTUI textarea. Enter is owned by the key registry, so only the
 * newline binding is kept here; wrapped height is measured after each layout and
 * content change.
 */
export function TextareaEngine(props: EditorViewProps): JSX.Element {
  let textarea: TextareaRenderable | undefined;
  let lastText: string | undefined;
  let lastCursor: number | undefined;
  let applyingSnapshot = false;

  const measure = () => {
    if (!textarea) {
      return;
    }
    // `virtualLineCount` is capped by the viewport height and layout timing, so
    // ask the editor view to wrap the buffer for the current body width instead.
    const measured = textarea.editorView.measureForDimensions(props.bodyWidth, props.bodyHeight);
    if (!measured) {
      return;
    }
    props.onHeightChange(measured.lineCount);

    // OpenTUI keeps the old vertical offset when content shrinks without a
    // viewport resize. Clamp it explicitly so deleted bottom lines do not leave
    // an unreachable blank row while the editor is still at its 8-row cap.
    const viewport = textarea.editorView.getViewport();
    const maxOffsetY = Math.max(0, measured.lineCount - viewport.height);
    if (viewport.offsetY > maxOffsetY) {
      textarea.editorView.setViewport(
        viewport.offsetX,
        maxOffsetY,
        viewport.width,
        viewport.height,
        false,
      );
      textarea.requestRender();
    }
  };

  // Text can change outside the textarea (draft switch, initial value, submit),
  // and a width change re-wraps it; both re-measure the wrapped line count. Only
  // a controller-visible change is pushed down, so a native edit that has not
  // round-tripped through `onContentChange` is never clobbered.
  createEffect(() => {
    const text = props.text;
    const cursor = props.cursor;
    props.bodyWidth;
    if (!textarea) {
      return;
    }
    const replaceText = text !== lastText && textarea.plainText !== text;
    applyingSnapshot = true;
    try {
      if (replaceText) textarea.setText(text);
      // An unchanged snapshot cursor must not undo a native edit before its
      // cursor callback round-trips. Replacing the buffer does need restoration.
      if (replaceText || cursor !== lastCursor) textarea.cursorOffset = cursor;
      lastText = text;
      lastCursor = cursor;
    } finally {
      applyingSnapshot = false;
    }
    measure();
  });

  return (
    <textarea
      id="harness-textarea"
      ref={textarea}
      focused={props.focused}
      height={props.bodyHeight}
      placeholder="prompt"
      keyBindings={[{ name: "return", shift: true, action: "newline" }]}
      onContentChange={() => {
        if (textarea && !applyingSnapshot) {
          props.onContentChange(textarea.plainText, textarea.cursorOffset);
          measure();
        }
      }}
      onCursorChange={() => {
        if (textarea && !applyingSnapshot) {
          props.onCursorChange(textarea.cursorOffset);
        }
      }}
      onSizeChange={measure}
    />
  );
}

/** The editor region view, currently backed by the OpenTUI textarea engine. */
export const EditorView = TextareaEngine;
