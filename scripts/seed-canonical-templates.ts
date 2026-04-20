/**
 * Load CANONICAL contract templates from `templates/<JURISDICTION>/<TYPE>/<lang>.json`
 * into the ContractTemplate table.
 *
 * Each JSON file describes a single canonical template:
 *   {
 *     title, source, kind, jurisdiction, type, language, priority?, notes?,
 *     sections: [ { id, title?, content } ]
 *   }
 *
 * `source` is the unique key — re-running the script upserts in place.
 *
 * Usage:  npm run seed:templates
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import type { ContractType, Language } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "templates");

const FileSchema = z.object({
  title: z.string().min(1),
  source: z.string().min(1),
  kind: z.literal("CANONICAL"),
  jurisdiction: z.string().min(2),
  type: z.enum(["ANNUAL", "SUBLET", "MANAGEMENT"]),
  language: z.enum(["HE", "EN", "RU", "AR"]),
  priority: z.number().int().optional(),
  notes: z.string().optional(),
  sections: z
    .array(
      z.object({
        id: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
        title: z.string().min(1).optional(),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

interface FoundFile {
  abs: string;
  rel: string;
}

async function walk(): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  let exists = true;
  try {
    await fs.stat(ROOT);
  } catch {
    exists = false;
  }
  if (!exists) {
    console.error(`Folder not found: ${ROOT}`);
    return out;
  }

  const stack: string[] = [ROOT];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
      } else if (e.isFile() && e.name.endsWith(".json")) {
        out.push({ abs, rel: path.relative(ROOT, abs).replace(/\\/g, "/") });
      }
    }
  }
  return out;
}

async function main() {
  const files = await walk();
  if (files.length === 0) {
    console.log("No canonical template JSON files found under templates/.");
    process.exit(0);
  }
  console.log(`Found ${files.length} file(s):\n${files.map((f) => "  " + f.rel).join("\n")}\n`);

  let upserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const text = await fs.readFile(file.abs, "utf8");
      const json = JSON.parse(text);
      const parsed = FileSchema.safeParse(json);
      if (!parsed.success) {
        console.error(`✖ ${file.rel}: ${parsed.error.message}`);
        failed++;
        continue;
      }
      const t = parsed.data;
      // Strip `title` from sections we store — runtime only needs id+content.
      const sectionsForDb = t.sections.map((s) => ({ id: s.id, content: s.content, title: s.title ?? s.id }));

      await prisma.contractTemplate.upsert({
        where: { source: t.source },
        create: {
          jurisdiction: t.jurisdiction,
          language: t.language as Language,
          type: t.type as ContractType,
          kind: "CANONICAL",
          title: t.title,
          source: t.source,
          rawText: t.notes ?? "",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sections: sectionsForDb as any,
          priority: t.priority ?? 100,
          isActive: true,
        },
        update: {
          jurisdiction: t.jurisdiction,
          language: t.language as Language,
          type: t.type as ContractType,
          kind: "CANONICAL",
          title: t.title,
          rawText: t.notes ?? "",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sections: sectionsForDb as any,
          priority: t.priority ?? 100,
          isActive: true,
        },
      });

      console.log(`✔ upserted: ${file.rel}  (${t.jurisdiction}/${t.type}/${t.language}, ${t.sections.length} sections)`);
      upserted++;
    } catch (e) {
      console.error(`✖ ${file.rel}: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone. upserted=${upserted} skipped=${skipped} failed=${failed}`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
