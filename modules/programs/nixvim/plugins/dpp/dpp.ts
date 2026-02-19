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
} from "jsr:@shougo/dpp-vim@~4.7.0/config";
import type { Protocol } from "jsr:@shougo/dpp-vim@~4.7.0/protocol";
import type {
  ContextBuilder,
  ExtOptions,
  Plugin,
} from "jsr:@shougo/dpp-vim@~4.7.0/types";
import { mergeFtplugins } from "jsr:@shougo/dpp-vim@~4.7.0/utils";

import { expandGlob } from "jsr:@std/fs@~1.0.19/expand-glob";

import type { Denops } from "jsr:@denops/std@~7.6.0";

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

      // Auto-discovery convention:
      // - Include only generated plugin TOMLs named `^[a-z0-9-]+\.toml$`.
      // - Exclude non-plugin files explicitly (fixtures/scratch can be added here).
      // - WARNING: Any scratch `.toml` matching the pattern is auto-loaded.
      // Exclude ddc.toml as it references Vim-only hooks.
      const excludedTomlFiles = new Set<string>(["ddc.toml"]);
      const discoveredTomlFiles: string[] = [];
      for await (const file of expandGlob(`@plugin-dir-path@/*.toml`)) {
        const fileName = file.name;
        if (!file.isFile) {
          continue;
        }
        if (!/^[a-z0-9-]+\.toml$/.test(fileName)) {
          continue;
        }
        if (excludedTomlFiles.has(fileName)) {
          continue;
        }
        discoveredTomlFiles.push(fileName);
      }
      discoveredTomlFiles.sort((a, b) => a.localeCompare(b));

      const tomlPromises = discoveredTomlFiles.map((tomlFile) =>
        action.callback({
          denops: args.denops,
          context,
          options,
          protocols,
          extOptions: tomlOptions,
          extParams: tomlParams,
          actionParams: {
            path: "@plugin-dir-path@" + "/" + tomlFile,
            options: { lazy: true },
          },
        })
      );
      const tomls = await Promise.all(tomlPromises);
      // const tomls: Toml[] = [];
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
    for await (const file of expandGlob(`@plugin-dir-path@/*`)) {
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
