import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getPublicSupabaseEnv } from "@/lib/schemas/env";
import {
  publicPublicationSchema,
  type PublicPublication,
} from "@/lib/schemas/publication";

export type PublicationLookup =
  | { status: "found"; publication: PublicPublication }
  | { status: "not_found" }
  | { status: "error" };

/**
 * Reads a publication as an anonymous visitor. No session cookie is used, so every
 * caller receives the same public projection, whoever is signed in.
 */
export async function getPublicPublication(
  id: string,
): Promise<PublicationLookup> {
  if (!z.uuid().safeParse(id).success) return { status: "not_found" };

  const env = getPublicSupabaseEnv();
  const supabase = createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await supabase.rpc("get_public_publication", {
    p_publication_id: id,
  });
  if (error) return { status: "error" };
  if (!data) return { status: "not_found" };

  const parsed = publicPublicationSchema.safeParse(data);
  return parsed.success
    ? { status: "found", publication: parsed.data }
    : { status: "error" };
}
