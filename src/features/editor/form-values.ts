import {
  formatCoordinates,
  parseCoordinates,
} from "@/features/editor/coordinates";
import { geometryTypeForKind } from "@/features/editor/defaults";
import {
  interventionSchema,
  type EditableKind,
  type Intervention,
} from "@/lib/schemas/intervention";

/** Every input is kept as text so partially typed values survive re-renders. */
export type FormValues = {
  mode: "add" | "edit";
  id: string;
  kind: EditableKind;
  label: string;
  heightM: string;
  canopyDiameterM: string;
  stallCount: string;
  moduleM2: string;
  timeSlot: string;
  widthM: string;
  coordinates: string;
};

export type FormField = Exclude<keyof FormValues, "mode" | "id" | "kind">;
export type FieldErrorKey =
  "label" | "number" | "timeSlot" | "format" | "count";
export type FieldErrors = Partial<Record<FormField, FieldErrorKey>>;

export type NumericField =
  "heightM" | "canopyDiameterM" | "stallCount" | "moduleM2" | "widthM";

/** Ranges mirror `public.feature_properties_are_valid`. */
export const numericFields: Record<
  EditableKind,
  { field: NumericField; min: number; max: number; integer?: boolean }[]
> = {
  shade_tree: [
    { field: "canopyDiameterM", min: 1, max: 30 },
    { field: "heightM", min: 2, max: 30 },
  ],
  shade_canopy: [{ field: "heightM", min: 2.5, max: 8 }],
  temporary_market: [
    { field: "stallCount", min: 1, max: 200, integer: true },
    { field: "moduleM2", min: 1, max: 20 },
  ],
  proposed_crossing: [{ field: "widthM", min: 2, max: 10 }],
};

export function toFormValues(
  feature: Intervention,
  mode: FormValues["mode"],
): FormValues {
  const values: FormValues = {
    mode,
    id: feature.id,
    kind: feature.kind,
    label: feature.properties.label,
    heightM: "",
    canopyDiameterM: "",
    stallCount: "",
    moduleM2: "",
    timeSlot: "",
    widthM: "",
    coordinates: formatCoordinates(feature.geometry),
  };

  switch (feature.kind) {
    case "shade_tree":
      return {
        ...values,
        canopyDiameterM: String(feature.properties.canopyDiameterM),
        heightM: String(feature.properties.heightM),
      };
    case "shade_canopy":
      return { ...values, heightM: String(feature.properties.heightM) };
    case "temporary_market":
      return {
        ...values,
        stallCount: String(feature.properties.stallCount),
        moduleM2: String(feature.properties.moduleM2),
        timeSlot: feature.properties.timeSlot,
      };
    case "proposed_crossing":
      return { ...values, widthM: String(feature.properties.widthM) };
  }
}

function toNumber(text: string) {
  const normalized = text.trim().replace(",", ".");
  return normalized === "" ? Number.NaN : Number(normalized);
}

export type FormResult =
  { ok: true; feature: Intervention } | { ok: false; errors: FieldErrors };

/** Validates the form with the same schema the API uses and reports errors per field. */
export function fromFormValues(values: FormValues): FormResult {
  const errors: FieldErrors = {};
  const geometry = parseCoordinates(
    values.coordinates,
    geometryTypeForKind[values.kind],
  );
  if (!geometry.ok) errors.coordinates = geometry.reason;

  const properties: Record<string, unknown> = { label: values.label };
  for (const { field, min, max, integer } of numericFields[values.kind]) {
    const value = toNumber(values[field]);
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    ) {
      errors[field] = "number";
    }
    properties[field] = value;
  }
  if (values.kind === "temporary_market") properties.timeSlot = values.timeSlot;

  const parsed = interventionSchema.safeParse({
    id: values.id,
    kind: values.kind,
    properties,
    geometry: geometry.ok ? geometry.geometry : null,
  });

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [section, field] = issue.path.map(String);
      if (section === "properties" && field === "label") errors.label = "label";
      else if (section === "properties" && field === "timeSlot")
        errors.timeSlot = "timeSlot";
      else if (section === "geometry" && !errors.coordinates)
        errors.coordinates = "format";
    }
  }

  if (Object.keys(errors).length > 0 || !parsed.success) {
    return {
      ok: false,
      errors: Object.keys(errors).length > 0 ? errors : { label: "label" },
    };
  }
  return { ok: true, feature: parsed.data };
}
