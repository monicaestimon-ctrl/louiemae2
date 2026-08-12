
import React, { createContext, useContext, ReactNode, useEffect, useRef } from 'react';
import { useQuery, useMutation, useConvexAuth } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Id } from '../convex/_generated/dataModel';
import { Subscriber, EmailCampaign } from '../types';

interface NewsletterContextType {
  addSubscriber: (email: string, firstName?: string) => Promise<boolean>;
  addSubscriberWithTags: (email: string, firstName: string, tags: string[]) => Promise<boolean>;
}

interface NewsletterAdminContextType {
  subscribers: Subscriber[];
  subscriberListTruncated: boolean;
  campaigns: EmailCampaign[];
  deleteSubscriber: (id: string) => void;
  createCampaign: (campaign: Omit<EmailCampaign, 'id' | 'stats' | 'status'>) => void;
  updateCampaign: (id: string, updates: Partial<EmailCampaign>) => void;
  sendCampaign: (id: string) => Promise<void>;
  deleteCampaign: (id: string) => void;
  stats: {
    totalSubscribers: number;
    avgOpenRate: number;
    totalEmailsSent: number;
  };
}

const NewsletterContext = createContext<NewsletterContextType | undefined>(undefined);

// Initial Mock Data for seeding
const INITIAL_SUBSCRIBERS = [
  { email: 'sarah@example.com', firstName: 'Sarah', dateSubscribed: '2023-10-15', status: 'active' as const, tags: ['vip'], openRate: 85 },
  { email: 'mike@design.co', firstName: 'Mike', dateSubscribed: '2023-11-02', status: 'active' as const, tags: ['welcome-series'], openRate: 45 },
  { email: 'jessica@home.com', firstName: 'Jessica', dateSubscribed: '2023-12-10', status: 'unsubscribed' as const, tags: [], openRate: 10 },
  { email: 'hello@louiemae.com', firstName: 'Admin', dateSubscribed: '2021-01-01', status: 'active' as const, tags: ['admin'], openRate: 100 },
];

const INITIAL_CAMPAIGNS = [
  {
    subject: 'A Story of Slow Living',
    previewText: 'Discover the art of rest.',
    content: '<p>Dear Friend,</p><p>Rest is not idleness...</p>',
    status: 'sent' as const,
    sentDate: '2023-12-01',
    type: 'newsletter' as const,
    stats: { sent: 1250, opened: 850, clicked: 320 }
  },
  {
    subject: 'New Arrivals: The Linen Collection',
    previewText: 'Soft, breathable, timeless.',
    content: '<p>Introducing our newest texture...</p>',
    status: 'sent' as const,
    sentDate: '2024-01-15',
    type: 'promotion' as const,
    stats: { sent: 1340, opened: 600, clicked: 150 }
  },
];

export const NewsletterProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Public pages only receive the subscribe mutation. Subscriber and campaign
  // records are loaded by useNewsletterAdmin, which is mounted with AdminPage.
  const createSubscriber = useMutation(api.subscribers.create);

  // --- Actions ---
  const addSubscriber = async (email: string, firstName?: string): Promise<boolean> => {
    const result = await createSubscriber({ email, firstName });
    if (result === null) return false; // Already exists
    return true;
  };

  const addSubscriberWithTags = async (email: string, firstName: string, tags: string[]): Promise<boolean> => {
    const result = await createSubscriber({ email, firstName, tags });
    // Even if subscriber already existed, their tags were merged, so always show success
    return true;
  };

  return (
    <NewsletterContext.Provider value={{
      addSubscriber,
      addSubscriberWithTags,
    }}>
      {children}
    </NewsletterContext.Provider>
  );
};

export const useNewsletter = () => {
  const context = useContext(NewsletterContext);
  if (context === undefined) {
    throw new Error('useNewsletter must be used within a NewsletterProvider');
  }
  return context;
};

export const useNewsletterAdmin = (): NewsletterAdminContextType => {
  const { isAuthenticated } = useConvexAuth();
  const subscriberResult = useQuery(api.subscribers.list, isAuthenticated ? {} : 'skip');
  const convexSubscribers = subscriberResult?.subscribers;
  const convexCampaigns = useQuery(api.campaigns.list, isAuthenticated ? {} : 'skip');
  const removeSubscriber = useMutation(api.subscribers.remove);
  const seedSubscribers = useMutation(api.subscribers.seed);
  const createCampaignMutation = useMutation(api.campaigns.create);
  const updateCampaignMutation = useMutation(api.campaigns.update);
  const sendCampaignMutation = useMutation(api.campaigns.send);
  const removeCampaign = useMutation(api.campaigns.remove);
  const seedCampaigns = useMutation(api.campaigns.seed);
  const subscriberSeedStarted = useRef(false);
  const campaignSeedStarted = useRef(false);

  useEffect(() => {
    if (isAuthenticated && convexSubscribers?.length === 0 && !subscriberSeedStarted.current) {
      subscriberSeedStarted.current = true;
      void seedSubscribers({ subscribers: INITIAL_SUBSCRIBERS })
        .catch(error => console.error('Subscriber seeding failed:', error));
    }
  }, [isAuthenticated, convexSubscribers, seedSubscribers]);

  useEffect(() => {
    if (isAuthenticated && convexCampaigns?.length === 0 && !campaignSeedStarted.current) {
      campaignSeedStarted.current = true;
      void seedCampaigns({ campaigns: INITIAL_CAMPAIGNS })
        .catch(error => console.error('Campaign seeding failed:', error));
    }
  }, [isAuthenticated, convexCampaigns, seedCampaigns]);

  const subscribers: Subscriber[] = (convexSubscribers ?? []).map((subscriber) => ({
    ...subscriber,
    id: subscriber._id,
  }));
  const campaigns: EmailCampaign[] = (convexCampaigns ?? []).map((campaign) => ({
    ...campaign,
    id: campaign._id,
  }));

  return {
    subscribers,
    subscriberListTruncated: subscriberResult?.truncated ?? false,
    campaigns,
    deleteSubscriber: (id) => { void removeSubscriber({ id: id as Id<"subscribers"> }); },
    createCampaign: (campaign) => { void createCampaignMutation(campaign); },
    updateCampaign: (id, updates) => {
      const { id: _id, ...rest } = updates as any;
      void updateCampaignMutation({ id: id as Id<"campaigns">, ...rest });
    },
    sendCampaign: async (id) => { await sendCampaignMutation({ id: id as Id<"campaigns"> }); },
    deleteCampaign: (id) => { void removeCampaign({ id: id as Id<"campaigns"> }); },
    stats: {
      totalSubscribers: subscribers.length,
      avgOpenRate: Math.round(subscribers.reduce((sum, subscriber) => sum + subscriber.openRate, 0) / (subscribers.length || 1)),
      totalEmailsSent: campaigns.reduce((sum, campaign) => sum + campaign.stats.sent, 0),
    },
  };
};
