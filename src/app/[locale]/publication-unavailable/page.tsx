import { notFound } from "next/navigation";

/**
 * Static target of the Proxy rewrite for missing or hidden publications. It calls
 * notFound() while prerendering, so the stored result carries a real 404 status and
 * `not-found.tsx` in this segment renders the localized explanation.
 */
export default function PublicationUnavailablePage(): never {
  notFound();
}
