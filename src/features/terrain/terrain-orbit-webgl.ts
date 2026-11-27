import * as THREE from "three";
import type { ShadeSolar } from "@/features/compare/shade-geometry";
import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";
import {
  terrainDimensions,
  type TerrainObjectKind,
} from "@/lib/schemas/terrain-objects";
import {
  disposePhotoObjects,
  groundShadows,
  photoLighting,
  structure,
  terrainModelLoader,
} from "./terrain-photo-render";
import type { Face } from "./terrain-perspective-model";
import {
  sceneFaces,
  terrainCamera,
  type TerrainFraming,
} from "./terrain-perspective-render";
import { reliefCoordinates, type PhotoRelief } from "./terrain-relief";

const files = {
  shade_tree: "aspen-v1-lod1.glb",
  bench: "park-bench-v1-lod1.glb",
  planter: "concrete-planter-v1-lod1.glb",
  stall: "bakers-awning-stall-v1-lod1.glb",
};

export type ModelPlacement = {
  kind: TerrainObjectKind | "shade_tree";
  point: Point;
  width: number;
  depth: number;
  height: number;
};

export async function createTerrainOrbit(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    stencil: true,
  });
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const loader = terrainModelLoader(renderer);
  const camera = new THREE.PerspectiveCamera(
    THREE.MathUtils.radToDeg(2 * Math.atan(0.5 / 0.98)),
    canvas.width / canvas.height,
    0.05,
    8000,
  );
  const world = new THREE.Scene();
  world.background = new THREE.Color("#dce8ed");
  const models = new Map<
    ModelPlacement["kind"],
    {
      source: THREE.Group;
      base: THREE.Vector3;
      size: THREE.Vector3;
    }
  >();
  const reusable = new Set<THREE.Material>();
  try {
    await Promise.all(
      Object.entries(files).map(async ([kind, file]) => {
        try {
          const { scene: source } = await loader.load(file);
          const bounds = new THREE.Box3().setFromObject(source);
          const size = bounds.getSize(new THREE.Vector3());
          if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
            disposePhotoObjects(source, true);
            return;
          }
          const base = bounds.getCenter(new THREE.Vector3());
          base.y = bounds.min.y;
          models.set(kind as keyof typeof files, { source, size, base });
          source.traverse((node) => {
            if (!(node instanceof THREE.Mesh)) return;
            const materials = Array.isArray(node.material)
              ? node.material
              : [node.material];
            materials.forEach((material: THREE.Material) =>
              reusable.add(material),
            );
          });
        } catch {
          // A missing model keeps the schematic geometry for that intervention.
        }
      }),
    );
  } finally {
    loader.dispose();
  }

  function place(placement: ModelPlacement, ground: (point: Point) => number) {
    const model = models.get(placement.kind);
    if (!model) return;
    const centered = new THREE.Group();
    centered.position.copy(model.base).negate();
    centered.add(model.source.clone(true));
    const anchor = new THREE.Group();
    anchor.position.set(
      placement.point[0],
      ground(placement.point),
      -placement.point[1],
    );
    anchor.scale.set(
      placement.width / model.size.x,
      placement.height / model.size.y,
      placement.depth / model.size.z,
    );
    anchor.add(centered);
    world.add(anchor);
  }

  function clear() {
    disposePhotoObjects(world, false, reusable);
    world.clear();
  }

  function modelPlacements(scene: ShadeScene, placements: ModelPlacement[]) {
    const all = [...placements];
    for (const element of scene.elements) {
      if (element.kind === "shade_canopy") continue;
      const dimensions =
        element.kind === "shade_tree"
          ? { width: element.canopyDiameterM, depth: element.canopyDiameterM }
          : terrainDimensions(element.kind, element.dimensionsM);
      all.push({
        kind: element.kind,
        point: element.coordinates,
        height: element.heightM,
        ...dimensions,
      });
    }
    return all;
  }

  return {
    hasModel: (kind: ModelPlacement["kind"]) => models.has(kind),
    prepare(
      scene: ShadeScene,
      solar: ShadeSolar | null,
      relief: PhotoRelief | undefined,
      additionalFaces: Face[],
      placements: ModelPlacement[],
    ) {
      clear();
      world.add(photoLighting(solar));
      const ground = relief
        ? reliefCoordinates(scene.surface, relief).elevation
        : () => 0;
      const floor = new THREE.MeshBasicMaterial({
        color: "#d3c9af",
        stencilWrite: true,
        stencilRef: 1,
        stencilZPass: THREE.ReplaceStencilOp,
      });
      for (const [ring, ...holes] of scene.surface) {
        const path = (points: Point[]) =>
          points.map(([x, y]) => new THREE.Vector2(x, y));
        const shape = new THREE.Shape(path(ring));
        shape.holes = holes.map((hole) => new THREE.Path(path(hole)));
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), floor);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = -0.015;
        mesh.renderOrder = -1;
        world.add(mesh);
      }
      const procedural = scene.elements.filter(
        ({ kind }) => kind === "shade_canopy" || !models.has(kind),
      );
      world.add(
        structure(
          sceneFaces(scene, relief, solar, procedural).concat(additionalFaces),
          { color: null, normal: null },
        ),
      );
      if (solar && !relief) {
        const shadows = groundShadows(scene.elements, solar);
        for (const mesh of shadows.children as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshBasicMaterial
        >[]) {
          mesh.material.stencilWrite = true;
          mesh.material.stencilRef = 1;
          mesh.material.stencilFunc = THREE.EqualStencilFunc;
        }
        world.add(shadows);
      }
      for (const placement of modelPlacements(scene, placements))
        place(placement, ground);
    },
    render(
      scene: ShadeScene,
      angle: number,
      elevation: number,
      zoom: number,
      relief: boolean,
      framing?: TerrainFraming,
    ) {
      const view = terrainCamera(scene, angle, elevation, relief, framing);
      camera.position.set(
        view.centerX + view.distance * view.east,
        view.eye,
        -view.centerY - view.distance * view.north,
      );
      camera.lookAt(view.centerX, view.target, -view.centerY);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      renderer.render(world, camera);
    },
    dispose() {
      clear();
      models.forEach(({ source }) => disposePhotoObjects(source, true));
      renderer.dispose();
    },
  };
}

export type TerrainOrbit = Awaited<ReturnType<typeof createTerrainOrbit>>;
