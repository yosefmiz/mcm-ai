import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  chatComplete,
  generateInitialContract,
  routeChatTurn,
  collectPlaceholders,
  type UsageInfo,
} from "@/lib/ai";
import { computeCostUsd } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const ChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
  uiLocale: z.string().min(2).max(8).optional(),
});

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { messages, uiLocale } = parsed.data;
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // ---- Route the latest user turn ----
  let route;
  try {
    route = await routeChatTurn(lastUserMsg, uiLocale ?? "en");
  } catch (e) {
    await logChat("CHAT", emptyUsage(), "ERROR", (e as Error).message, null);
    return NextResponse.json(
      { error: "Routing failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
  await logChat("CHAT", route.usage, "OK", null, null);

  // ---- generate_contract intent: invoke the full pipeline ----
  if (route.intent === "generate_contract") {
    const ip = clientIp(req);
    let docResult;
    try {
      docResult = await generateInitialContract({
        jurisdiction: route.params.jurisdiction,
        jurisdictionLanguage: route.params.jurisdictionLanguage,
        type: route.params.type,
        inputs: route.params.inputs,
        prisma,
      });
    } catch (e) {
      await logChat("GENERATE", emptyUsage(), "ERROR", (e as Error).message, null);
      return NextResponse.json(
        { error: "Generation failed", detail: (e as Error).message },
        { status: 502 },
      );
    }

    const saved = await prisma.contract.create({
      data: {
        jurisdiction: route.params.jurisdiction,
        jurisdictionLanguage: route.params.jurisdictionLanguage,
        // Chat-initiated drafts produce primary only — no translateTo.
        bridgeLanguage: null,
        uiLanguage: null,
        type: route.params.type,
        metadata: docResult.document.metadata as unknown as Prisma.InputJsonValue,
        sections: docResult.document.sections as unknown as Prisma.InputJsonValue,
        userIpAddress: ip,
      },
      select: { id: true, createdAt: true },
    });

    await logChat("GENERATE", docResult.usage, "OK", null, saved.id);

    const placeholders = collectPlaceholders(docResult.document.sections);
    const replyText = buildContractReplyText(route.params.uiLanguage, placeholders.length);

    return NextResponse.json({
      reply: replyText,
      usage: {
        ...docResult.usage,
        costUsd: computeCostUsd(docResult.usage.inputTokens, docResult.usage.outputTokens),
      },
      artifact: {
        type: "contract",
        contractId: saved.id,
        document: docResult.document,
        placeholders,
      },
    });
  }

  // ---- chat intent: normal Q&A ----
  let result;
  try {
    result = await chatComplete(messages);
  } catch (e) {
    await logChat("CHAT", emptyUsage(), "ERROR", (e as Error).message, null);
    return NextResponse.json(
      { error: "Chat failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
  await logChat("CHAT", result.usage, "OK", null, null);

  return NextResponse.json({
    reply: result.reply,
    usage: {
      ...result.usage,
      costUsd: computeCostUsd(result.usage.inputTokens, result.usage.outputTokens),
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContractReplyText(uiLang: string, placeholderCount: number): string {
  const lang = uiLang.toLowerCase().split("-")[0];
  const placeholderNote = placeholderCount > 0;

  switch (lang) {
    case "he":
      return placeholderNote
        ? `יצרתי עבורך טיוטת חוזה מלאה לפי הדין המקומי. ${placeholderCount} פרטים נשארו כ‑[[שדה]]; פתח כל סעיף למטה כדי לקרוא את הניסוח המלא ולמלא דרך ה‑API.`
        : "יצרתי עבורך טיוטת חוזה מלאה לפי הדין המקומי. פתח כל סעיף למטה כדי לקרוא את הניסוח המלא.";
    case "ar":
      return placeholderNote
        ? `أعددت لك مسودة عقد كاملة وفقاً للقانون المحلي. ${placeholderCount} حقولاً تركت كـ [[FIELD]]؛ افتح كل بند أدناه لقراءة الصياغة الكاملة وتعبئتها عبر الـ API.`
        : "أعددت لك مسودة عقد كاملة وفقاً للقانون المحلي. افتح كل بند أدناه لقراءة الصياغة الكاملة.";
    case "ru":
      return placeholderNote
        ? `Я подготовил для вас полный проект договора по местному праву. Осталось ${placeholderCount} полей вида [[FIELD]]; разверните каждый раздел ниже, чтобы прочитать полный текст и заполнить через API.`
        : "Я подготовил для вас полный проект договора по местному праву. Разверните каждый раздел ниже, чтобы прочитать полный текст.";
    default:
      return placeholderNote
        ? `I drafted a full contract for you under the local law. ${placeholderCount} field${placeholderCount === 1 ? "" : "s"} remain as [[FIELD]]; expand each section below to read the full clause and fill them via the API.`
        : "I drafted a full contract for you under the local law. Expand each section below to read the full clause.";
  }
}

function emptyUsage(): UsageInfo {
  return {
    model: process.env.OLLAMA_MODEL ?? "gemma4",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
  };
}

async function logChat(
  operation: "CHAT" | "GENERATE",
  usage: UsageInfo,
  status: "OK" | "ERROR",
  error: string | null,
  contractId: string | null,
): Promise<void> {
  const cost = computeCostUsd(usage.inputTokens, usage.outputTokens);
  try {
    await prisma.usageLog.create({
      data: {
        operation,
        jurisdiction: "-",
        language: "EN",
        type: "ANNUAL",
        sectionId: null,
        contractId,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        durationMs: usage.durationMs,
        costUsd: new Prisma.Decimal(cost.toFixed(6)),
        status,
        error,
      },
    });
  } catch {
    // best-effort
  }
}
