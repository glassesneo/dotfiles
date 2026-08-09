import assert from "node:assert/strict";
import test from "node:test";
import { modeIdentityText } from "../extensions_src/mode.ts";
void test("mode status identifies the top-level caller", () => { const status = modeIdentityText("recon"); assert.match(status, /PARENT/u); assert.match(status, /mode:recon/u); });
