import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ProfileBadgeEditor } from "../extensions_src/profile.ts";

const theme = {
    borderColor: (text: string) => `\x1b[34m${text}\x1b[0m`,
    selectList: {
        selectedPrefix: (text: string) => text,
        selectedText: (text: string) => `\x1b[1m${text}\x1b[0m`,
        description: (text: string) => text,
        scrollInfo: (text: string) => text,
        noMatch: (text: string) => text,
    },
};

function editor() {
    let renders = 0;
    const tui = { requestRender() { renders += 1; }, terminal: { columns: 100, rows: 30 } };
    const keybindings = { matches(data: string, action: string) { return data === "ESC" && action === "app.interrupt"; } };
    return { value: new ProfileBadgeEditor(tui as never, theme, keybindings as never, "scout"), renders: () => renders };
}

void test("profile badge is textual, reacts to switches, and disappears rather than overflowing", () => {
    const fixture = editor();
    fixture.value.setText("ordinary editor text");
    const wide = fixture.value.render(60);
    assert.match(wide.at(-1) ?? "", /profile:scout/);
    assert.ok(wide.every(line => visibleWidth(line) <= 60));

    fixture.value.setProfileName("reviewer");
    assert.match(fixture.value.render(60).at(-1) ?? "", /profile:reviewer/);
    assert.ok(fixture.renders() > 0);
    const narrow = fixture.value.render(12);
    assert.doesNotMatch(narrow.join("\n"), /profile:/);
    assert.ok(narrow.every(line => visibleWidth(line) <= 12));
});

void test("profile badge editor preserves inherited text, padding, autocomplete surface, border color, and app shortcuts", () => {
    const fixture = editor();
    fixture.value.setPaddingX(3);
    fixture.value.setText("hello");
    fixture.value.setAutocompleteProvider({
        getSuggestions: async () => null,
        applyCompletion: lines => ({ lines: [...lines], cursorLine: 0, cursorCol: 0 }),
    });
    let interrupted = false;
    fixture.value.onAction("app.interrupt", () => { interrupted = true; });
    fixture.value.handleInput("ESC");

    assert.equal(interrupted, true);
    assert.equal(fixture.value.getText(), "hello");
    assert.equal(fixture.value.getPaddingX(), 3);
    assert.equal(fixture.value.borderColor("x"), "\x1b[34mx\x1b[0m");
    assert.match(fixture.value.render(60).at(-1) ?? "", /profile:scout/);
});
