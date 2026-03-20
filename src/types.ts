export type Role = "user" | "admin";
export type Plan = "starter" | "pro" | "agency";
export type LeadStatus = "new" | "contacted" | "replied";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  plan: Plan;
  dealValue: number;
  twoFactorEnabled?: boolean;
}

export interface SessionResponse {
  token: string;
  user: SessionUser;
}

export interface Lead {
  id: string;
  name: string;
  company: string;
  website: string | null;
  email: string | null;
  location: string | null;
  status: LeadStatus;
  source: string | null;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  bodyTemplate: string;
  status: string;
  createdAt: string;
  _count?: {
    campaignLeads: number;
    emailLogs: number;
  };
}

export interface DashboardSummary {
  leadCount: number;
  emailsSent: number;
  replies: number;
  conversion: number;
  estimatedRevenue: number;
  recentLeads: Lead[];
  recentCampaigns: Campaign[];
  dealValue: number;
}