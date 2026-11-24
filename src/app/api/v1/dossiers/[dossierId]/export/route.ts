import { createHash } from "node:crypto";
import { pilotSite } from "@/features/places/site-data";
import {
  communityErrorResponse,
  isUuid,
  notFoundResponse,
  unexpectedResponse,
} from "@/lib/http/community-route";
import { errorResponse, newRequestId } from "@/lib/http/mutation";
import {
  buildAssumptionsJson,
  buildCostCsv,
  buildDossierHtml,
  buildPreviewSvg,
  DOSSIER_HTML_STYLES,
} from "@/lib/format/dossier-export";
import { toFeatureCollection } from "@/lib/geo/export";
import { publicDossierSchema } from "@/lib/schemas/dossier";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

type RouteProps = { params: Promise<{ dossierId: string }> };

const FORMATS = {
  html: {
    contentType: "text/html; charset=utf-8",
    extension: "html",
    disposition: "inline",
  },
  geojson: {
    contentType: "application/geo+json; charset=utf-8",
    extension: "geojson",
    disposition: "attachment",
  },
  csv: {
    contentType: "text/csv; charset=utf-8; header=present",
    extension: "csv",
    disposition: "attachment",
  },
  json: {
    contentType: "application/json; charset=utf-8",
    extension: "json",
    disposition: "attachment",
  },
} as const;

type Format = keyof typeof FORMATS;

// The inline style of the HTML export is the only thing the document may load.
const STYLE_HASH = createHash("sha256")
  .update(DOSSIER_HTML_STYLES)
  .digest("base64");

/**
 * Exports are built from get_public_dossier, the same read the public page uses, so a
 * hidden publication or a missing dossier is a 404 for every format and no extra access
 * rule can drift. File names come from the site slug and the dossier id, never from
 * user text.
 */
export async function GET(request: Request, { params }: RouteProps) {
  const requestId = newRequestId();
  const { dossierId } = await params;
  if (!isUuid(dossierId))
    return notFoundResponse(requestId, "dossier_not_found");

  const url = new URL(request.url);
  const requested = url.searchParams.get("format") ?? "";
  if (!Object.hasOwn(FORMATS, requested)) {
    return errorResponse(
      400,
      "invalid_export_format",
      "Use format=html, geojson, csv, or json.",
      requestId,
    );
  }
  const format = requested as Format;
  const locale = url.searchParams.get("locale") === "en" ? "en" : "es";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_dossier", {
    p_dossier_id: dossierId,
  });
  if (error) return communityErrorResponse(error, requestId, "export_dossier");
  if (data === null) return notFoundResponse(requestId, "dossier_not_found");

  const parsed = publicDossierSchema.safeParse(data);
  if (!parsed.success) return unexpectedResponse(requestId, "export_dossier");
  const dossier = parsed.data;
  // Same rule as the page: only the pilot site has bundled geometry.
  if (dossier.siteId !== pilotSite.id)
    return notFoundResponse(requestId, "dossier_not_found");
  const generatedAt = new Date();

  let body: string;
  if (format === "csv") {
    body = buildCostCsv(dossier, generatedAt);
  } else if (format === "geojson") {
    body = `${JSON.stringify(toFeatureCollection(dossier, generatedAt), null, 2)}\n`;
  } else if (format === "json") {
    body = `${JSON.stringify(buildAssumptionsJson(dossier, generatedAt), null, 2)}\n`;
  } else {
    const copy = locale === "en" ? en : es;
    body = buildDossierHtml({
      dossier,
      locale,
      copy: copy.dossier,
      kinds: copy.editor.kinds,
      previewSvg: buildPreviewSvg(
        dossier,
        pilotSite.baseline.features[0].geometry,
        pilotSite.bounds,
        copy.dossier.proposalPreviewAria,
      ),
      siteName: pilotSite.name[locale],
      generatedAt,
    });
  }

  const spec = FORMATS[format];
  const headers: Record<string, string> = {
    "Content-Type": spec.contentType,
    "Content-Disposition": `${spec.disposition}; filename="${dossier.siteSlug}-${dossier.dossierId.slice(0, 8)}.${spec.extension}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (format === "html") {
    headers["Content-Security-Policy"] =
      `default-src 'none'; style-src 'sha256-${STYLE_HASH}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
    headers["Referrer-Policy"] = "no-referrer";
  }
  return new Response(body, { headers });
}
