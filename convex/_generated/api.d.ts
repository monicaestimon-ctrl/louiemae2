/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as aiUsage from "../aiUsage.js";
import type * as aliexpress from "../aliexpress.js";
import type * as auth from "../auth.js";
import type * as authLinking from "../authLinking.js";
import type * as batchImportCompletion from "../batchImportCompletion.js";
import type * as batchImports from "../batchImports.js";
import type * as blogPosts from "../blogPosts.js";
import type * as brandVoice from "../brandVoice.js";
import type * as campaigns from "../campaigns.js";
import type * as catCategories from "../catCategories.js";
import type * as catCore from "../catCore.js";
import type * as catEvidence from "../catEvidence.js";
import type * as catMedia from "../catMedia.js";
import type * as catMediaProcessing from "../catMediaProcessing.js";
import type * as catPolicies from "../catPolicies.js";
import type * as catPricing from "../catPricing.js";
import type * as catPublication from "../catPublication.js";
import type * as catStock from "../catStock.js";
import type * as catShipping from "../catShipping.js";
import type * as catalog from "../catalog.js";
import type * as catalogMaintenance from "../catalogMaintenance.js";
import type * as catalogMigration from "../catalogMigration.js";
import type * as catalogReadiness from "../catalogReadiness.js";
import type * as cjActions from "../cjActions.js";
import type * as cjAdminAccess from "../cjAdminAccess.js";
import type * as cjApiClient from "../cjApiClient.js";
import type * as cjControlRoom from "../cjControlRoom.js";
import type * as cjDropshipping from "../cjDropshipping.js";
import type * as cjFulfillmentAudits from "../cjFulfillmentAudits.js";
import type * as cjHelpers from "../cjHelpers.js";
import type * as cjInventoryTargetMaintenance from "../cjInventoryTargetMaintenance.js";
import type * as cjInventoryTargets from "../cjInventoryTargets.js";
import type * as cjPricingReview from "../cjPricingReview.js";
import type * as cjPricingValidators from "../cjPricingValidators.js";
import type * as cjRiskMonitor from "../cjRiskMonitor.js";
import type * as cjSourcingJobs from "../cjSourcingJobs.js";
import type * as cjSourcingWorkers from "../cjSourcingWorkers.js";
import type * as cjUsage from "../cjUsage.js";
import type * as commerce from "../commerce.js";
import type * as commerceAI from "../commerceAI.js";
import type * as commerceEmail from "../commerceEmail.js";
import type * as commerceFulfillment from "../commerceFulfillment.js";
import type * as commerceGeneration from "../commerceGeneration.js";
import type * as commerceImport from "../commerceImport.js";
import type * as commerceProjects from "../commerceProjects.js";
import type * as commerceReadiness from "../commerceReadiness.js";
import type * as commerceStripe from "../commerceStripe.js";
import type * as commerceTables from "../commerceTables.js";
import type * as crons from "../crons.js";
import type * as customPages from "../customPages.js";
import type * as dataLifecycle from "../dataLifecycle.js";
import type * as descriptionAudits from "../descriptionAudits.js";
import type * as descriptionValidators from "../descriptionValidators.js";
import type * as dlvTaxExemptions from "../dlvTaxExemptions.js";
import type * as dlvPerimeter from "../dlvPerimeter.js";
import type * as dlvTelemetry from "../dlvTelemetry.js";
import type * as dlvTax from "../dlvTax.js";
import type * as dlvTaxActions from "../dlvTaxActions.js";
import type * as dlvManual from "../dlvManual.js";
import type * as dlvCommission from "../dlvCommission.js";
import type * as dlvSecurity from "../dlvSecurity.js";
import type * as dlvAccess from "../dlvAccess.js";
import type * as dlvProjectPricing from "../dlvProjectPricing.js";
import type * as dlvQuoteLifecycle from "../dlvQuoteLifecycle.js";
import type * as dlvAdmin from "../dlvAdmin.js";
import type * as dlvEngine from "../dlvEngine.js";
import type * as dlvEstimates from "../dlvEstimates.js";
import type * as dlvOperations from "../dlvOperations.js";
import type * as dlvTradeCalculator from "../dlvTradeCalculator.js";
import type * as ediZuo from "../ediZuo.js";
import type * as emails from "../emails.js";
import type * as files from "../files.js";
import type * as functions from "../functions.js";
import type * as furniture from "../furniture.js";
import type * as furnitureEmail from "../furnitureEmail.js";
import type * as furnitureImport from "../furnitureImport.js";
import type * as furnitureTables from "../furnitureTables.js";
import type * as geminiDescriptionClient from "../geminiDescriptionClient.js";
import type * as geminiNameClient from "../geminiNameClient.js";
import type * as holm from "../holm.js";
import type * as holmAccess from "../holmAccess.js";
import type * as holmAdmin from "../holmAdmin.js";
import type * as holmAssets from "../holmAssets.js";
import type * as holmConnect from "../holmConnect.js";
import type * as holmCredit from "../holmCredit.js";
import type * as holmEmail from "../holmEmail.js";
import type * as holmPartners from "../holmPartners.js";
import type * as holmPayouts from "../holmPayouts.js";
import type * as holmPins from "../holmPins.js";
import type * as holmPlans from "../holmPlans.js";
import type * as holmRender from "../holmRender.js";
import type * as holmRenderAI from "../holmRenderAI.js";
import type * as holmRenderEmail from "../holmRenderEmail.js";
import type * as holmSourcing from "../holmSourcing.js";
import type * as holmSync from "../holmSync.js";
import type * as holmTables from "../holmTables.js";
import type * as http from "../http.js";
import type * as klaviyoWaitlist from "../klaviyoWaitlist.js";
import type * as klaviyoWaitlistWorker from "../klaviyoWaitlistWorker.js";
import type * as ldgCommissions from "../ldgCommissions.js";
import type * as ldgCore from "../ldgCore.js";
import type * as ldgCredits from "../ldgCredits.js";
import type * as ldgPayoutActions from "../ldgPayoutActions.js";
import type * as ldgPayouts from "../ldgPayouts.js";
import type * as ordCheckout from "../ordCheckout.js";
import type * as ordAccess from "../ordAccess.js";
import type * as ordReceipts from "../ordReceipts.js";
import type * as ordFulfillment from "../ordFulfillment.js";
import type * as ordInventory from "../ordInventory.js";
import type * as ordExceptionActions from "../ordExceptionActions.js";
import type * as ordExceptionRefunds from "../ordExceptionRefunds.js";
import type * as ordExceptionFulfillment from "../ordExceptionFulfillment.js";
import type * as ordPayments from "../ordPayments.js";
import type * as ordQuotes from "../ordQuotes.js";
import type * as ordReturns from "../ordReturns.js";
import type * as orders from "../orders.js";
import type * as pinnedLookup from "../pinnedLookup.js";
import type * as prgAttribution from "../prgAttribution.js";
import type * as prgCore from "../prgCore.js";
import type * as prgLinks from "../prgLinks.js";
import type * as prgMemberships from "../prgMemberships.js";
import type * as prgTiers from "../prgTiers.js";
import type * as pricingAudits from "../pricingAudits.js";
import type * as productCategoryAssignments from "../productCategoryAssignments.js";
import type * as productFacts from "../productFacts.js";
import type * as productHealth from "../productHealth.js";
import type * as productHealthMaintenance from "../productHealthMaintenance.js";
import type * as productImageRecords from "../productImageRecords.js";
import type * as productImages from "../productImages.js";
import type * as productMigrations from "../productMigrations.js";
import type * as productNameRegistry from "../productNameRegistry.js";
import type * as productSourceActions from "../productSourceActions.js";
import type * as productSources from "../productSources.js";
import type * as products from "../products.js";
import type * as retailLaunch from "../retailLaunch.js";
import type * as retailStorefront from "../retailStorefront.js";
import type * as scraper from "../scraper.js";
import type * as siteContent from "../siteContent.js";
import type * as smartDescriptions from "../smartDescriptions.js";
import type * as smartNames from "../smartNames.js";
import type * as sourceProductNormalizer from "../sourceProductNormalizer.js";
import type * as sourcePropertiesValidator from "../sourcePropertiesValidator.js";
import type * as sourcingCounts from "../sourcingCounts.js";
import type * as sourcingCountsMaintenance from "../sourcingCountsMaintenance.js";
import type * as subscribers from "../subscribers.js";
import type * as sysAlerts from "../sysAlerts.js";
import type * as sysConfig from "../sysConfig.js";
import type * as sysCore from "../sysCore.js";
import type * as sysNotifyAdmin from "../sysNotifyAdmin.js";
import type * as sysNotifySender from "../sysNotifySender.js";
import type * as sysNotify from "../sysNotify.js";
import type * as translations from "../translations.js";
import type * as v2Admin from "../v2Admin.js";
import type * as v2Migrations from "../v2Migrations.js";
import type * as v2Tables from "../v2Tables.js";
import type * as v2Validators from "../v2Validators.js";
import type * as visualFactCache from "../visualFactCache.js";
import type * as waitlist from "../waitlist.js";
import type * as webhookExpiryMaintenance from "../webhookExpiryMaintenance.js";
import type * as webhookExpiryQueue from "../webhookExpiryQueue.js";
import type * as webhookRecoveryMaintenance from "../webhookRecoveryMaintenance.js";
import type * as webhookRecoveryQueue from "../webhookRecoveryQueue.js";
import type * as webhookRetention from "../webhookRetention.js";
import type * as webhookSummaries from "../webhookSummaries.js";
import type * as webhookSummaryMaintenance from "../webhookSummaryMaintenance.js";
import type * as zuoImport from "../zuoImport.js";
import type * as zuoStaging from "../zuoStaging.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  aiUsage: typeof aiUsage;
  aliexpress: typeof aliexpress;
  auth: typeof auth;
  authLinking: typeof authLinking;
  batchImportCompletion: typeof batchImportCompletion;
  batchImports: typeof batchImports;
  blogPosts: typeof blogPosts;
  brandVoice: typeof brandVoice;
  campaigns: typeof campaigns;
  catCategories: typeof catCategories;
  catCore: typeof catCore;
  catMedia: typeof catMedia;
  catMediaProcessing: typeof catMediaProcessing;
  catPolicies: typeof catPolicies;
  catPricing: typeof catPricing;
  catEvidence: typeof catEvidence;
  catPublication: typeof catPublication;
  catStock: typeof catStock;
  catShipping: typeof catShipping;
  catalog: typeof catalog;
  catalogMaintenance: typeof catalogMaintenance;
  catalogMigration: typeof catalogMigration;
  catalogReadiness: typeof catalogReadiness;
  cjActions: typeof cjActions;
  cjAdminAccess: typeof cjAdminAccess;
  cjApiClient: typeof cjApiClient;
  cjControlRoom: typeof cjControlRoom;
  cjDropshipping: typeof cjDropshipping;
  cjFulfillmentAudits: typeof cjFulfillmentAudits;
  cjHelpers: typeof cjHelpers;
  cjInventoryTargetMaintenance: typeof cjInventoryTargetMaintenance;
  cjInventoryTargets: typeof cjInventoryTargets;
  cjPricingReview: typeof cjPricingReview;
  cjPricingValidators: typeof cjPricingValidators;
  cjRiskMonitor: typeof cjRiskMonitor;
  cjSourcingJobs: typeof cjSourcingJobs;
  cjSourcingWorkers: typeof cjSourcingWorkers;
  cjUsage: typeof cjUsage;
  commerce: typeof commerce;
  commerceAI: typeof commerceAI;
  commerceEmail: typeof commerceEmail;
  commerceFulfillment: typeof commerceFulfillment;
  commerceGeneration: typeof commerceGeneration;
  commerceImport: typeof commerceImport;
  commerceProjects: typeof commerceProjects;
  commerceReadiness: typeof commerceReadiness;
  commerceStripe: typeof commerceStripe;
  commerceTables: typeof commerceTables;
  crons: typeof crons;
  customPages: typeof customPages;
  dataLifecycle: typeof dataLifecycle;
  descriptionAudits: typeof descriptionAudits;
  descriptionValidators: typeof descriptionValidators;
  dlvTaxExemptions: typeof dlvTaxExemptions;
  dlvPerimeter: typeof dlvPerimeter;
  dlvTelemetry: typeof dlvTelemetry;
  dlvTax: typeof dlvTax;
  dlvTaxActions: typeof dlvTaxActions;
  dlvManual: typeof dlvManual;
  dlvCommission: typeof dlvCommission;
  dlvSecurity: typeof dlvSecurity;
  dlvAccess: typeof dlvAccess;
  dlvProjectPricing: typeof dlvProjectPricing;
  dlvQuoteLifecycle: typeof dlvQuoteLifecycle;
  dlvAdmin: typeof dlvAdmin;
  dlvEngine: typeof dlvEngine;
  dlvEstimates: typeof dlvEstimates;
  dlvOperations: typeof dlvOperations;
  dlvTradeCalculator: typeof dlvTradeCalculator;
  ediZuo: typeof ediZuo;
  emails: typeof emails;
  files: typeof files;
  functions: typeof functions;
  furniture: typeof furniture;
  furnitureEmail: typeof furnitureEmail;
  furnitureImport: typeof furnitureImport;
  furnitureTables: typeof furnitureTables;
  geminiDescriptionClient: typeof geminiDescriptionClient;
  geminiNameClient: typeof geminiNameClient;
  holm: typeof holm;
  holmAccess: typeof holmAccess;
  holmAdmin: typeof holmAdmin;
  holmAssets: typeof holmAssets;
  holmConnect: typeof holmConnect;
  holmCredit: typeof holmCredit;
  holmEmail: typeof holmEmail;
  holmPartners: typeof holmPartners;
  holmPayouts: typeof holmPayouts;
  holmPins: typeof holmPins;
  holmPlans: typeof holmPlans;
  holmRender: typeof holmRender;
  holmRenderAI: typeof holmRenderAI;
  holmRenderEmail: typeof holmRenderEmail;
  holmSourcing: typeof holmSourcing;
  holmSync: typeof holmSync;
  holmTables: typeof holmTables;
  http: typeof http;
  klaviyoWaitlist: typeof klaviyoWaitlist;
  klaviyoWaitlistWorker: typeof klaviyoWaitlistWorker;
  ldgCommissions: typeof ldgCommissions;
  ldgCore: typeof ldgCore;
  ldgCredits: typeof ldgCredits;
  ldgPayoutActions: typeof ldgPayoutActions;
  ldgPayouts: typeof ldgPayouts;
  ordCheckout: typeof ordCheckout;
  ordAccess: typeof ordAccess;
  ordReceipts: typeof ordReceipts;
  ordFulfillment: typeof ordFulfillment;
  ordInventory: typeof ordInventory;
  ordExceptionActions: typeof ordExceptionActions;
  ordExceptionRefunds: typeof ordExceptionRefunds;
  ordExceptionFulfillment: typeof ordExceptionFulfillment;
  ordPayments: typeof ordPayments;
  ordQuotes: typeof ordQuotes;
  ordReturns: typeof ordReturns;
  orders: typeof orders;
  pinnedLookup: typeof pinnedLookup;
  prgAttribution: typeof prgAttribution;
  prgCore: typeof prgCore;
  prgLinks: typeof prgLinks;
  prgMemberships: typeof prgMemberships;
  prgTiers: typeof prgTiers;
  pricingAudits: typeof pricingAudits;
  productCategoryAssignments: typeof productCategoryAssignments;
  productFacts: typeof productFacts;
  productHealth: typeof productHealth;
  productHealthMaintenance: typeof productHealthMaintenance;
  productImageRecords: typeof productImageRecords;
  productImages: typeof productImages;
  productMigrations: typeof productMigrations;
  productNameRegistry: typeof productNameRegistry;
  productSourceActions: typeof productSourceActions;
  productSources: typeof productSources;
  products: typeof products;
  retailLaunch: typeof retailLaunch;
  retailStorefront: typeof retailStorefront;
  scraper: typeof scraper;
  siteContent: typeof siteContent;
  smartDescriptions: typeof smartDescriptions;
  smartNames: typeof smartNames;
  sourceProductNormalizer: typeof sourceProductNormalizer;
  sourcePropertiesValidator: typeof sourcePropertiesValidator;
  sourcingCounts: typeof sourcingCounts;
  sourcingCountsMaintenance: typeof sourcingCountsMaintenance;
  subscribers: typeof subscribers;
  sysAlerts: typeof sysAlerts;
  sysConfig: typeof sysConfig;
  sysCore: typeof sysCore;
  sysNotifyAdmin: typeof sysNotifyAdmin;
  sysNotifySender: typeof sysNotifySender;
  sysNotify: typeof sysNotify;
  translations: typeof translations;
  v2Admin: typeof v2Admin;
  v2Migrations: typeof v2Migrations;
  v2Tables: typeof v2Tables;
  v2Validators: typeof v2Validators;
  visualFactCache: typeof visualFactCache;
  waitlist: typeof waitlist;
  webhookExpiryMaintenance: typeof webhookExpiryMaintenance;
  webhookExpiryQueue: typeof webhookExpiryQueue;
  webhookRecoveryMaintenance: typeof webhookRecoveryMaintenance;
  webhookRecoveryQueue: typeof webhookRecoveryQueue;
  webhookRetention: typeof webhookRetention;
  webhookSummaries: typeof webhookSummaries;
  webhookSummaryMaintenance: typeof webhookSummaryMaintenance;
  zuoImport: typeof zuoImport;
  zuoStaging: typeof zuoStaging;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
