import type { Doc } from '../convex/_generated/dataModel';
import { evaluateProductCjReadiness } from './cjFulfillmentReadiness';

export const HEALTH_VERSION = 2;
export const emptyMigrationCounts = () => ({ pending: 0, approved: 0, rejected: 0 });
export function insertStuckHealthProblem(problems: string[]) {
  if (problems.includes('Stuck pending')) return problems;
  const imageProblems = new Set(['No images', 'Protocol-relative image URL (missing https:)',
    'Image hosted on 1688/AliExpress CDN (may expire)', 'Known broken Unsplash URL']);
  const firstOther = problems.findIndex(problem => !imageProblems.has(problem));
  const result = [...problems];
  result.splice(firstOther < 0 ? result.length : firstOther, 0, 'Stuck pending');
  return result;
}
export function productHealthProblems(product: Doc<'products'>, now: number): string[] {
  const problems: string[] = [];

  // Check for missing/broken images
  if (!product.images || product.images.length === 0) {
      problems.push("No images");
  } else {
      const firstImg = product.images[0];
      if (firstImg.startsWith("//")) {
          problems.push("Protocol-relative image URL (missing https:)");
      }
      if (firstImg.includes("1688.com") || firstImg.includes("alicdn.com") || firstImg.includes("cbu01.alicdn")) {
          problems.push("Image hosted on 1688/AliExpress CDN (may expire)");
      }
      if (firstImg.includes("photo-1612196808214")) {
          problems.push("Known broken Unsplash URL");
      }
  }

  // Check for stuck sourcing
  if (product.cjSourcingStatus === "pending") {
      const submittedAt = product.cjSubmittedAt ? new Date(product.cjSubmittedAt).getTime() : 0;
      const hoursSinceSubmission = submittedAt ? (now - submittedAt) / (1000 * 60 * 60) : 0;
      if (hoursSinceSubmission > 48) {
          problems.push(`Stuck pending for ${Math.round(hoursSinceSubmission)}h`);
      }
      if (!product.cjSourcingId) {
          problems.push("Pending but no cjSourcingId (never submitted to CJ)");
      }
  }

  // Check for approved products missing CJ data
  if (product.cjSourcingStatus === "approved") {
      const hasCustomerVariants = (product.variants?.length ?? 0) > 0;

      if (!product.cjProductId) problems.push("Approved but missing cjProductId");
      if (!hasCustomerVariants && !product.cjVariantId) {
          problems.push("Approved but missing cjVariantId");
      }
      if (hasCustomerVariants && (!product.cjVariants || product.cjVariants.length === 0)) {
          problems.push("Approved but no CJ variants (won't appear in Variant Mapping)");
      }
      if (hasCustomerVariants) {
          const unlinked = product.variants!.filter(v => !v.cjVariantId);
          if (unlinked.length > 0) {
              problems.push(`${unlinked.length}/${product.variants!.length} customer variants not linked to CJ`);
          }
      }
  }

  const hasCjFootprint =
      (product.cjSourcingStatus !== undefined && product.cjSourcingStatus !== "none") ||
      Boolean(product.cjProductId || product.cjVariantId || product.cjSku || (product.cjVariants?.length ?? 0) > 0);
  if (hasCjFootprint) {
      const readiness = evaluateProductCjReadiness(product);
      for (const problem of [...readiness.errors, ...readiness.warnings]) {
          problems.push(problem);
      }
  }

  return [...new Set(problems)];
}

export function productHealthProjection(product: Doc<'products'>, now: number) {
  const parsedSubmission = product.cjSubmittedAt ? Date.parse(product.cjSubmittedAt) : 0;
  const submittedAt = Number.isFinite(parsedSubmission) ? parsedSubmission : 0;
  const deadline = product.cjSourcingStatus === 'pending' && Number.isFinite(submittedAt) && submittedAt !== 0 ? submittedAt + 48 * 60 * 60 * 1000 + 1 : 0;
  const problems = productHealthProblems(product, now).map(problem => problem.startsWith('Stuck pending for ') ? 'Stuck pending' : problem);
  return {
    productId: product._id, version: HEALTH_VERSION, hasIssues: problems.length > 0,
    migrationStatus: product.cjSourcingJobId === undefined && product.cjSourcingStatus && product.cjSourcingStatus !== 'none'
      ? product.cjSourcingStatus : undefined,
    hasCjIssues: problems.some(isCjHealthProblem), dueAt: deadline > now ? deadline : 0,
    hasMissingCjVariants: problems.some(problem => problem.includes('Approved but no CJ variants')),
    details: { productId: product._id, name: product.name, problems, submittedAt,
      cjSourcingStatus: product.cjSourcingStatus, cjSourcingId: product.cjSourcingId,
      cjProductId: product.cjProductId, cjVariantId: product.cjVariantId,
      cjInventoryStatus: product.cjInventoryStatus, cjInventoryTotal: product.cjInventoryTotal,
      cjInventoryLastCheckedAt: product.cjInventoryLastCheckedAt,
      imageCount: product.images?.length || 0, firstImageUrl: product.images?.[0],
      hasVariants: (product.variants?.length || 0) > 0, hasCjVariants: (product.cjVariants?.length || 0) > 0,
    },
  };
}
export function isCjHealthProblem(problem: string) {
  const value = problem.toLowerCase();
  return ['cj', 'variant', 'inventory', 'stock'].some(word => value.includes(word));
}
export function healthDetails(row: ReturnType<typeof productHealthProjection>, now: number) {
  return { ...row.details, problems: row.details.problems.map(problem => problem === 'Stuck pending'
    ? `Stuck pending for ${Math.round((now - row.details.submittedAt) / 3_600_000)}h` : problem) };
}
