import type { Intervention } from "@/lib/schemas/intervention";
import { terrainObjects } from "@/lib/schemas/terrain-objects";

export type SummaryTemplates = Record<Intervention["kind"], string>;

export function fillTemplate(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** One-line, plain-text description of an intervention's modelled values. */
export function describeIntervention(
  feature: Intervention,
  templates: SummaryTemplates,
  number: Intl.NumberFormat,
): string {
  switch (feature.kind) {
    case "shade_tree":
      return fillTemplate(templates.shade_tree, {
        canopy: number.format(feature.properties.canopyDiameterM),
        height: number.format(feature.properties.heightM),
      });
    case "shade_canopy":
      return fillTemplate(templates.shade_canopy, {
        height: number.format(feature.properties.heightM),
      });
    case "temporary_market":
      return fillTemplate(templates.temporary_market, {
        stalls: feature.properties.stallCount,
        module: number.format(feature.properties.moduleM2),
        timeSlot: feature.properties.timeSlot,
      });
    case "proposed_crossing":
      return fillTemplate(templates.proposed_crossing, {
        width: number.format(feature.properties.widthM),
      });
    case "urban_object": {
      const { width, depth } = terrainObjects[feature.properties.objectType];
      return fillTemplate(templates.urban_object, {
        width: number.format(width),
        depth: number.format(depth),
        height: number.format(feature.properties.heightM),
      });
    }
  }
}
