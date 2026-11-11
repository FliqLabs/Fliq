"use client";

import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";

export type BusinessDraft = {
  legalName: string;
  registration: string;
  country: string;
  website: string;
  purpose: string;
  volume: string;
  corridors: string[];
};

export type KybDecision = {
  status: "not_started" | "in_review" | "approved";
  submittedAt?: string;
  approvedAt?: string;
  keepSandbox?: boolean;
};

export function businessIsComplete(draft: BusinessDraft) {
  return Boolean(
    draft.legalName.trim() &&
      draft.registration.trim() &&
      draft.country &&
      draft.website.trim() &&
      draft.purpose.trim() &&
      draft.volume &&
      draft.corridors.length,
  );
}

export function useKybFiles(userId: string) {
  const client = useQueryClient();
  const queryKey = ["kyb-files", userId];
  const query = useQuery<Record<number, File>>({
    queryKey,
    initialData: {},
    queryFn: skipToken,
    enabled: false,
    gcTime: Infinity,
  });
  return {
    files: query.data ?? {},
    setFiles: (update: Record<number, File> | ((current: Record<number, File>) => Record<number, File>)) =>
      client.setQueryData<Record<number, File>>(queryKey, (current) =>
        typeof update === "function" ? update(current ?? {}) : update,
      ),
  };
}

export function useKybDecision(userId: string) {
  const client = useQueryClient();
  const queryKey = ["kyb-decision", userId];
  const query = useQuery<KybDecision>({
    queryKey,
    initialData: { status: "not_started" },
    queryFn: skipToken,
    enabled: false,
    gcTime: Infinity,
  });
  return {
    decision: query.data ?? { status: "not_started" as const },
    setDecision: (decision: KybDecision) => client.setQueryData(queryKey, decision),
  };
}

export function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}
