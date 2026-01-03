import type { Plugin } from "@opencode-ai/plugin"

type Status = "active" | "inactive"

interface SessionStatusEvent {
  type: "session.status"
  properties: {
    sessionID: string
    status: {
      type: "busy" | "idle" | "retry"
    }
  }
}

/**
 * SketchyBar integration plugin for OpenCode
 * Sends status updates to SketchyBar to show AI agent activity in the menu bar.
 *
 * Events:
 * - session.status: Fired when session status changes
 *   - properties.status.type: "busy" | "idle" | "retry"
 */
export const SketchyBarPlugin: Plugin = async ({ $, directory }) => {
  // Track current status to avoid duplicate updates
  let currentStatus: Status = "inactive"

  const triggerSketchybar = async (status: Status): Promise<void> => {
    // Avoid duplicate updates
    if (status === currentStatus) {
      return
    }
    currentStatus = status

    try {
      if (directory) {
        await $`sketchybar --trigger opencode_status STATUS=${status} PROJECT_DIR=${directory}`.quiet()
      } else {
        await $`sketchybar --trigger opencode_status STATUS=${status}`.quiet()
      }
    } catch {
      // Silently ignore if sketchybar is not running
    }
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.status") {
        const sessionEvent = event as SessionStatusEvent
        const statusType = sessionEvent.properties?.status?.type
        if (statusType === "busy" || statusType === "retry") {
          await triggerSketchybar("active")
        } else if (statusType === "idle") {
          await triggerSketchybar("inactive")
        }
      }
    },
  }
}
