import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { MergeWorkbench } from "@/features/compare/merge-workbench";
import { pilotSite } from "@/features/places/site-data";
import { isLocale } from "@/lib/i18n/locales";
import { mapMergeError } from "@/lib/http/database-errors";
import { mergePreviewSchema } from "@/lib/schemas/merge";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type MergePageProps = {
  params: Promise<{ locale: string; branchId: string }>;
  searchParams: Promise<{ source?: string }>;
};

async function MergeContent({ params, searchParams }: MergePageProps) {
  await connection();
  const { locale, branchId } = await params;
  if (!isLocale(locale)) notFound();
  const { source } = await searchParams;
  const copy = messages[locale];
  const m = copy.merge;

  const returnTo = `/${locale}/branches/${branchId}/merge?source=${encodeURIComponent(source ?? "")}`;
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    redirect(
      `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }
  if (!z.uuid().safeParse(branchId).success) notFound();

  const header = (
    <>
      <a className="skip-link" href="#merge-main">
        {copy.nav.skip}
      </a>
      <header className="branches-header">
        <Link className="brand" href={`/${locale}/branches/${branchId}`}>
          <span aria-hidden="true">←</span> {m.back}
        </Link>
        <div className="header-actions">
          <span>{m.privateLabel}</span>
        </div>
      </header>
    </>
  );

  const failure = (text: string) => (
    <>
      {header}
      <main className="editor-page" id="merge-main">
        <h1>{m.title}</h1>
        <p className="editor-status editor-status-error" role="alert">
          {text}
        </p>
      </main>
    </>
  );

  if (!z.uuid().safeParse(source).success) {
    return failure(m.publicationUnavailable);
  }

  const { data: head, error: headError } = await supabase.rpc(
    "get_branch_head",
    {
      p_branch_id: branchId,
    },
  );
  if (headError) throw new Error("The branch head could not be loaded.");
  if (!head) notFound();
  const branchTitle = String((head as { title?: unknown }).title ?? "");

  const { data, error } = await supabase.rpc("merge_preview", {
    p_branch_id: branchId,
    p_source_publication_id: source,
    p_resolutions: [],
  });

  if (error) {
    const mapped = mapMergeError(error);
    if (!mapped) throw new Error("The merge could not be previewed.");
    if (mapped.code === "branch_not_found") notFound();
    if (mapped.code === "publication_not_found")
      return failure(m.publicationUnavailable);
    return failure(
      m.errors[mapped.code as keyof typeof m.errors] ?? m.errors.generic,
    );
  }

  const preview = mergePreviewSchema.parse(data);

  return (
    <>
      {header}
      <main className="editor-page" id="merge-main">
        <div className="editor-heading">
          <p className="eyebrow">{pilotSite.name[locale]}</p>
          <h1>{m.title}</h1>
        </div>
        <MergeWorkbench
          locale={locale}
          messages={m}
          kinds={copy.editor.kinds}
          branchId={branchId}
          branchTitle={branchTitle}
          initialPreview={preview}
          bounds={pilotSite.bounds}
          boundary={pilotSite.baseline.features[0].geometry}
        />
      </main>
    </>
  );
}

export default function MergePage(props: MergePageProps) {
  return (
    <Suspense fallback={<main className="editor-page" aria-busy="true" />}>
      <MergeContent {...props} />
    </Suspense>
  );
}
