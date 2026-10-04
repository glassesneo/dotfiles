import {
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type ExtensionError,
  type ExtensionUIContext,
  SessionManager,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface SessionHost {
  readonly runtime: AgentSessionRuntime;
  /**
   * Bind the UI to the active session, and again to every session that
   * replaces it, since subscriptions and extension bindings belong to one
   * AgentSession.
   */
  bind(options: SessionBindings): Promise<void>;
  dispose(): Promise<void>;
}

export interface SessionBindings {
  uiContext: ExtensionUIContext;
  onEvent: (event: AgentSessionEvent) => void;
  onExtensionError: (error: ExtensionError) => void;
  onShutdownRequest: () => void;
  /** Called after another session or branch replaces the bound history. */
  onHistoryReplaced: (session: AgentSession) => void;
}

export async function createSessionHost(options: {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
}): Promise<SessionHost> {
  const { cwd, agentDir, settingsManager } = options;

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({ cwd, agentDir, settingsManager });
    return {
      ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: SessionManager.create(cwd),
  });

  let unsubscribe: (() => void) | undefined;

  return {
    runtime,
    async bind(bindings) {
      const rebind = async (session: AgentSession) => {
        unsubscribe?.();
        await session.bindExtensions({
          uiContext: bindings.uiContext,
          // Extensions guard pi-tui features with `mode === "tui"`; the harness
          // implements only the terminal-independent UI, as pi's RPC mode does.
          mode: "rpc",
          commandContextActions: {
            waitForIdle: () => session.waitForIdle(),
            newSession: (options) => runtime.newSession(options),
            fork: async (entryId, forkOptions) => ({
              cancelled: (await runtime.fork(entryId, forkOptions)).cancelled,
            }),
            navigateTree: async (targetId, options) => {
              const { cancelled } = await session.navigateTree(targetId, options);
              if (!cancelled) {
                bindings.onHistoryReplaced(session);
              }
              return { cancelled };
            },
            switchSession: (sessionPath, options) => runtime.switchSession(sessionPath, options),
            reload: () => session.reload(),
          },
          shutdownHandler: bindings.onShutdownRequest,
          onError: bindings.onExtensionError,
        });
        unsubscribe = session.subscribe(bindings.onEvent);
      };
      runtime.setRebindSession(async (session) => {
        await rebind(session);
        bindings.onHistoryReplaced(session);
      });
      await rebind(runtime.session);
    },
    async dispose() {
      unsubscribe?.();
      await runtime.dispose();
    },
  };
}
