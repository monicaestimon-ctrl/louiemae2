/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aliexpress from "../aliexpress.js";
import type * as auth from "../auth.js";
import type * as batchImports from "../batchImports.js";
import type * as blogPosts from "../blogPosts.js";
import type * as brandVoice from "../brandVoice.js";
import type * as campaigns from "../campaigns.js";
import type * as cjActions from "../cjActions.js";
import type * as cjAdminAccess from "../cjAdminAccess.js";
import type * as cjApiClient from "../cjApiClient.js";
import type * as cjControlRoom from "../cjControlRoom.js";
import type * as cjDropshipping from "../cjDropshipping.js";
import type * as cjFulfillmentAudits from "../cjFulfillmentAudits.js";
import type * as cjHelpers from "../cjHelpers.js";
import type * as cjRiskMonitor from "../cjRiskMonitor.js";
import type * as crons from "../crons.js";
import type * as customPages from "../customPages.js";
import type * as descriptionAudits from "../descriptionAudits.js";
import type * as descriptionValidators from "../descriptionValidators.js";
import type * as emails from "../emails.js";
import type * as files from "../files.js";
import type * as geminiDescriptionClient from "../geminiDescriptionClient.js";
import type * as geminiNameClient from "../geminiNameClient.js";
import type * as http from "../http.js";
import type * as orders from "../orders.js";
import type * as pinnedLookup from "../pinnedLookup.js";
import type * as pricingAudits from "../pricingAudits.js";
import type * as productFacts from "../productFacts.js";
import type * as productImageRecords from "../productImageRecords.js";
import type * as productImages from "../productImages.js";
import type * as products from "../products.js";
import type * as scraper from "../scraper.js";
import type * as siteContent from "../siteContent.js";
import type * as smartDescriptions from "../smartDescriptions.js";
import type * as smartNames from "../smartNames.js";
import type * as sourceProductNormalizer from "../sourceProductNormalizer.js";
import type * as subscribers from "../subscribers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aliexpress: typeof aliexpress;
  auth: typeof auth;
  batchImports: typeof batchImports;
  blogPosts: typeof blogPosts;
  brandVoice: typeof brandVoice;
  campaigns: typeof campaigns;
  cjActions: typeof cjActions;
  cjAdminAccess: typeof cjAdminAccess;
  cjApiClient: typeof cjApiClient;
  cjControlRoom: typeof cjControlRoom;
  cjDropshipping: typeof cjDropshipping;
  cjFulfillmentAudits: typeof cjFulfillmentAudits;
  cjHelpers: typeof cjHelpers;
  cjRiskMonitor: typeof cjRiskMonitor;
  crons: typeof crons;
  customPages: typeof customPages;
  descriptionAudits: typeof descriptionAudits;
  descriptionValidators: typeof descriptionValidators;
  emails: typeof emails;
  files: typeof files;
  geminiDescriptionClient: typeof geminiDescriptionClient;
  geminiNameClient: typeof geminiNameClient;
  http: typeof http;
  orders: typeof orders;
  pinnedLookup: typeof pinnedLookup;
  pricingAudits: typeof pricingAudits;
  productFacts: typeof productFacts;
  productImageRecords: typeof productImageRecords;
  productImages: typeof productImages;
  products: typeof products;
  scraper: typeof scraper;
  siteContent: typeof siteContent;
  smartDescriptions: typeof smartDescriptions;
  smartNames: typeof smartNames;
  sourceProductNormalizer: typeof sourceProductNormalizer;
  subscribers: typeof subscribers;
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
