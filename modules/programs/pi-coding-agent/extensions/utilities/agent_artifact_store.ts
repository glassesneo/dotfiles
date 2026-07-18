import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Type } from "typebox";

export const artifactKinds = ["spec", "plan"] as const;

export type ArtifactKind = (typeof artifactKinds)[number];
export type ArtifactState = "pending" | "approved" | "revision_requested" | "rejected";

const kindToDirectory: Record<ArtifactKind, string> = {
    spec: "specs",
    plan: "plans",
};

const slugPattern = "^[a-z0-9]+(-[a-z0-9]+)*$";
const slugRegex = new RegExp(slugPattern);

export const approvalRequiredKinds = new Set<ArtifactKind>(["spec", "plan"]);

export const artifactParameters = Type.Object({
    kind: Type.Union(artifactKinds.map(kind => Type.Literal(kind))),
    slug: Type.String({
        minLength: 1,
        pattern: slugPattern,
        description: "Non-empty lowercase kebab-case artifact slug",
    }),
    content: Type.String(),
    pendingId: Type.Optional(Type.String({
        minLength: 1,
        pattern: slugPattern,
        description: "Existing pending artifact id to update after a revision request",
    })),
});

export interface PendingArtifactMetadata {
    id: string;
    kind: ArtifactKind;
    slug: string;
    title: string;
    summary: string;
    state: ArtifactState;
    createdAt: string;
    updatedAt: string;
    timestamp: string;
    contentPath: string;
    metadataPath: string;
    pendingPath: string;
    plannedFinalPath: string;
    finalPath?: string;
    lineCount: number;
    fileSize: number;
    revisionInstructions?: string;
}

export interface ArtifactSummary {
    id: string;
    kind: ArtifactKind;
    slug: string;
    title: string;
    summary: string;
    state: ArtifactState;
    pendingPath: string;
    plannedFinalPath: string;
    finalPath?: string;
    lineCount: number;
    fileSize: number;
}

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
    return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isCrossDeviceError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "EXDEV";
}

function assertSlug(slug: string, label = "Artifact slug"): void {
    if (!slugRegex.test(slug)) throw new Error(`${label} must be non-empty lowercase kebab-case`);
}

function directoryForKind(kind: ArtifactKind): string {
    const directory = kindToDirectory[kind];
    if (directory === undefined) throw new Error(`Unsupported artifact kind: ${String(kind)}`);
    return directory;
}

function countLines(content: string): number {
    if (content.length === 0) return 0;
    return content.split(/\r\n|\r|\n/).length;
}

function firstMarkdownHeading(content: string): string | undefined {
    for (const line of content.split(/\r?\n/)) {
        const match = /^#\s+(.+?)\s*$/.exec(line);
        if (match) return match[1];
    }
    return undefined;
}

function normalizeParagraph(lines: string[]): string | undefined {
    const paragraph = lines.map(line => line.trim()).filter(line => line !== "").join(" ");
    if (paragraph === "") return undefined;
    return paragraph.length > 180 ? `${paragraph.slice(0, 177)}...` : paragraph;
}

function atxHeadingLevel(line: string): number | undefined {
    const match = /^(#{1,6})\s+.+?\s*#*\s*$/.exec(line.trim());
    return match?.[1].length;
}

function isMetadataLine(line: string): boolean {
    return /^[A-Za-z][A-Za-z0-9_-]*:\s*.+$/.test(line.trim());
}

function isSkippableParagraphLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed === ""
        || trimmed.startsWith("#")
        || trimmed.startsWith("```")
        || /^-{3,}\s*$/.test(trimmed)
        || isMetadataLine(trimmed);
}

function firstParagraphFromLines(lines: string[], options: { skipMetadata: boolean }): string | undefined {
    let paragraph: string[] = [];
    for (const raw of lines) {
        const line = raw.trim();
        const skippable = options.skipMetadata ? isSkippableParagraphLine(line) : line === "" || line.startsWith("#") || line.startsWith("```") || /^-{3,}\s*$/.test(line);
        if (skippable) {
            const normalized = normalizeParagraph(paragraph);
            if (normalized !== undefined) return normalized;
            paragraph = [];
            continue;
        }
        paragraph.push(line);
    }
    return normalizeParagraph(paragraph);
}

