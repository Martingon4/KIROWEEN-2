import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { EditorLoader } from "@/features/editor/editor-loader";
import { SignOutButton } from "@/features/editor/sign-out-button";
import { pilotSite } from "@/features/places/site-data";
import { isLocale } from "@/lib/i18n/locales";
import { branchHeadSchema } from "@/lib/schemas/intervention";
import { hiddenMineSchema } from "@/lib/schemas/community";
import { ownerPublicationsSchema } from "@/lib/schemas/publication";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type EditorPageProps = {
  params: Promise<{ locale: string; branchId: string }>;
};

async function EditorContent({ params }: EditorPageProps) {
  await connection();
  const { locale, branchId } = await params;
  if (!isLocale(locale)) notFound();

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    redirect(
      `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(`/${locale}/branches/${branchId}`)}`,
    );
  }
  if (!z.uuid().safeParse(branchId).success) notFound();

  const { data, error } = await supabase.rpc("get_branch_head", {
    p_branch_id: branchId,
  });
  if (error) throw new Error("The branch head could not be loaded.");
  if (!data) notFound();

  const head = branchHeadSchema.parse(data);
  if (head.siteId !== pilotSite.id) notFound();

  // RLS limits this to publications of the signed-in owner's own branches.
  const { data: publicationRows, error: publicationsError } = await supabase
    .from("publications")
    .select("id, revision_id, public_label, published_at, moderation_state")
    .eq("branch_id", head.branchId)
    .order("published_at", { ascending: false });
  if (publicationsError)
    throw new Error("The publications could not be loaded.");
  const ownerPublications = ownerPublicationsSchema.parse(
    publicationRows ?? [],
  );

  // The public page answers 404 for hidden content, so the author reads the public
  // moderation reason here. Failure only drops the reason; the list still renders.
  const hiddenReasons = new Map<string, string>();
  if (ownerPublications.some((publication) => publication.hidden)) {
    const { data: hiddenRows } = await supabase.rpc(
      "list_my_hidden_publications",
    );
    const parsedHidden = hiddenMineSchema.safeParse(hiddenRows);
    if (parsedHidden.success) {
      for (const item of parsedHidden.data.items) {
        hiddenReasons.set(item.publicationId, item.reason);
      }
    }
  }
  const publications = ownerPublications.map((publication) => ({
    ...publication,
    hiddenReason: hiddenReasons.get(publication.id) ?? null,
  }));

  const copy = messages[locale];
  const [west, south, east, north] = pilotSite.bounds;
  const boundary = pilotSite.baseline.features[0].geometry;

  return (
    <>
      <a className="skip-link" href="#editor-main">
        {copy.nav.skip}
      </a>
      <header className="branches-header">
        <Link className="brand" href={`/${locale}/branches`}>
          <span aria-hidden="true">←</span> {copy.editor.back}
        </Link>
        <div className="header-actions">
          <span>{copy.editor.privateLabel}</span>
          <SignOutButton
            label={copy.branches.signOut}
            locale={locale}
            userId={claims.claims.sub}
          />
        </div>
      </header>
      <main className="editor-page" id="editor-main">
        <div className="editor-heading">
          <p className="eyebrow">{pilotSite.name[locale]}</p>
          <h1>{head.title}</h1>
          {head.sourcePublicationId ? (
            <p className="field-help">
              {head.sourceVisible ? (
                <>
                  {copy.editor.forkedFrom}{" "}
                  <Link
                    href={`/${locale}/publications/${head.sourcePublicationId}`}
                  >
                    {copy.editor.viewSource}
                  </Link>
                </>
              ) : (
                copy.editor.sourceUnavailable
              )}
            </p>
          ) : null}
          {head.mergeSourcePublicationId ? (
            <p className="field-help">
              {head.mergeSourceVisible ? (
                <>
                  {copy.merge.mergedFrom}{" "}
                  <Link
                    href={`/${locale}/publications/${head.mergeSourcePublicationId}`}
                  >
                    {copy.publication.viewSourcePublication}
                  </Link>
                </>
              ) : (
                copy.merge.mergedSourceUnavailable
              )}
            </p>
          ) : null}
        </div>
        <EditorLoader
          locale={locale}
          messages={copy.editor}
          head={head}
          publications={publications}
          userId={claims.claims.sub}
          bounds={pilotSite.bounds}
          boundary={boundary}
          center={[(west + east) / 2, (south + north) / 2]}
        />
      </main>
    </>
  );
}

export default function BranchEditorPage(props: EditorPageProps) {
  return (
    <Suspense fallback={<main className="editor-page" aria-busy="true" />}>
      <EditorContent {...props} />
    </Suspense>
  );
}
