import { describe, expect, it } from "vitest";
import { createDefaultIntervention } from "@/features/editor/defaults";
import { fromFormValues, toFormValues } from "@/features/editor/form-values";
import { editableKinds } from "@/lib/schemas/intervention";

const labels = { label: "Elemento", timeSlot: "Sábados 8–14 h" };
const center: [number, number] = [-98.197, 19.0436];
const id = "66666666-6666-4666-8666-666666666666";

describe("form-values", () => {
  it.each(editableKinds)(
    "toFormValues→fromFormValues devuelve la misma intervención (%s)",
    (kind) => {
      const feature = createDefaultIntervention(kind, id, center, labels);
      const result = fromFormValues(toFormValues(feature, "add"));
      expect(result).toEqual({ ok: true, feature });
    },
  );

  it("número fuera de rango → error 'number' en ese campo", () => {
    const feature = createDefaultIntervention(
      "shade_canopy",
      id,
      center,
      labels,
    );
    const result = fromFormValues({
      ...toFormValues(feature, "add"),
      heightM: "9",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual({ heightM: "number" });
  });

  it("número vacío o no numérico → error 'number'", () => {
    const feature = createDefaultIntervention(
      "proposed_crossing",
      id,
      center,
      labels,
    );
    for (const widthM of ["", "abc", "1.9", "10.1"]) {
      const result = fromFormValues({
        ...toFormValues(feature, "add"),
        widthM,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.widthM).toBe("number");
    }
  });

  it("acepta coma decimal", () => {
    const feature = createDefaultIntervention(
      "shade_canopy",
      id,
      center,
      labels,
    );
    const result = fromFormValues({
      ...toFormValues(feature, "add"),
      heightM: "4,5",
    });
    expect(result.ok).toBe(true);
  });

  it("stallCount no entero → error en stallCount", () => {
    const feature = createDefaultIntervention(
      "temporary_market",
      id,
      center,
      labels,
    );
    const result = fromFormValues({
      ...toFormValues(feature, "add"),
      stallCount: "12.5",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.stallCount).toBe("number");
  });

  it("etiqueta vacía → error 'label'", () => {
    const feature = createDefaultIntervention("shade_tree", id, center, labels);
    for (const label of ["", "   "]) {
      const result = fromFormValues({ ...toFormValues(feature, "add"), label });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toEqual({ label: "label" });
    }
  });

  it("franja horaria vacía → error 'timeSlot'", () => {
    const feature = createDefaultIntervention(
      "temporary_market",
      id,
      center,
      labels,
    );
    const result = fromFormValues({
      ...toFormValues(feature, "add"),
      timeSlot: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.timeSlot).toBe("timeSlot");
  });

  it("coordenadas inválidas → error en coordinates", () => {
    const feature = createDefaultIntervention("shade_tree", id, center, labels);
    const result = fromFormValues({
      ...toFormValues(feature, "add"),
      coordinates: "x, y",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.coordinates).toBe("format");
  });
});
