import { describe, expect, it } from "vitest";
import {
  describeIntervention,
  fillTemplate,
  type SummaryTemplates,
} from "@/features/editor/describe";
import type { Intervention } from "@/lib/schemas/intervention";

const ID = "44444444-4444-4444-8444-444444444444";
const number = new Intl.NumberFormat("es", { maximumFractionDigits: 2 });
const templates: SummaryTemplates = {
  urban_object: "{width} × {depth} · altura {height}",
  shade_tree: "Copa {canopy} · altura {height}",
  shade_canopy: "Altura {height}",
  temporary_market: "{stalls} puestos de {module} · {timeSlot}",
  proposed_crossing: "Ancho {width}",
};
const ring: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 0],
];

describe("fillTemplate", () => {
  it("reemplaza marcadores y números", () => {
    expect(fillTemplate("{a} y {b}", { a: "uno", b: 2 })).toBe("uno y 2");
  });

  it("conserva marcadores desconocidos", () => {
    expect(fillTemplate("{a} {x}", { a: 1 })).toBe("1 {x}");
  });

  it("reemplaza un marcador repetido y acepta el valor 0", () => {
    expect(fillTemplate("{a}-{a}", { a: 0 })).toBe("0-0");
  });

  it("no interpreta valores como plantillas", () => {
    expect(fillTemplate("{a}", { a: "{b}", b: "x" })).toBe("{b}");
  });
});

describe("describeIntervention", () => {
  it("shade_tree", () => {
    const f: Intervention = {
      id: ID,
      kind: "shade_tree",
      properties: { label: "Árbol", canopyDiameterM: 6.5, heightM: 8 },
      geometry: { type: "Point", coordinates: [0, 0] },
    };
    expect(describeIntervention(f, templates, number)).toBe(
      "Copa 6,5 · altura 8",
    );
  });

  it("shade_canopy", () => {
    const f: Intervention = {
      id: ID,
      kind: "shade_canopy",
      properties: { label: "Cubierta", heightM: 3.25 },
      geometry: { type: "Polygon", coordinates: [ring] },
    };
    expect(describeIntervention(f, templates, number)).toBe("Altura 3,25");
  });

  it("temporary_market", () => {
    const f: Intervention = {
      id: ID,
      kind: "temporary_market",
      properties: {
        label: "Mercado",
        stallCount: 12,
        moduleM2: 4.5,
        timeSlot: "sábados",
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    };
    expect(describeIntervention(f, templates, number)).toBe(
      "12 puestos de 4,5 · sábados",
    );
  });

  it("proposed_crossing", () => {
    const f: Intervention = {
      id: ID,
      kind: "proposed_crossing",
      properties: { label: "Cruce", widthM: 4 },
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    };
    expect(describeIntervention(f, templates, number)).toBe("Ancho 4");
  });
});
