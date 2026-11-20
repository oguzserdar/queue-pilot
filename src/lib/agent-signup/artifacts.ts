/**
 * What an agent saves before anyone claims it: material (notes, links, transcripts, sources it found) and private
 * drafts. This is the whole of an unclaimed agent's useful work, so it is bounded and private:
 *
 * - Every read and write is filtered by the registration id that came from the verified access token. There is no
 *   parameter that names another registration, so one agent cannot read another's work.
 * - Material is checked by the same rules as a person's own material (material-store.ts materialInput), so when a
 *   person claims the agent, it can be copied into their material as it is.
 * - Drafts are capped like posts are in practice (a few thousand characters) and never go anywhere: no Buffer, no
 *   network, no review link. They are text in a row.
 * - Each registration holds at most MAX_PER_KIND of each kind, so an unclaimed account cannot be used as free storage.
 *   A full store refuses the save with invalid_request; there is no remove call yet.
 */
import { createHash } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "../../db";
import { agentArtifact } from "../../db/schema";
import { materialInput } from "../material-store";
import { visibleText } from "../voice-store";
import { newId } from "./registrations";

export const MAX_PER_KIND = 200;
export const LIST_LIMIT = 50;

export const draftInput = z.object({
  title: z.string().max(200).transform((s) => visibleText(s).trim()).pipe(z.string().min(1)),
  text: z.string().max(5_000).transform((s) => visibleText(s).trim()).pipe(z.string().min(1)),
}).strict();

export const agentMaterialInput = materialInput.strict();

export type ArtifactKind = "material" | "draft";
export type Artifact = { id: string; kind: ArtifactKind; title: string; text: string; link: string | null; created_at: string };

const contentKey = (parts: (string | null)[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/** Saves one item. The same content saved twice keeps one row and returns it. Returns "full" at the cap. */
export async function saveArtifact(
  registrationId: string,
  kind: ArtifactKind,
  item: { title: string; text: string; link?: string },
): Promise<Artifact | "full"> {
  const key = contentKey([item.title, item.text, item.link ?? null]);
  return db().transaction(async (tx) => {
    const [existing] = await tx.select().from(agentArtifact)
      .where(and(eq(agentArtifact.registrationId, registrationId), eq(agentArtifact.kind, kind), eq(agentArtifact.contentKey, key))).limit(1);
    if (existing) return shown(existing);
    const [{ n }] = await tx.select({ n: count() }).from(agentArtifact).where(and(eq(agentArtifact.registrationId, registrationId), eq(agentArtifact.kind, kind)));
    if (n >= MAX_PER_KIND) return "full" as const;
    const [row] = await tx.insert(agentArtifact)
      .values({ id: newId("art"), registrationId, kind, title: item.title, text: item.text, link: item.link ?? null, contentKey: key })
      .onConflictDoNothing()
      .returning();
    // Two identical saves at once: the loser reads the winner's row.
    if (!row) {
      const [winner] = await tx.select().from(agentArtifact)
        .where(and(eq(agentArtifact.registrationId, registrationId), eq(agentArtifact.kind, kind), eq(agentArtifact.contentKey, key))).limit(1);
      return shown(winner);
    }
    return shown(row);
  });
}

/** This registration's items of one kind, newest first. */
export async function listArtifacts(registrationId: string, kind: ArtifactKind, limit = LIST_LIMIT): Promise<Artifact[]> {
  const rows = await db().select().from(agentArtifact)
    .where(and(eq(agentArtifact.registrationId, registrationId), eq(agentArtifact.kind, kind)))
    .orderBy(desc(agentArtifact.createdAt), desc(agentArtifact.id)).limit(limit);
  return rows.map(shown);
}

/** How many items of one kind this registration holds; the lists above stop at LIST_LIMIT. */
export async function countArtifacts(registrationId: string, kind: ArtifactKind): Promise<number> {
  const [{ n }] = await db().select({ n: count() }).from(agentArtifact).where(and(eq(agentArtifact.registrationId, registrationId), eq(agentArtifact.kind, kind)));
  return n;
}

function shown(row: typeof agentArtifact.$inferSelect): Artifact {
  return { id: row.id, kind: row.kind, title: row.title, text: row.text, link: row.link, created_at: row.createdAt.toISOString() };
}
