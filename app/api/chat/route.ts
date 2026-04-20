import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { chatComplete, type UsageInfo } from "@/lib/ai";
import { computeCostUsd } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await chatComplete(parsed.data.messages);
  } catch (e) {
    await logChat(emptyUsage(), "ERROR", (e as Error).message);
    return NextResponse.json(
      { error: "Chat failed", detail: (e as Error).message },
      { status: 502 },
    );
  }

  await logChat(result.usage, "OK", null);

  return NextResponse.json({
    reply: result.reply,
    usage: {
      ...result.usage,
      costUsd: computeCostUsd(result.usage.inputTokens, result.usage.outputTokens),
    },
  });
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
  usage: UsageInfo,
  status: "OK" | "ERROR",
  error: string | null,
): Promise<void> {
  const cost = computeCostUsd(usage.inputTokens, usage.outputTokens);
  try {
    await prisma.usageLog.create({
      data: {
        operation: "CHAT",
        jurisdiction: "-",
        language: "EN",
        type: "ANNUAL",
        sectionId: null,
        contractId: null,
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
