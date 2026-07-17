import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";

export const artifactKinds = ["spec", "plan"] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

const kindToDirectory: Record<ArtifactKind, string> = {
    spec: "specs",
    plan: "plans",
};

const slugPattern = "^[a-z0-9]+(-[a-z0-9]+)*$";
const slugRegex = new RegExp(slugPattern);

export const artifactParameters = Type.Object({
    kind: Type.Union(artifactKinds.map(kind => Type.Literal(kind))),
    slug: Type.String({
        minLength: 1,
        pattern: slugPattern,
        description: "Non-empty lowercase kebab-case artifact slug",
    }),
    content: Type.String(),
});

export function getJstTimestamp(date = new Date()): string {
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
        formatter.formatToParts(date).map(({ type, value }) => [type, value]),
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

export interface SaveAgentArtifactOptions {
    cwd: string;
    kind: ArtifactKind;
    slug: string;
    content: string;
    now?: Date;
}

export interface SavedAgentArtifact {
    projectPath: string;
    timestamp: string;
}

export async function saveAgentArtifact({
    cwd,
    kind,
    slug,
    content,
    now = new Date(),
}: SaveAgentArtifactOptions): Promise<SavedAgentArtifact> {
    if (!slugRegex.test(slug)) {
        throw new Error("Artifact slug must be non-empty lowercase kebab-case");
    }

    const directory = kindToDirectory[kind];
    if (directory === undefined) {
        throw new Error(`Unsupported artifact kind: ${String(kind)}`);
    }

    const timestamp = getJstTimestamp(now);
    const projectPath = await writeArtifact(
        join(cwd, ".agents", directory),
        timestamp,
        slug,
        content,
    );

    return { projectPath, timestamp };
}
