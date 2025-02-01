import type {
  Ext as LazyExt,
  LazyMakeStateResult,
  Params as LazyParams,
} from "jsr:@shougo/dpp-ext-lazy@~1.5.0";
import type {
  Ext as TomlExt,
  Params as TomlParams,
} from "jsr:@shougo/dpp-ext-toml@~1.3.0";
import {
  BaseConfig,
  type ConfigReturn,
  type MultipleHook,
} from "jsr:@shougo/dpp-vim@~4.1.0/config";
import type { Protocol } from "jsr:@shougo/dpp-vim@~4.1.0/protocol";
import type {
  ContextBuilder,
  ExtOptions,
  Plugin,
} from "jsr:@shougo/dpp-vim@~4.1.0/types";
import { mergeFtplugins } from "jsr:@shougo/dpp-vim@~4.1.0/utils";

import { expandGlob } from "jsr:@std/fs@~1.0.0/expand-glob";

import type { Denops } from "jsr:@denops/std@~7.4.0";

export class Config extends BaseConfig {
  override async config(args: {
    denops: Denops;
    contextBuilder: ContextBuilder;
    basePath: string;
  }): Promise<ConfigReturn> {
    args.contextBuilder.setGlobal({
      protocols: ["git"],
      extParams: {},
    });

    const recordPlugins: Record<string, Plugin> = {};
    const ftplugins: Record<string, string> = {};
    const hooksFiles: string[] = [];
    let multipleHooks: MultipleHook[] = [];

    const [context, options] = await args.contextBuilder.get(args.denops);
    const protocols = (await args.denops.dispatcher.getProtocols()) as Record<
      string,
      Protocol
    >;
    const [tomlExt, tomlOptions, tomlParams]: [
      TomlExt | undefined,
      ExtOptions,
      TomlParams,
    ] = (await args.denops.dispatcher.getExt("toml")) as [
      TomlExt | undefined,
      ExtOptions,
      TomlParams,
    ];
    if (tomlExt) {
      const action = tomlExt.actions.load;

      const tomlPromises = [
        { name: "colortheme.toml", lazy: true },
        { name: "bypass.toml", lazy: true },
        { name: "dpp.toml", lazy: true },
        { name: "depends.toml", lazy: true },
        { name: "ddc.toml", lazy: true },
        // { name: "ddt.toml", lazy: true },
        { name: "ddu.toml", lazy: false },
        { name: "editing.toml", lazy: true },
        { name: "external.toml", lazy: true },
        { name: "git.toml", lazy: true },
        { name: "lang.toml", lazy: true },
        { name: "lsp.toml", lazy: true },
        { name: "motion.toml", lazy: true },
        { name: "snippet.toml", lazy: true },
        { name: "statusline.toml", lazy: true },
        { name: "skk.toml", lazy: true },
        { name: "terminal.toml", lazy: true },
        { name: "ui.toml", lazy: true },
        { name: "visibility.toml", lazy: true },
      ].map((tomlFile) =>
        action.callback({
          denops: args.denops,
          context,
          options,
          protocols,
          extOptions: tomlOptions,
          extParams: tomlParams,
          actionParams: {
            path: Deno.env.get("PLUGIN_DIR") + "/" + tomlFile.name,
            options: {
              lazy: tomlFile.lazy,
            },
          },
        }),
      );
      const tomls = await Promise.all(tomlPromises);
      for (const toml of tomls) {
        for (const plugin of toml.plugins ?? []) {
          recordPlugins[plugin.name] = plugin;
        }
        if (toml.ftplugins) {
          mergeFtplugins(ftplugins, toml.ftplugins);
        }

        if (toml.multiple_hooks) {
          multipleHooks = multipleHooks.concat(toml.multiple_hooks);
        }

        if (toml.hooks_file) {
          hooksFiles.push(toml.hooks_file);
        }
      }
    }

    const [lazyExt, lazyOptions, lazyParams]: [
      LazyExt | undefined,
      ExtOptions,
      LazyParams,
    ] = (await args.denops.dispatcher.getExt("lazy")) as [
      LazyExt | undefined,
      ExtOptions,
      LazyParams,
    ];
    let lazyResult: LazyMakeStateResult | undefined = undefined;
    if (lazyExt) {
      const action = lazyExt.actions.makeState;
      lazyResult = await action.callback({
        denops: args.denops,
        context,
        options,
        protocols,
        extOptions: lazyOptions,
        extParams: lazyParams,
        actionParams: { plugins: Object.values(recordPlugins) },
      });
    }

    const checkFiles = [];
    for await (const file of expandGlob(`${Deno.env.get("PLUGIN_DIR")}/*`)) {
      checkFiles.push(file.path);
    }

    return {
      checkFiles,
      ftplugins,
      hooksFiles,
      multipleHooks,
      plugins: lazyResult?.plugins ?? [],
      stateLines: lazyResult?.stateLines ?? [],
    };
  }
}
