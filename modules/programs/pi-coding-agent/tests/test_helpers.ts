import assert from "node:assert/strict";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export function extensionContext(options: {
    cwd?: string;
    mode: ExtensionContext["mode"];
    hasUI: boolean;
    ui?: Partial<ExtensionUIContext>;
}): ExtensionContext {
    const unexpected = () => {
        throw new Error("Unexpected UI call");
    };
    return {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        mode: options.mode,
        hasUI: options.hasUI,
        ui: {
            select: unexpected,
            input: unexpected,
            editor: unexpected,
            notify: unexpected,
            custom: unexpected,
            ...options.ui,
        } as ExtensionUIContext,
    } as ExtensionContext;
}

export async function yieldToIO(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
}

export async function eventually(predicate: () => boolean | Promise<boolean>, attempts = 200): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await predicate()) return;
        await yieldToIO();
    }
    assert.fail(`Condition was not met after ${attempts} event-loop turns`);
}

export function textResult(content: { type: string; text?: string }): string {
    assert.equal(content.type, "text");
    assert.equal(typeof content.text, "string");
    return content.text as string;
}