function summarySectionLines(content: string): string[] | undefined {
    const lines = content.split(/\r?\n/);
    const start = lines.findIndex(line => /^##\s+Summary\s*#*\s*$/i.test(line.trim()));
    if (start === -1) return undefined;

    const section: string[] = [];
    for (const line of lines.slice(start + 1)) {
        const level = atxHeadingLevel(line);
        if (level !== undefined && level <= 2) break;
        section.push(line);
    }
    return section;
}

function firstParagraph(content: string): string | undefined {
    const explicitSummary = summarySectionLines(content);
    if (explicitSummary !== undefined) {
        const paragraph = firstParagraphFromLines(explicitSummary, { skipMetadata: false });
        if (paragraph !== undefined) return paragraph;
    }
    return firstParagraphFromLines(content.split(/\r?\n/), { skipMetadata: true });
}

function summarizeContent(content: string, slug: string): Pick<ArtifactSummary, "title" | "summary" | "lineCount" | "fileSize"> {
    return {
        title: firstMarkdownHeading(content) ?? slug,
        summary: firstParagraph(content) ?? "No summary available.",
        lineCount: countLines(content),
        fileSize: Buffer.byteLength(content, "utf8"),
    };
}

async function writeArtifact(directory: string, timestamp: string, slug: string, content: string): Promise<string> {
    await mkdir(directory, { recursive: true });
    for (let version = 1; version <= 99; version += 1) {
        const suffix = version === 1 ? "" : `-v${version}`;
        const artifactPath = join(directory, `${timestamp}-${slug}${suffix}.md`);
        try {
            await writeFile(artifactPath, content, { flag: "wx" });
            return artifactPath;
        } catch (error) {
            if (!isAlreadyExistsError(error)) throw error;
        }
    }
    throw new Error(`Could not save artifact after trying the base filename and suffixes through -v99 in ${directory}`);
}

async function nextArtifactPath(directory: string, timestamp: string, slug: string): Promise<string> {
    await mkdir(directory, { recursive: true });
    for (let version = 1; version <= 99; version += 1) {
        const suffix = version === 1 ? "" : `-v${version}`;
        const artifactPath = join(directory, `${timestamp}-${slug}${suffix}.md`);
        try {
            await writeFile(artifactPath, "", { flag: "wx" });
            await unlink(artifactPath);
            return artifactPath;
        } catch (error) {
            if (!isAlreadyExistsError(error)) throw error;
        }
    }
    throw new Error(`Could not reserve artifact path in ${directory}`);
}

function projectPendingDirectory(cwd: string): string {
    return join(cwd, ".agents", "pending-artifacts");
}

function pendingPaths(cwd: string, id: string): { contentPath: string; metadataPath: string } {
    assertSlug(id, "Pending artifact id");
    const directory = projectPendingDirectory(cwd);
    return { contentPath: join(directory, `${id}.md`), metadataPath: join(directory, `${id}.json`) };
}

async function writeMetadata(metadata: PendingArtifactMetadata): Promise<void> {
    await writeFile(metadata.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

async function buildMetadata(cwd: string, base: Omit<PendingArtifactMetadata, "title" | "summary" | "lineCount" | "fileSize">, content: string): Promise<PendingArtifactMetadata> {
    const file = await stat(base.contentPath);
    return { ...base, ...summarizeContent(content, base.slug), fileSize: file.size };
}

function toSummary(metadata: PendingArtifactMetadata): ArtifactSummary {
    const { id, kind, slug, title, summary, state, pendingPath, plannedFinalPath, finalPath, lineCount, fileSize } = metadata;
    return { id, kind, slug, title, summary, state, pendingPath, plannedFinalPath, finalPath, lineCount, fileSize };
}

async function nextPendingId(cwd: string, timestamp: string, slug: string): Promise<string> {
    await mkdir(projectPendingDirectory(cwd), { recursive: true });
    for (let version = 1; version <= 99; version += 1) {
        const suffix = version === 1 ? "" : `-v${version}`;
        const id = `${timestamp}-${slug}${suffix}`;
        const { contentPath } = pendingPaths(cwd, id);
        try {
            await writeFile(contentPath, "", { flag: "wx" });
            await unlink(contentPath);
            return id;
        } catch (error) {
            if (!isAlreadyExistsError(error)) throw error;
        }
    }
    throw new Error("Could not allocate pending artifact id");
}

export interface SaveAgentArtifactOptions { cwd: string; kind: ArtifactKind; slug: string; content: string; now?: Date; }
export interface SavedAgentArtifact { projectPath: string; timestamp: string; }

export async function saveAgentArtifact({ cwd, kind, slug, content, now = new Date() }: SaveAgentArtifactOptions): Promise<SavedAgentArtifact> {
    assertSlug(slug);
    const timestamp = getJstTimestamp(now);
    const projectPath = await writeArtifact(join(cwd, ".agents", directoryForKind(kind)), timestamp, slug, content);
    return { projectPath, timestamp };
}

export interface CreateOrUpdatePendingOptions { cwd: string; kind: ArtifactKind; slug: string; content: string; pendingId?: string; now?: Date; }

export async function createOrUpdatePendingArtifact({ cwd, kind, slug, content, pendingId, now = new Date() }: CreateOrUpdatePendingOptions): Promise<PendingArtifactMetadata> {
    assertSlug(slug);
    const timestamp = pendingId === undefined ? getJstTimestamp(now) : undefined;
    const id = pendingId ?? await nextPendingId(cwd, timestamp!, slug);
    const { contentPath, metadataPath } = pendingPaths(cwd, id);
    const updatedAt = now.toISOString();
    await mkdir(projectPendingDirectory(cwd), { recursive: true });

    let createdAt = updatedAt;
    let artifactTimestamp = timestamp ?? getJstTimestamp(now);
    let plannedFinalPath = join(cwd, ".agents", directoryForKind(kind), `${artifactTimestamp}-${slug}.md`);
    if (pendingId !== undefined) {
        const existing = await readPendingArtifact(cwd, pendingId);
        if (existing.kind !== kind) throw new Error(`Pending artifact kind mismatch: expected ${existing.kind}`);
        if (existing.slug !== slug) throw new Error(`Pending artifact slug mismatch: expected ${existing.slug}`);
        createdAt = existing.createdAt;
        artifactTimestamp = existing.timestamp;
        plannedFinalPath = existing.plannedFinalPath;
    }

    await writeFile(contentPath, content);
    const base = {
        id,
        kind,
        slug,
        state: "pending" as const,
        createdAt,
        updatedAt,
        timestamp: artifactTimestamp,
        contentPath,
        metadataPath,
        pendingPath: contentPath,
        plannedFinalPath,
    };
    const metadata = await buildMetadata(cwd, base, content);
    await writeMetadata(metadata);
    return metadata;
}

export async function readPendingArtifact(cwd: string, pendingId: string): Promise<PendingArtifactMetadata> {
    const { metadataPath } = pendingPaths(cwd, pendingId);
    return JSON.parse(await readFile(metadataPath, "utf8")) as PendingArtifactMetadata;
}

export async function readPendingArtifactContent(cwd: string, pendingId: string): Promise<string> {
    const { contentPath } = pendingPaths(cwd, pendingId);
    return readFile(contentPath, "utf8");
}

async function moveFile(source: string, destination: string): Promise<void> {
    try {
        await rename(source, destination);
    } catch (error) {
        if (!isCrossDeviceError(error)) throw error;
        await copyFile(source, destination);
        await unlink(source);
    }
}

export async function approvePendingArtifact(cwd: string, pendingId: string, now = new Date()): Promise<PendingArtifactMetadata> {
    const metadata = await readPendingArtifact(cwd, pendingId);
    const directory = join(cwd, ".agents", directoryForKind(metadata.kind));
    const finalPath = await nextArtifactPath(directory, metadata.timestamp, metadata.slug);
    await moveFile(metadata.contentPath, finalPath);
    const approved: PendingArtifactMetadata = {
        ...metadata,
        state: "approved",
        updatedAt: now.toISOString(),
        finalPath,
        plannedFinalPath: finalPath,
        contentPath: finalPath,
        pendingPath: metadata.pendingPath,
    };
    await writeMetadata(approved);
    return approved;
}

export async function requestPendingArtifactRevision(cwd: string, pendingId: string, instructions: string, now = new Date()): Promise<PendingArtifactMetadata> {
    const metadata = await readPendingArtifact(cwd, pendingId);
    const next = { ...metadata, state: "revision_requested" as const, revisionInstructions: instructions, updatedAt: now.toISOString() };
    await writeMetadata(next);
    return next;
}

export async function rejectPendingArtifact(cwd: string, pendingId: string, now = new Date()): Promise<PendingArtifactMetadata> {
    const metadata = await readPendingArtifact(cwd, pendingId);
    const next = { ...metadata, state: "rejected" as const, updatedAt: now.toISOString() };
    await writeMetadata(next);
    return next;
}

export function artifactSummary(metadata: PendingArtifactMetadata): ArtifactSummary {
    return toSummary(metadata);
}

export function artifactFilename(path: string): string {
    return basename(path);
}
