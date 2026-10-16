import { infiniteQueryOptions, queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import * as api from "@/api/client";
import type { ListParams } from "@/api/types";
import { roleIn } from "./workflow";
import { useCurrentUserId } from "./session";

export const directoryQuery = queryOptions({
  queryKey: ["directory"],
  queryFn: api.getDirectory,
  staleTime: Infinity,
});

export const attentionQuery = (userId: string) =>
  queryOptions({ queryKey: ["attention", userId], queryFn: () => api.getAttention(userId) });

export const itemsQuery = (params: Omit<ListParams, "cursor">) =>
  infiniteQueryOptions({
    queryKey: ["items", params],
    queryFn: ({ pageParam }) => api.listItems({ ...params, cursor: pageParam, limit: 25 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

export const itemQuery = (key: string) =>
  queryOptions({ queryKey: ["item", key.toUpperCase()], queryFn: () => api.getItem(key) });

export const timelineQuery = (id: string) =>
  queryOptions({ queryKey: ["timeline", id], queryFn: () => api.getTimeline(id) });

export function useDirectory() {
  return useSuspenseQuery(directoryQuery).data;
}

export function useMe() {
  const id = useCurrentUserId();
  const dir = useDirectory();
  const user = dir.users.find((u) => u.id === id) ?? dir.users[0];
  return {
    user,
    roleFor: (teamId: string) => roleIn(dir.memberships, user.id, teamId),
  };
}
