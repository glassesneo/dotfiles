import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Type } from "typebox";

const artifactKinds = [
    "spec",
    "plan",
    "research",
    "implementation-report",
    "review-report",
    "bug-report",
    "failure-report",
] as const;

type ArtifactKind = (typeof artifactKinds)[number];

const kindToDir: Record<ArtifactKind, string> = {
    spec: "specs",
    plan: "plans",
    research: "research",
    "implementation-report": "implementation-reports",
    "review-report": "review-reports",
    "bug-report": "bug-reports",
    "failure-report": "failure-reports",
};

const crossProjectKinds = new Set<ArtifactKind>(["research", "bug-report"]);
const slugPattern = "^[a-z0-9]+(-[a-z0-9]+)*$";

function getJstTimestamp() {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    });

    const parts = Object.fromEntries(
        formatter
            .formatToParts(new Date())
            .map(({ type, value }) => [type, value]),
    );

    return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function isAlreadyExistsError(error: unknown): boolean {
    return (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
    );
}

async function writeArtifact(
    directory: string,
    timestamp: string,
    slug: string,
    content: string,
): Promise<string> {
    await mkdir(directory, { recursive: true });

    for (let version = 1; version <= 99; version += 1) {
        const suffix = version === 1 ? "" : `-v${version}`;
        const artifactPath = join(directory, `${timestamp}-${slug}${suffix}.md`);

        try {
            await writeFile(artifactPath, content, { flag: "wx" });
            return artifactPath;
        } catch (error) {
            if (!isAlreadyExistsError(error)) {
                throw error;
            }
        }
    }

    throw new Error(
        `Could not save artifact after trying the base filename and suffixes through -v99 in ${directory}`,
    );
}

export default function saveAgentArtifact(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "save_agent_artifact",
        label: "Save agent artifact",
        description:
            "Save a durable agent artifact with a collision-safe JST filename.",
        promptSnippet:
            "Save specs, plans, research, implementation/review/bug/failure reports as durable Markdown artifacts",
        promptGuidelines: [
            "Use save_agent_artifact for durable agent artifacts instead of writing their files directly.",
            "Use kind=spec for decision-ready specifications and kind=plan for implementation-ready plans.",
            "Use kind=research for reusable investigation findings.",
            "Use kind=implementation-report after source or configuration changes and kind=review-report for read-only review outcomes.",
            "Use kind=bug-report for defect investigation handoffs and kind=failure-report for non-trivial validation failures.",
            "Provide a non-empty lowercase kebab-case slug that describes the artifact.",
        ],
        parameters: Type.Object({
            kind: Type.Union(artifactKinds.map(kind => Type.Literal(kind))),
            slug: Type.String({
                minLength: 1,
                pattern: slugPattern,
                description: "Non-empty lowercase kebab-case artifact slug",
            }),
            content: Type.String(),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const timestamp = getJstTimestamp();
            const kind = params.kind as ArtifactKind;
            const projectName = basename(ctx.cwd);

            if (projectName === "" || projectName === "." || projectName === "..") {
                throw new Error(
                    `Cannot derive a safe project name from working directory: ${ctx.cwd}`,
                );
            }

            const directory = kindToDir[kind];
            const projectPath = await writeArtifact(
                join(ctx.cwd, ".agents", directory),
                timestamp,
                params.slug,
                params.content,
            );

            if (crossProjectKinds.has(kind)) {
                try {
                    await writeArtifact(
                        join(homedir(), ".agents", directory, projectName),
                        timestamp,
                        params.slug,
                        params.content,
                    );
                } catch {
                    throw new Error(
                        `Artifact was saved to ${projectPath}, but the artifact operation did not complete.`,
                    );
                }
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `Saved ${kind} to ${projectPath}`,
                    },
                ],
                details: {
                    projectPath,
                    kind,
                    slug: params.slug,
                    timestamp,
                },
            };
        },
    });
}
