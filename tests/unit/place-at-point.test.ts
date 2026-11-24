import { describe, expect, it } from "vitest";
import { parseCoordinates, placeAtPoint } from "@/features/editor/coordinates";
const lon = -98.1981;
const lat = 19.0437;
function vertices(text: string) {
  return text.split("\n").map((line) => line.split(",").map(Number));
}
function center(points: number[][]) {
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    (Math.min(...lons) + Math.max(...lons)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}
describe("placeAtPoint", () => {
  it("un Point se reemplaza, con o sin texto previo", () => {
    expect(placeAtPoint("1, 2", "Point", lon, lat)).toBe(`${lon}, ${lat}`);
    expect(placeAtPoint("basura", "Point", lon, lat)).toBe(`${lon}, ${lat}`);
  });
  it("redondea las coordenadas recogidas", () => {
    const text = placeAtPoint("", "Point", -98.19812345678, 19.04371234567);
    const [x, y] = vertices(text)[0];
    expect(x).toBeCloseTo(-98.19812345678, 6);
    expect(y).toBeCloseTo(19.04371234567, 6);
    expect(String(x).split(".")[1].length).toBeLessThanOrEqual(7);
  });
  it("un Polygon válido se traslada: el centro del bbox queda en el punto y conserva la forma", () => {
    const original = "-98.1990, 19.0430\n-98.1988, 19.0430\n-98.1989, 19.0433";
    const text = placeAtPoint(original, "Polygon", lon, lat);
    const moved = vertices(text);
    const before = vertices(original);
    expect(moved).toHaveLength(3);
    const [cx, cy] = center(moved);
    expect(cx).toBeCloseTo(lon, 6);
    expect(cy).toBeCloseTo(lat, 6);
    for (let i = 1; i < 3; i++) {
      expect(moved[i][0] - moved[0][0]).toBeCloseTo(
        before[i][0] - before[0][0],
        6,
      );
      expect(moved[i][1] - moved[0][1]).toBeCloseTo(
        before[i][1] - before[0][1],
        6,
      );
    }
  });
  it("un Polygon cerrado se traslada sin repetir el vértice final", () => {
    const closed = "0, 0\n0.001, 0\n0.001, 0.001\n0, 0";
    expect(placeAtPoint(closed, "Polygon", lon, lat).split("\n")).toHaveLength(
      3,
    );
  });
  it("un LineString válido se traslada", () => {
    const text = placeAtPoint(
      "-98.1990, 19.0430\n-98.1986, 19.0432",
      "LineString",
      lon,
      lat,
    );
    const moved = vertices(text);
    expect(moved).toHaveLength(2);
    const [cx, cy] = center(moved);
    expect(cx).toBeCloseTo(lon, 6);
    expect(cy).toBeCloseTo(lat, 6);
    expect(moved[1][0] - moved[0][0]).toBeCloseTo(0.0004, 6);
  });
  it.each(["", "no es texto", "1, 2, 3", "1, 2"])(
    "con texto inválido (%j) dibuja un cuadrado para Polygon",
    (bad) => {
      const text = placeAtPoint(bad, "Polygon", lon, lat);
      const square = vertices(text);
      expect(square).toHaveLength(4);
      const [cx, cy] = center(square);
      expect(cx).toBeCloseTo(lon, 6);
      expect(cy).toBeCloseTo(lat, 6);
      const width =
        Math.max(...square.map((p) => p[0])) -
        Math.min(...square.map((p) => p[0]));
      expect(width).toBeCloseTo(0.0001, 6);
    },
  );
  it("con texto inválido dibuja una línea corta horizontal para LineString", () => {
    const line = vertices(placeAtPoint("x", "LineString", lon, lat));
    expect(line).toHaveLength(2);
    expect(line[0][1]).toBeCloseTo(lat, 6);
    expect(line[1][1]).toBeCloseTo(lat, 6);
    expect(line[1][0] - line[0][0]).toBeCloseTo(0.0001, 6);
    expect(center(line)[0]).toBeCloseTo(lon, 6);
  });
  it("el resultado parsea con parseCoordinates en cada tipo", () => {
    const valid = {
      Point: "1, 2",
      LineString: "-98.1990, 19.0430\n-98.1986, 19.0432",
      Polygon: "0, 0\n0.001, 0\n0.001, 0.001",
    } as const;
    for (const type of ["Point", "LineString", "Polygon"] as const) {
      for (const source of [valid[type], "inválido"]) {
        const parsed = parseCoordinates(
          placeAtPoint(source, type, lon, lat),
          type,
        );
        expect(parsed.ok).toBe(true);
      }
    }
  });
  it("el polígono resultante queda cerrado", () => {
    for (const source of ["inválido", "0, 0\n0.001, 0\n0.001, 0.001"]) {
      const parsed = parseCoordinates(
        placeAtPoint(source, "Polygon", lon, lat),
        "Polygon",
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok && parsed.geometry.type === "Polygon") {
        const ring = parsed.geometry.coordinates[0];
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring.at(-1));
      }
    }
  });
});
