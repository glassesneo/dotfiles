// pi's own Bun executable runs this setup in its entry (dist/bun/runtime-setup.js),
// which SDK hosts do not import. QuickJS for codemode is left out: it also needs
// the codemode worker compiled in as an extra entrypoint.
import { bedrockProviderModule } from "@earendil-works/pi-ai/bedrock-provider";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { setBedrockProviderModule } from "@earendil-works/pi-ai/compat";

// As in pi's entry: warnings go straight to stderr, which corrupts the full-screen TUI.
process.emitWarning = () => {};
registerBunOAuthFlows();
setBedrockProviderModule(bedrockProviderModule);
