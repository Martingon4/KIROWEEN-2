import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { projectPosition, unprojectPosition } from "@/lib/geo/project";
const bounds = [-98.1989, 19.043, -98.1973, 19.0443] as const;
describe("unprojectPosition", () => {
  it("devuelve las esquinas y el centro del recuadro", () => {
    expect(unprojectPosition([0, 0], bounds)).toEqual([-98.1989, 19.0443]);
    const [east, south] = unprojectPosition([1000, 700], bounds);
    expect(east).toBeCloseTo(-98.1973, 10);
    expect(south).toBeCloseTo(19.043, 10);
    const [lon, lat] = unprojectPosition([500, 350], bounds);
    expect(lon).toBeCloseTo(-98.1981, 10);
    expect(lat).toBeCloseTo(19.04365, 10);
  });
  it("es la inversa de projectPosition (ida y vuelta)", () => {
    const [x, y] = projectPosition([-98.198, 19.0436], bounds);
    const [lon, lat] = unprojectPosition([x, y], bounds);
    expect(lon).toBeCloseTo(-98.198, 9);
    expect(lat).toBeCloseTo(19.0436, 9);
  });
  it("respeta un ancho y alto distintos", () => {
    const [x, y] = projectPosition([-98.198, 19.0436], bounds, 400, 300);
    const [lon, lat] = unprojectPosition([x, y], bounds, 400, 300);
    expect(lon).toBeCloseTo(-98.198, 9);
    expect(lat).toBeCloseTo(19.0436, 9);
  });
  it("propiedad: project→unproject y unproject→project conservan el punto", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (u, v) => {
          const lon = bounds[0] + u * (bounds[2] - bounds[0]);
          const lat = bounds[1] + v * (bounds[3] - bounds[1]);
          const back = unprojectPosition(
            projectPosition([lon, lat], bounds),
            bounds,
          );
          expect(Math.abs(back[0] - lon)).toBeLessThan(1e-9);
          expect(Math.abs(back[1] - lat)).toBeLessThan(1e-9);
          const x = u * 1000;
          const y = v * 700;
          const again = projectPosition(
            unprojectPosition([x, y], bounds),
            bounds,
          );
          expect(Math.abs(again[0] - x)).toBeLessThan(1e-6);
          expect(Math.abs(again[1] - y)).toBeLessThan(1e-6);
        },
      ),
    );
  });
});
