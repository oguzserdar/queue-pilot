import { createHash } from "node:crypto"
import { and, desc, eq, notExists } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db"
import { material, sourceUsed } from "../db/schema"
import { visibleText } from "./voice-store"

/** Limits for research text handed over by the user's AI. */
export const materialInput = z.object({
  title: z.string().max(200).transform((s) => visibleText(s).trim()).pipe(z.string().min(1)),
  text: z.string().max(12_000).transform((s) => visibleText(s).trim()).pipe(z.string().min(1)),
  link: z.string().url().max(2000).refine((s) => ["https:", "http:"].includes(new URL(s).protocol)).optional(),
})

/** One private research item, with a stable key for retrying and marking it used. */
export type Material = z.infer<typeof materialInput> & { key: string }

/** Saves and reads research for the authenticated person. */
export type MaterialStore = {
  add(userId: string, input: z.infer<typeof materialInput>): Promise<Material>
  list(userId: string): Promise<Material[]>
  get(userId: string, key: string): Promise<Material | null>
  remove(userId: string, key: string): Promise<void>
}

function itemFor(input: z.infer<typeof materialInput>): Material {
  const clean = materialInput.parse(input)
  const key = `material:${createHash("sha256").update(JSON.stringify([clean.title, clean.text, clean.link ?? null])).digest("hex")}`
  return { ...clean, key }
}

/** Private research stored with the person's account. Repeated submissions keep one item. */
export function postgresMaterialStore(): MaterialStore {
  const fromRow = (row: typeof material.$inferSelect): Material => ({ key: row.key, title: row.title, text: row.text, ...(row.link ? { link: row.link } : {}) })
  return {
    async add(userId, input) {
      const item = itemFor(input)
      await db().insert(material).values({ userId, ...item }).onConflictDoNothing()
      return item
    },
    async list(userId) {
      const used = db().select({ key: sourceUsed.itemKey }).from(sourceUsed).where(and(eq(sourceUsed.userId, userId), eq(sourceUsed.itemKey, material.key)))
      const rows = await db().select().from(material).where(and(eq(material.userId, userId), notExists(used))).orderBy(desc(material.addedAt)).limit(20)
      return rows.map(fromRow)
    },
    async remove(userId, key) {
      await db().delete(material).where(and(eq(material.userId, userId), eq(material.key, key)))
    },
    async get(userId, key) {
      const [row] = await db().select().from(material).where(and(eq(material.userId, userId), eq(material.key, key)))
      return row ? fromRow(row) : null
    },
  }
}

/** The same private item keys without a database, for connector tests. */
export function memoryMaterialStore(): MaterialStore {
  const rows = new Map<string, Map<string, Material>>()
  return {
    async add(userId, input) {
      const item = itemFor(input)
      const mine = rows.get(userId) ?? new Map<string, Material>()
      mine.set(item.key, item)
      rows.set(userId, mine)
      return { ...item }
    },
    async list(userId) { return [...(rows.get(userId)?.values() ?? [])].reverse().map((item) => ({ ...item })) },
    async remove(userId, key) { rows.get(userId)?.delete(key) },
    async get(userId, key) { return structuredClone(rows.get(userId)?.get(key) ?? null) },
  }
}
