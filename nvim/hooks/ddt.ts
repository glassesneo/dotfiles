import {
  BaseConfig,
  type ConfigArguments,
} from "jsr:@shougo/ddt-vim@~1.0.0/config";

export class Config extends BaseConfig {
  override async config(args: ConfigArguments): Promise<void> {
    args.contextBuilder.patchGlobal({
      uiParams: {
        terminal: {
          command: ['zsh'],
          promptPattern: '\w*% \?',
        }
      }
    })
    await Promise.resolve();
  }
}
