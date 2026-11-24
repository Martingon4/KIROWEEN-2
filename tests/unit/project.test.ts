import { describe, expect, it } from "vitest";
import { projectPosition } from "@/lib/geo/project";

const bounds = [-100, 10, -90, 20] as const;

describe("projectPosition", () => {
  it("maps WGS84 bounds into the SVG viewport and inverts latitude", () => {
    expect(projectPosition([-100, 20], bounds)).toEqual([0, 0]);
    expect(projectPosition([-90, 10], bounds)).toEqual([1000, 700]);
    expect(projectPosition([-95, 15], bounds)).toEqual([500, 350]);
  });

  it("rejects a degenerate bounding box", () => {
    expect(() => projectPosition([-95, 15], [-90, 10, -100, 20])).toThrow(
      "Bounding box must have positive width and height",
    );
  });
});
