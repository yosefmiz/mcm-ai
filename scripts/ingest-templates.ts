/**
 * Bulk-import reference contracts into ContractTemplate.
 *
 * Walks data/contracts/<JURISDICTION>/<TYPE>/<LANGUAGE>/*.{pdf,docx,txt,md},
 * extracts plain text, asks gemma4 to structure it into the standard
 * contract section schema, and saves to the DB.
 *
 * Re-runs are safe — `source` is unique, existing rows are skipped.
 *
 * Usage:  npm run ingest:templates
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

import { prisma } from "../lib/prisma.js";
import { extractTemplate } from "../lib/ai.js";
import type { ContractType, Language } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "data", "contracts");

const SUPPORTED_LANG = new Set<Language>(["HE", "EN", "RU", "AR"]);
const SUPPORTED_TYPE = new Set<ContractType>(["ANNUAL", "SUBLET", "MANAGEMENT"]);
const SUPPORTED_EXT = new Set([".pdf", ".docx", ".txt", ".md"]);

interface FoundFile {
  abs: string;
  rel: string;
  jurisdiction: string;
  type: ContractType;
  language: Language;
  ext: string;
}

async function walk(): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  let jurisdictions: string[];
  try {
    jurisdictions = (await fs.readdir(ROOT, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    console.error(`Folder not found: ${ROOT}`);
    return [];
  }

  for (const j of jurisdictions) {
    const jPath = path.join(ROOT, j);
    const types = (await fs.readdir(jPath, { withFileTypes: true }))
      .filter((d) => d.isDirectory());
    for (const tDir of types) {
      const t = tDir.name as ContractType;
      if (!SUPPORTED_TYPE.has(t)) {
        console.warn(`  ⚠ skip unknown type: ${j}/${t}`);
        continue;
      }
      const tPath = path.join(jPath, t);
      const langs = (await fs.readdir(tPath, { withFileTypes: true }))
        .filter((d) => d.isDirectory());
      for (const lDir of langs) {
        const l = lDir.name as Language;
        if (!SUPPORTED_LANG.has(l)) {
          console.warn(`  ⚠ skip unknown lang: ${j}/${t}/${l}`);
          continue;
        }
        const lPath = path.join(tPath, l);
        const files = (await fs.readdir(lPath, { withFileTypes: true }))
          .filter((d) => d.isFile());
        for (const f of files) {
          const ext = path.extname(f.name).toLowerCase();
          if (!SUPPORTED_EXT.has(ext)) continue;
          out.push({
            abs: path.join(lPath, f.name),
            rel: path.relative(ROOT, path.join(lPath, f.name)).replace(/\\/g, "/"),
            jurisdiction: j.replace(/-/g, ", "),
            type: t,
            language: l,
            ext,
          });
        }
      }
    }
  }
  return out;
}

async function extractText(file: FoundFile): Promise<string> {
  const buf = await fs.readFile(file.abs);
  switch (file.ext) {
    case ".pdf": {
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        const result = await parser.getText();
        if (result.text && result.text.trim().length > 0) return result.text;
        return result.pages?.map((p) => p.text).join("\n\n") ?? "";
      } finally {
        await parser.destroy();
      }
    }
    case ".docx": {
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value;
    }
    case ".txt":
    case ".md":
      return buf.toString("utf8");
    default:
      throw new Error(`unsupported ext ${file.ext}`);
  }
}

async function main() {
  const files = await walk();
  if (files.length === 0) {
    console.log("No contract files found under data/contracts/.");
    process.exit(0);
  }

  console.log(`Found ${files.length} file(s):\n${files.map((f) => "  " + f.rel).join("\n")}\n`);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const source = file.rel;
    const existing = await prisma.contractTemplate.findUnique({ where: { source } });
    if (existing) {
      console.log(`⏭  skip (already imported): ${source}`);
      skipped++;
      continue;
    }

    console.log(`⏳ ingest: ${source}`);
    try {
      const rawText = (await extractText(file)).trim();
      if (rawText.length < 200) {
        console.warn(`   ⚠ extracted text very short (${rawText.length} chars). Likely scanned PDF — needs OCR. Skipping.`);
        failed++;
        continue;
      }

      // Cap at ~30K chars (~8K Hebrew tokens), leaving room for the prompt
      // and the JSON output inside our 16K context window.
      const truncated = rawText.length > 30000 ? rawText.slice(0, 30000) : rawText;
      const doc = await extractTemplate({
        jurisdiction: file.jurisdiction,
        language: file.language,
        type: file.type,
        rawText: truncated,
      });

      const title = path.basename(file.abs, file.ext);
      await prisma.contractTemplate.create({
        data: {
          jurisdiction: file.jurisdiction,
          language: file.language,
          type: file.type,
          title,
          source,
          rawText,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sections: doc.sections as any,
        },
      });

      console.log(`   ✔ imported (${doc.sections.length} sections, ${rawText.length} chars raw)`);
      imported++;
    } catch (e) {
      console.error(`   ✖ failed: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone. imported=${imported} skipped=${skipped} failed=${failed}`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
