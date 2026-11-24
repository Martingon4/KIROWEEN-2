import { describe, expect, it } from "vitest";
import {
  formatCoordinates,
  parseCoordinates,
} from "@/features/editor/coordinates";
import type { InterventionGeometry } from "@/lib/schemas/intervention";

const point: InterventionGeometry = {
  type: "Point",
  coordinates: [-98.197, 19.0436],
};
const line: InterventionGeometry = {
  type: "LineString",
  coordinates: [
    [-98.1971, 19.0436],
    [-98.1969, 19.0437],
  ],
};
const polygon: InterventionGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-98.1971, 19.0436],
      [-98.1969, 19.0436],
      [-98.1969, 19.0438],
      [-98.1971, 19.0436],
    ],
  ],
};

describe("coordinates", () => {
  it.each([point, line, polygon])(
    "ida y vuelta format→parse para $type",
    (geometry) => {
      const result = parseCoordinates(
        formatCoordinates(geometry),
        geometry.type,
      );
      expect(result).toEqual({ ok: true, geometry });
    },
  );

  it("el texto de un polígono no repite el primer vértice", () => {
    expect(formatCoordinates(polygon).split("\n")).toHaveLength(3);
  });

  it("cierra solo un polígono abierto y respeta uno ya cerrado", () => {
    const open = parseCoordinates("0, 0\n0.001, 0\n0.001, 0.001", "Polygon");
    expect(open.ok).toBe(true);
    if (open.ok && open.geometry.type === "Polygon") {
      const ring = open.geometry.coordinates[0];
      expect(ring).toHaveLength(4);
      expect(ring[0]).toEqual(ring[3]);
    }
    const closed = parseCoordinates(
      "0, 0\n0.001, 0\n0.001, 0.001\n0, 0",
      "Polygon",
    );
    expect(
      closed.ok && closed.geometry.type === "Polygon"
        ? closed.geometry.coordinates[0]
        : null,
    ).toHaveLength(4);
  });

  it("acepta separadores coma, punto y coma y espacios, y redondea a 6 decimales", () => {
    const result = parseCoordinates("-98.12345678; 19.5", "Point");
    expect(result).toEqual({
      ok: true,
      geometry: { type: "Point", coordinates: [-98.123457, 19.5] },
    });
  });

  it.each([
    ["abc, def", "Point"],
    ["1, 2, 3", "Point"],
    ["1", "Point"],
    ["", "Point"],
  ] as const)(
    "formato inválido %j (%s) → reason 'format' o 'count'",
    (text, type) => {
      const result = parseCoordinates(text, type);
      expect(result.ok).toBe(false);
    },
  );

  it("formato inválido → reason 'format'", () => {
    expect(parseCoordinates("abc, def", "Point")).toEqual({
      ok: false,
      reason: "format",
    });
    expect(parseCoordinates("1, 2, 3", "Point")).toEqual({
      ok: false,
      reason: "format",
    });
    expect(parseCoordinates("1", "LineString")).toEqual({
      ok: false,
      reason: "format",
    });
  });

  it("pocos vértices → reason 'count'", () => {
    expect(parseCoordinates("0, 0", "LineString")).toEqual({
      ok: false,
      reason: "count",
    });
    expect(parseCoordinates("0, 0\n1, 1", "Polygon")).toEqual({
      ok: false,
      reason: "count",
    });
    expect(parseCoordinates("", "Point")).toEqual({
      ok: false,
      reason: "count",
    });
    expect(parseCoordinates("0, 0\n1, 1", "Point")).toEqual({
      ok: false,
      reason: "count",
    });
  });

  it("fuera de rango → reason 'format'", () => {
    expect(parseCoordinates("181, 0", "Point")).toEqual({
      ok: false,
      reason: "format",
    });
    expect(parseCoordinates("0, 91", "Point")).toEqual({
      ok: false,
      reason: "format",
    });
    expect(parseCoordinates("-181, 0", "Point")).toEqual({
      ok: false,
      reason: "format",
    });
  });
});
