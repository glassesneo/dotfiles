import {
  BaseConfig,
  type ConfigArguments,
} from "jsr:@shougo/ddt-vim@~1.0.0/config";

export class Config extends BaseConfig {
  override async config(args: ConfigArguments): Promise<void> {
    args.contextBuilder.patchGlobal({
      ui: "shell",
      uiParams: {
        shell: {
          // nvimServer: "~/.cache/nvim/server.pipe",
          prompt: "%",
          // promptPattern: "\w*=\\\> \?",
        },
        terminal: {
          nvimServer: "~/.cache/nvim/server.pipe",
          command: ["nu"],
          promptPattern: "\w*% \?",
        },
      },
    });
    await Promise.resolve();
  }
}
