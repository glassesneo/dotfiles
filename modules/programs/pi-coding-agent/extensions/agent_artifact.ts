import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    artifactParameters,
    saveAgentArtifact,
} from "./agent_artifact_store.ts";

export default function registerAgentArtifact(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "save_agent_artifact",
        label: "Save agent artifact",
        description:
            "Save an approved specification or implementation plan as a project-local Markdown artifact.",
        promptSnippet:
            "Persist an approved specification or implementation plan",
        promptGuidelines: [
            "Use save_agent_artifact only after the user approves a specification or implementation plan candidate.",
            "Use kind=spec for specifications and kind=plan for implementation plans.",
            "Provide a non-empty lowercase kebab-case slug that describes the artifact.",
        ],
        parameters: artifactParameters,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const { projectPath, timestamp } = await saveAgentArtifact({
                cwd: ctx.cwd,
                kind: params.kind,
                slug: params.slug,
                content: params.content,
            });

            return {
                content: [
                    {
                        type: "text",
                        text: `Saved ${params.kind} to ${projectPath}`,
                    },
                ],
                details: {
                    projectPath,
                    kind: params.kind,
                    slug: params.slug,
                    timestamp,
                },
            };
        },
    });
}
