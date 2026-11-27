import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";

type PlanarPoint = readonly [number, number];

export function edgesIntersect(a: PlanarPoint, b: PlanarPoint, c: PlanarPoint, d: PlanarPoint) {
  function turn([ox, oy]: PlanarPoint, [px, py]: PlanarPoint, [qx, qy]: PlanarPoint) {
    return (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  }
  function contains([x, y]: PlanarPoint, [u, v]: PlanarPoint, [w, z]: PlanarPoint) {
    return (
      x >= Math.min(u, w) &&
      x <= Math.max(u, w) &&
      y >= Math.min(v, z) &&
      y <= Math.max(v, z)
    );
  }

  const abC = turn(a, b, c);
  const abD = turn(a, b, d);
  const cdA = turn(c, d, a);
  const cdB = turn(c, d, b);
  return (
    (abC * abD < 0 && cdA * cdB < 0) ||
    (abC === 0 && contains(c, a, b)) ||
    (abD === 0 && contains(d, a, b)) ||
    (cdA === 0 && contains(a, c, d)) ||
    (cdB === 0 && contains(b, c, d))
  );
}

function insideRing([x, y]: PlanarPoint, ring: readonly PlanarPoint[]) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const [a, b] = ring[i - 1];
    const [c, d] = ring[i];
    if (b > y !== d > y && x < a + ((y - b) * (c - a)) / (d - b)) {
      inside = !inside;
    }
  }
  return inside;
}

export function ringCoversPoint(point: PlanarPoint, ring: readonly PlanarPoint[]) {
  return (
    insideRing(point, ring) ||
    ring.slice(1).some((end, index) =>
      edgesIntersect(point, point, ring[index], end),
    )
  );
}

export function footprintFitsSurface(
  footprint: Point[],
  surface: ShadeScene["surface"],
) {
  return surface.some(([outer, ...holes]) => {
    if (
      !footprint.every(
        (point) =>
          insideRing(point, outer) &&
          !holes.some((hole) => insideRing(point, hole)),
      )
    )
      return false;

    if (footprint.length === 1) return true;
    return (
      [outer, ...holes].every((ring) =>
        ring
          .slice(1)
          .every((end, index) =>
            footprint.every(
              (start, i) =>
                !edgesIntersect(
                  start,
                  footprint[(i + 1) % footprint.length],
                  ring[index],
                  end,
                ),
            ),
          ),
      ) &&
      !holes.some((hole) => insideRing(hole[0], [...footprint, footprint[0]]))
    );
  });
}
