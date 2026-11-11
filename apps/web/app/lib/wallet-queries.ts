"use client";

import { useQuery } from "@tanstack/react-query";
import { walletApi, type ActivityFilter } from "./wallet-api";

/* The API has no push channel for the web yet, so live screens poll while the tab is visible. */
export const LIVE_MS = 8_000;
export const RATES_MS = 15_000;

export const keys = {
  me: ["me"] as const,
  vault: ["vault"] as const,
  activity: (filter: ActivityFilter) => ["activity", filter] as const,
  rates: (currency: string) => ["rate-board", currency] as const,
  recipients: ["recipients"] as const,
  people: ["people-recent"] as const,
  agents: ["agents"] as const,
  sources: ["deposit-sources"] as const,
  requests: ["requests"] as const,
  passkeys: ["passkeys"] as const,
  sessions: ["sessions"] as const,
  notifications: ["notification-settings"] as const,
  institutions: (country: string) => ["institutions", country] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: walletApi.me });

export const useVault = () => useQuery({ queryKey: keys.vault, queryFn: walletApi.vault, refetchInterval: LIVE_MS });

export const useActivity = (filter: ActivityFilter = "all") =>
  useQuery({ queryKey: keys.activity(filter), queryFn: () => walletApi.activity(filter), refetchInterval: LIVE_MS });

export const useRateBoard = (currency: string, enabled = true) =>
  useQuery({
    queryKey: keys.rates(currency),
    queryFn: () => walletApi.rateBoard(currency),
    refetchInterval: RATES_MS,
    enabled,
    retry: false,
  });

export const useRecipients = () => useQuery({ queryKey: keys.recipients, queryFn: walletApi.recipients });

export const useRecentPeople = () => useQuery({ queryKey: keys.people, queryFn: walletApi.recentPeople });

export const useAgents = () => useQuery({ queryKey: keys.agents, queryFn: walletApi.agents, refetchInterval: LIVE_MS });

export const useDepositSources = () => useQuery({ queryKey: keys.sources, queryFn: walletApi.depositSources });

export const useRequests = () => useQuery({ queryKey: keys.requests, queryFn: walletApi.requests, refetchInterval: LIVE_MS });

export const usePasskeys = () => useQuery({ queryKey: keys.passkeys, queryFn: walletApi.passkeys });

export const useSessions = () => useQuery({ queryKey: keys.sessions, queryFn: walletApi.sessions });

export const useNotificationSettings = () =>
  useQuery({ queryKey: keys.notifications, queryFn: walletApi.notificationSettings });

export const useInstitutions = (country: string) =>
  useQuery({ queryKey: keys.institutions(country), queryFn: () => walletApi.institutions(country), staleTime: 3_600_000 });
