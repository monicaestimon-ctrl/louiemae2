# Smart Product Description Generation v2 Checklist

## Completed

- [x] Move smart description generation to a Convex action.
- [x] Use Convex `GEMINI_API_KEY` and configurable `SMART_DESCRIPTION_MODEL`.
- [x] Add centralized Louie Mae brand voice configuration.
- [x] Add unified `SourceProductSnapshot` types and builders.
- [x] Normalize source data, HTML, JSON-LD Product fields, tables, variants, images, and mojibake.
- [x] Strip prompt-injection-like source text before model calls.
- [x] Extract grounded facts with evidence levels and source quality scoring.
- [x] Add optional Gemini image analysis for low-risk visible product details.
- [x] Generate structured JSON drafts and format final copy server-side.
- [x] Validate structure, labels, banned phrases, mojibake, unsupported claims, source quality, and similarity.
- [x] Repair once, then use safe fact-only fallback if validation still fails.
- [x] Add `descriptionAudits` storage with model, prompt version, source hash, facts, output, validation, fallback, and warnings.
- [x] Add product `smartDescription`, `descriptionSource`, and fingerprint fields.
- [x] Update ProductImport to send rich source snapshots and show warnings/source quality/audit metadata.
- [x] Update ProductStudio to generate via Convex and approve or mark edited descriptions on save.
- [x] Add batch regeneration preview queue with per-product approve/reject.
- [x] Add unit coverage for sanitizer, JSON-LD extraction, fact validation, visual low-risk facts, and safe fallback.

## Verification

- [x] `npx.cmd convex codegen`
- [x] `npm.cmd run test:run`
- [x] `npm.cmd run build`

## Known Follow-Up

- [ ] Legacy non-description AI features still import `@google/genai` in frontend code and use `VITE_GEMINI_API_KEY`.
      The smart description workflow no longer uses the browser Gemini client, but fully removing frontend Gemini exposure from page generation,
      newsletter, concierge, and name/category suggestions should be handled as a separate migration.
