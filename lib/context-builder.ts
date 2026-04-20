/**
 * Stateful "Deal Facts" loader.
 *
 * The contract generator must trust real entities in the database — names,
 * addresses, amounts — and never hallucinate them. This module is the
 * Prisma-aware boundary: the API route asks for facts by ID, gets back a
 * structured object plus a flat plain-text "Fact Sheet" string ready to
 * inject into the LLM prompt.
 *
 * Importantly: this file knows about Prisma. lib/ai.ts and lib/prompts.ts
 * stay Prisma-free — they accept the already-serialized string. The API
 * route is the orchestrator that wires the two together.
 */

import type { PrismaClient, Deal, Property, Tenant, Landlord } from "@prisma/client";

export interface DealContextEntities {
  property: Property | null;
  tenant: Tenant | null;
  landlord: Landlord | null;
  deal: Deal | null;
}

export interface DealContext extends DealContextEntities {
  /** Plain-text fact sheet ready for LLM injection. Empty string when no
   *  entities resolved. */
  factSheet: string;
  /** Convenience: which fields are still missing (so the prompt can hint
   *  the model to placeholder them). */
  missing: string[];
}

export interface DealContextRequest {
  propertyId?: string | null;
  tenantId?: string | null;
  dealId?: string | null;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

/**
 * Resolve a deal context from any combination of IDs:
 * - dealId alone is enough (we walk to property/tenant/landlord through it)
 * - propertyId + tenantId picks the most recent deal joining them, if any,
 *   and falls back to the property's owner as the landlord
 * - propertyId alone gives property + (its owner) landlord, no tenant
 * - tenantId alone gives just the tenant
 */
export async function fetchDealContext(
  prisma: PrismaClient,
  req: DealContextRequest,
): Promise<DealContextEntities> {
  let deal: Deal | null = null;
  let property: Property | null = null;
  let tenant: Tenant | null = null;
  let landlord: Landlord | null = null;

  if (req.dealId) {
    const found = await prisma.deal.findUnique({
      where: { id: req.dealId },
      include: { property: true, tenant: true, landlord: true },
    });
    if (found) {
      deal = stripRels(found);
      property = found.property;
      tenant = found.tenant;
      landlord = found.landlord;
    }
  }

  if (!deal && req.propertyId && req.tenantId) {
    const found = await prisma.deal.findFirst({
      where: { propertyId: req.propertyId, tenantId: req.tenantId },
      orderBy: { createdAt: "desc" },
      include: { property: true, tenant: true, landlord: true },
    });
    if (found) {
      deal = stripRels(found);
      property = found.property;
      tenant = found.tenant;
      landlord = found.landlord;
    }
  }

  if (!property && req.propertyId) {
    property = await prisma.property.findUnique({
      where: { id: req.propertyId },
      include: { owner: true },
    }).then((p) => {
      if (p?.owner) landlord = p.owner;
      if (p) {
        const { owner: _owner, ...rest } = p;
        void _owner;
        return rest as Property;
      }
      return null;
    });
  }

  if (!tenant && req.tenantId) {
    tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
  }

  return { property, tenant, landlord, deal };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/**
 * Render a DealContextEntities into a flat, structured "Fact Sheet" — the
 * exact form we paste into the prompt. Empty fields are deliberately omitted
 * (the prompt instructs the model to placeholder anything not stated here).
 *
 * The fact sheet is language-neutral and English-keyed; the model uses it
 * as ground truth and writes the contract in whichever language the caller
 * asked for.
 */
export function serializeDealFacts(ctx: DealContextEntities): {
  factSheet: string;
  missing: string[];
} {
  const lines: string[] = [];
  const missing: string[] = [];

  // ---- Property ----
  if (ctx.property) {
    const p = ctx.property;
    lines.push("PROPERTY");
    lines.push(`- Address: ${p.address}${p.unit ? `, ${p.unit}` : ""}`);
    lines.push(`- City: ${p.city}`);
    lines.push(`- Jurisdiction: ${p.jurisdiction}`);
    if (p.rooms != null) lines.push(`- Rooms: ${p.rooms}`);
    if (p.bathrooms != null) lines.push(`- Bathrooms: ${p.bathrooms}`);
    if (p.areaSqm != null) lines.push(`- Area: ${p.areaSqm} sqm`);
    lines.push(`- Furnished: ${p.furnished ? "Yes" : "No"}`);
    lines.push(`- Parking: ${p.parking ? "Yes" : "No"}`);
    if (p.description) lines.push(`- Description: ${p.description}`);
    lines.push("");
  } else {
    missing.push("PROPERTY_FULL_ADDRESS", "PROPERTY_TYPE");
  }

  // ---- Landlord ----
  if (ctx.landlord) {
    const l = ctx.landlord;
    lines.push("LANDLORD");
    lines.push(`- Full Name: ${l.fullName}`);
    if (l.idNumber) lines.push(`- ID Number: ${l.idNumber}`);
    if (l.email) lines.push(`- Email: ${l.email}`);
    if (l.phone) lines.push(`- Phone: ${l.phone}`);
    if (l.address) lines.push(`- Address: ${l.address}`);
    lines.push("");
  } else {
    missing.push("LANDLORD_FULL_NAME", "LANDLORD_ID_NUMBER");
  }

  // ---- Tenant ----
  if (ctx.tenant) {
    const t = ctx.tenant;
    lines.push("TENANT");
    lines.push(`- Full Name: ${t.fullName}`);
    if (t.idNumber) lines.push(`- ID Number: ${t.idNumber}`);
    if (t.email) lines.push(`- Email: ${t.email}`);
    if (t.phone) lines.push(`- Phone: ${t.phone}`);
    if (t.address) lines.push(`- Address: ${t.address}`);
    lines.push("");
  } else {
    missing.push("TENANT_FULL_NAME", "TENANT_ID_NUMBER");
  }

  // ---- Lease Terms ----
  if (ctx.deal) {
    const d = ctx.deal;
    lines.push("LEASE TERMS");
    lines.push(`- Contract Type: ${d.contractType}`);
    if (d.monthlyRent != null) lines.push(`- Monthly Rent: ${d.monthlyRent} ${d.rentCurrency}`);
    if (d.depositAmount != null) lines.push(`- Security Deposit: ${d.depositAmount} ${d.rentCurrency}`);
    if (d.startDate) lines.push(`- Start Date: ${d.startDate.toISOString().slice(0, 10)}`);
    if (d.endDate) lines.push(`- End Date: ${d.endDate.toISOString().slice(0, 10)}`);
    if (d.termMonths != null) lines.push(`- Term: ${d.termMonths} months`);
    if (d.notes) lines.push(`- Notes: ${d.notes}`);
  } else {
    missing.push(
      "MONTHLY_RENT_AMOUNT",
      "SECURITY_DEPOSIT_AMOUNT",
      "LEASE_START_DATE",
      "LEASE_END_DATE",
    );
  }

  return { factSheet: lines.join("\n").trim(), missing };
}

// ---------------------------------------------------------------------------
// Combined fetch + serialize (the typical call from the API layer)
// ---------------------------------------------------------------------------

export async function fetchAndSerializeDealContext(
  prisma: PrismaClient,
  req: DealContextRequest,
): Promise<DealContext> {
  const entities = await fetchDealContext(prisma, req);
  const { factSheet, missing } = serializeDealFacts(entities);
  return { ...entities, factSheet, missing };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function stripRels<T extends { property?: unknown; tenant?: unknown; landlord?: unknown }>(
  obj: T,
): Deal {
  const { property: _p, tenant: _t, landlord: _l, ...rest } = obj;
  void _p; void _t; void _l;
  return rest as unknown as Deal;
}
