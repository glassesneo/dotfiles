import type { TextareaRenderable } from "@opentui/core";

/**
 * The user's input, fixed below the transcript. Enter submits and Shift+Enter
 * inserts a newline. The text stays until pi accepts it, so a rejected
 * submission can be edited and sent again.
 */
export function PromptView(props: {
  focused: boolean;
  onSubmit: (text: string) => Promise<boolean>;
}) {
  let textarea: TextareaRenderable | undefined;
  let pending = false;

  const submit = async () => {
    const text = textarea?.plainText.trim() ?? "";
    if (pending || text.length === 0) {
      return;
    }
    pending = true;
    const accepted = await props.onSubmit(text);
    pending = false;
    if (accepted && textarea?.plainText.trim() === text) {
      textarea.clear();
    }
  };

  return (
    <box border paddingX={1} flexShrink={0}>
      <textarea
        ref={textarea}
        focused={props.focused}
        minHeight={1}
        maxHeight={8}
        placeholder="Message"
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "kpenter", action: "submit" },
          { name: "return", shift: true, action: "newline" },
        ]}
        onSubmit={submit}
      />
    </box>
  );
}
