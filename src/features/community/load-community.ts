import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commentPageSchema,
  communitySummarySchema,
  decodeCursor,
  encodeCursor,
  moderationNoticesSchema,
  type PublicComment,
} from "@/lib/schemas/community";

export type CommunityData = {
  supportCount: number;
  commentCount: number;
  comments: PublicComment[];
  nextCursor: string | null;
  signedIn: boolean;
  supported: boolean;
  notices: {
    commentId: string;
    body: string;
    state: "hidden" | "retracted";
    reason: string | null;
  }[];
};

const PAGE_SIZE = 20;

/**
 * Reads the community state of one visible publication with the viewer's session.
 * Counts and comments come from the same public RPCs anonymous visitors use; only
 * `supported` and `notices` are private to the signed-in account.
 */
export async function loadCommunity(
  supabase: SupabaseClient,
  publicationId: string,
  rawCursor: string | null,
  signedIn: boolean,
): Promise<CommunityData | null> {
  const cursor = decodeCursor(rawCursor);
  const safeCursor = cursor === "invalid" ? null : cursor;

  const [summaryResult, pageResult] = await Promise.all([
    supabase.rpc("get_public_community_summary", {
      p_publication_id: publicationId,
    }),
    supabase.rpc("list_public_comments", {
      p_publication_id: publicationId,
      p_after_created_at: safeCursor?.createdAt ?? null,
      p_after_id: safeCursor?.id ?? null,
      p_limit: PAGE_SIZE,
    }),
  ]);
  if (summaryResult.error || pageResult.error) return null;

  const summary = communitySummarySchema.safeParse(summaryResult.data);
  const page = commentPageSchema.safeParse(pageResult.data);
  if (!summary.success || !page.success) return null;

  let supported = false;
  let notices: CommunityData["notices"] = [];
  if (signedIn) {
    const [mine, noticeResult] = await Promise.all([
      supabase.rpc("my_support_state", { p_publication_id: publicationId }),
      supabase.rpc("list_my_moderation_notices", {
        p_publication_id: publicationId,
      }),
    ]);
    supported = mine.data === true;
    const parsed = moderationNoticesSchema.safeParse(noticeResult.data);
    if (parsed.success) notices = parsed.data.items;
  }

  return {
    supportCount: summary.data.supportCount,
    commentCount: summary.data.commentCount,
    comments: page.data.items,
    nextCursor: page.data.nextCursor
      ? encodeCursor(page.data.nextCursor)
      : null,
    signedIn,
    supported,
    notices,
  };
}
