import { deferredFeature } from './deferredFeature';

export const DiscoverCatalog = deferredFeature(() => import('./DiscoverCatalog').then(m => ({ default: m.DiscoverCatalog })), 'Discover products');

export const TradeWelcome = deferredFeature(() => import('./TradeWelcome').then(m => ({ default: m.TradeWelcome })), 'Sign in');
export const TradeApplication = deferredFeature(() => import('./TradeApplication').then(m => ({ default: m.TradeApplication })), 'Trade application');
export const TradeDeliveryCalculator = deferredFeature(() => import('../components/delivery/TradeDeliveryCalculator'), 'Delivery calculator');
export const ProjectDeliveryPanel = deferredFeature(() => import('../components/delivery/ProjectDeliveryPanel'), 'Project delivery');
export const ProductDeliveryEstimate = deferredFeature(() => import('../components/delivery/ProductDeliveryEstimate'), 'Delivery estimate');
export const ProgramHubV2 = deferredFeature(() => import('../components/partner/ProgramHubV2'), 'Referrals and earnings');
export const TeamPanel = deferredFeature(() => import('../components/partner/ProgramHubV2').then(m => ({ default: m.TeamPanel })), 'Team settings');
export const ProductRetailReferral = deferredFeature(() => import('../components/partner/ProductRetailReferral'), 'Retail referrals');

export const TradeAccount = deferredFeature(() => import('./TradeAccount').then(m => ({ default: m.TradeAccount })), 'Account');
