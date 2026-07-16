import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function saveAgentArtifact(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "save_agent_artifact",
        label: "Save agent artifact",
        description: "Save a generated specification or implementation plan.",
        parameters: Type.Object({
            kind: Type.Union([
                Type.Literal("spec"),
                Type.Literal("plan"),
            ]),
            slug: Type.String(),
            content: Type.String(),
        }),
        async execute(_toolCallId, params) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Received ${params.kind}: ${params.slug}`,
                    },
                ],
                details: {},
            };
        },
    })
}

