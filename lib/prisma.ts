import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

/**
 * Neon HTTP driver via the Prisma adapter.
 *
 * The Neon serverless driver talks to Postgres over HTTPS instead of a
 * long-lived TCP pool connection. That matters here because our requests
 * can hold the DB connection idle for 60-180 seconds while gemma4
 * generates — Neon's pgbouncer pool will close idle TCP connections
 * during that window, causing the next query to fail with
 * "Error in PostgreSQL connection: Error { kind: Closed, cause: None }".
 * HTTP requests are stateless, so there is nothing to close.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function makeClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
