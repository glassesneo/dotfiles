const modifierOrder = ["ctrl", "shift", "alt"] as const;
const modifiers = new Set<string>(modifierOrder);
const namedOrSymbolKey = /^(escape|esc|enter|return|tab|space|backspace|delete|insert|clear|home|end|pageUp|pageDown|up|down|left|right|f(?:[1-9]|1[0-2])|[`\-=\[\]\\;',./!@#$%^&*()_+|~{}:<>?])$/;

export function isValidKeyId(key: string): boolean {
    const parts = key.split("+");
    if (parts.some(part => part.length === 0)) return false;
    const base = parts.at(-1)!;
    const keyModifiers = parts.slice(0, -1);
    if (new Set(keyModifiers).size !== keyModifiers.length || keyModifiers.some(modifier => !modifiers.has(modifier))) return false;
    return /^[a-z0-9]$/.test(base) || namedOrSymbolKey.test(base);
}

export function canonicalKeyId(key: string): string {
    const parts = key.split("+");
    const base = parts.at(-1)!;
    const ordered = parts.slice(0, -1).sort((left, right) => modifierOrder.indexOf(left as typeof modifierOrder[number]) - modifierOrder.indexOf(right as typeof modifierOrder[number]));
    return [...ordered, base].join("+");
}
