// @vitest-environment node

import { describe, expect, it } from "vitest";
import { GET as listSites } from "@/app/api/v1/sites/route";
import { GET as getSite } from "@/app/api/v1/sites/[slug]/route";
import {
  apiErrorEnvelopeSchema,
  publicSiteDetailEnvelopeSchema,
  publicSiteListEnvelopeSchema,
} from "@/lib/schemas/site";

describe("public sites API", () => {
  it("returns an allowlisted catalog projection", async () => {
    const response = await listSites();
    const body = publicSiteListEnvelopeSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].slug).toBe("zocalo-puebla");
    expect(JSON.stringify(body)).not.toContain("email");
    expect(JSON.stringify(body)).not.toContain("checksum");
  });

  it("returns the exact baseline and clearly marked scenario", async () => {
    const response = await getSite(
      new Request("http://localhost/api/v1/sites/zocalo-puebla"),
      {
        params: Promise.resolve({ slug: "zocalo-puebla" }),
      },
    );
    const body = publicSiteDetailEnvelopeSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.data.baseline.features[0].properties.status).toBe("reference");
    expect(
      body.data.scenario.features.every(
        ({ properties }) => properties.status === "hypothetical",
      ),
    ).toBe(true);
  });

  it("returns a stable, non-revealing 404 envelope", async () => {
    const response = await getSite(
      new Request("http://localhost/api/v1/sites/private-site"),
      {
        params: Promise.resolve({ slug: "private-site" }),
      },
    );
    const body = apiErrorEnvelopeSchema.parse(await response.json());

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.code).toBe("site_not_found");
  });
});
