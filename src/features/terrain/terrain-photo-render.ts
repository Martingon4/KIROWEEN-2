import * as THREE from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  projectShadow,
  shadeRings,
  type ShadeSolar,
} from "@/features/compare/shade-geometry";
import type { ShadeScene } from "@/lib/schemas/shade-scene";
import { objectFaces, wood, type Face } from "./terrain-perspective-model";
import {
  photoDepthResolution,
  terrainBounds,
  type PhotoRelief,
} from "./terrain-relief";

const assets = "/terrain-assets/";
const foreground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const resolution = photoDepthResolution;
type Models = {
  tree: THREE.Group | null;
  color: THREE.Texture | null;
  normal: THREE.Texture | null;
};

export function terrainModelLoader(renderer: THREE.WebGLRenderer) {
  const transcoder = new KTX2Loader()
    .setTranscoderPath(assets + "basis/")
    .detectSupport(renderer);
  const models = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .setKTX2Loader(transcoder);
  return {
    load: (file: string) => models.loadAsync(assets + file),
    dispose: () => transcoder.dispose(),
  };
}

export async function loadTerrainModels(
  renderer: THREE.WebGLRenderer,
): Promise<Models> {
  const textures = new THREE.TextureLoader();
  const models = terrainModelLoader(renderer);
  const [aspen, color, normal] = await Promise.allSettled([
    models.load("aspen-v1-lod1.glb"),
    textures.loadAsync(assets + "wooden-planks-color.jpg"),
    textures.loadAsync(assets + "wooden-planks-normal.jpg"),
  ]);
  models.dispose();
  const base = color.status === "fulfilled" ? color.value : null;
  const bump = normal.status === "fulfilled" ? normal.value : null;
  if (base) base.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [base, bump]) {
    if (texture) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  }
  return {
    tree: aspen.status === "fulfilled" ? aspen.value.scene : null,
    color: base,
    normal: bump,
  };
}

function sampleGround(depth: number[], row: number) {
  const safeRow = Math.max(0, Math.min(resolution - 1, row));
  const start = safeRow * resolution + 7;
  const values = depth
    .slice(start, start + resolution - 14)
    .sort((a, b) => a - b);
  return values[Math.floor(values.length * 0.35)];
}

function photoGeometry(camera: THREE.PerspectiveCamera, depth?: number[]) {
  const raycaster = new THREE.Raycaster();
  const positions: number[] = [];
  const indices: number[] = [];
  const near = depth
    ? sampleGround(depth, Math.round((resolution - 1) * 0.86))
    : 0;
  const far = depth
    ? sampleGround(depth, Math.round((resolution - 1) * 0.62))
    : 0;
  const ground = new THREE.Vector3();
  for (let row = 0; row < resolution; row++) {
    const y = row / (resolution - 1);
    const expected = far + (Math.max(0, near - far) * (y - 0.62)) / 0.24;
    for (let col = 0; col < resolution; col++) {
      const x = col / (resolution - 1);
      const i = row * resolution + col;
      raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
      const base = raycaster.ray.intersectPlane(foreground, ground);
      const distanceToFloor = base ? camera.position.distanceTo(base) : 100;
      // Align the measured depth to the estimated floor. Keep a slight offset
      // behind it so an intervention placed on the ground remains visible.
      const foregroundDepth = depth
        ? Math.max(0, depth[i] - expected - 0.09)
        : 0;
      const distance = depth
        ? Math.min(100, (distanceToFloor * 1.045) / (1 + foregroundDepth * 2.1))
        : 100;
      positions.push(...raycaster.ray.at(distance, ground).toArray());
      if (row < resolution - 1 && col < resolution - 1) {
        indices.push(
          i,
          i + resolution,
          i + resolution + 1,
          i,
          i + resolution + 1,
          i + 1,
        );
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  return geometry;
}

function makePlacement(
  camera: THREE.PerspectiveCamera,
  surface: ShadeScene["surface"],
) {
  const bounds = terrainBounds(surface);
  const raycaster = new THREE.Raycaster();
  const at = (x: number, y: number) => {
    raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
    return raycaster.ray.intersectPlane(foreground, new THREE.Vector3())!;
  };
  // A ground-level photograph usually shows walkable foreground near the
  // bottom. Fit the site there so bases do not project high onto the facade.
  const farEdge = at(0.5, 0.8);
  const nearEdge = at(0.5, 0.98);
  const center = farEdge.clone().lerp(nearEdge, 0.5);
  const width = at(0.17, 0.88).distanceTo(at(0.83, 0.88));
  const length = farEdge.distanceTo(nearEdge);
  const scale = Math.min(
    width / (bounds.right - bounds.left),
    length / (bounds.top - bounds.bottom),
  );
  const origin = new THREE.Vector3(
    center.x - ((bounds.left + bounds.right) * scale) / 2,
    0,
    center.z + ((bounds.top + bounds.bottom) * scale) / 2,
  );
  return { origin, scale };
}

export function structure(faces: Face[], models: Pick<Models, "color" | "normal">) {
  const group = new THREE.Group();
  const surfaces = new Map<Face["material"], Face[]>();
  for (const face of faces) {
    const group = surfaces.get(face.material);
    if (group) group.push(face);
    else surfaces.set(face.material, [face]);
  }
  for (const [material, groupFaces] of surfaces) {
    const positions: number[] = [];
    const uv: number[] = [];
    for (const { vertices } of groupFaces) {
      const flat = vertices.every((point) => point[2] === vertices[0][2]);
      const alongX =
        Math.abs(vertices[1][0] - vertices[0][0]) >=
        Math.abs(vertices[1][1] - vertices[0][1]);
      const outline = flat && vertices.length > 3
        ? vertices.map(([x, y]) => new THREE.Vector2(x, y))
        : null;
      const clockwise = outline && THREE.ShapeUtils.isClockWise(outline);
      const triangles = outline
        ? THREE.ShapeUtils.triangulateShape(outline, [])
        : Array.from({ length: vertices.length - 2 }, (_, i) => [0, i + 1, i + 2]);
      for (const [a, b, c] of triangles) {
        const triangle = clockwise ? [a, c, b] : [a, b, c];
        for (const index of triangle) {
          const [x, y, z] = vertices[index];
          positions.push(x, z, -y);
          uv.push((alongX ? x : y) / 2, (flat ? y : z) / 2);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
    const timber = material === wood && models.color;
    group.add(
      new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: timber
            ? 0xc4aa88
            : new THREE.Color(`rgb(${material.join(",")})`),
          map: timber ? models.color : null,
          normalMap: timber ? models.normal : null,
          roughness: 0.83,
        }),
      ),
    );
  }
  return group;
}

function placeTree(
  element: Extract<ShadeScene["elements"][number], { kind: "shade_tree" }>,
  tree: THREE.Group,
) {
  const copy = tree.clone(true);
  const bounds = new THREE.Box3().setFromObject(copy);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const width = element.canopyDiameterM / Math.max(size.x, size.z);
  const height = element.heightM / size.y;
  const anchor = new THREE.Group();
  copy.position.set(
    -center.x * width,
    -bounds.min.y * height,
    -center.z * width,
  );
  copy.scale.set(width, height, width);
  anchor.position.set(element.coordinates[0], 0, -element.coordinates[1]);
  anchor.add(copy);
  return anchor;
}

export function groundShadows(elements: ShadeScene["elements"], solar: ShadeSolar) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x28342e,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const element of elements) {
    for (const ring of projectShadow(
      shadeRings(element),
      element.heightM,
      solar,
    )) {
      const shape = new THREE.Shape(
        ring.map(([x, y]) => new THREE.Vector2(x, y)),
      );
      const shadow = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.005;
      group.add(shadow);
    }
  }
  return group;
}

export function photoScene(
  aspect: number,
  photo: THREE.Texture,
  frameSize: THREE.Vector2,
  relief?: PhotoRelief,
) {
  const camera = new THREE.PerspectiveCamera(53, aspect, 0.1, 160);
  camera.position.set(0, 1.65, 0);
  camera.updateMatrixWorld();

  const scene = new THREE.Scene();
  // Preserve the original photograph at its capture angle while the fitted
  // geometry supplies depth to occlude the inserted objects.
  const material = new THREE.ShaderMaterial({
    uniforms: {
      photoTexture: { value: photo },
      frameSize: { value: frameSize },
    },
    vertexShader: `void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
    fragmentShader: `uniform sampler2D photoTexture;
      uniform vec2 frameSize;
      void main() {
        gl_FragColor = texture2D(photoTexture, gl_FragCoord.xy / frameSize);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  scene.add(
    new THREE.Mesh(photoGeometry(camera, relief?.cameraDepth), material),
  );
  return { camera, scene };
}

export function photoProposal(
  scene: ShadeScene,
  camera: THREE.PerspectiveCamera,
  solar: ShadeSolar | null,
  models: Models,
) {
  const group = new THREE.Group();
  const { origin, scale } = makePlacement(camera, scene.surface);
  group.position.copy(origin);
  group.scale.setScalar(scale);
  for (const element of scene.elements) {
    group.add(
      element.kind === "shade_tree" && models.tree
        ? placeTree(element, models.tree)
        : structure(objectFaces(element), models),
    );
  }
  if (solar) group.add(groundShadows(scene.elements, solar));
  return group;
}

export function photoLighting(solar: ShadeSolar | null) {
  const group = new THREE.Group();
  group.add(new THREE.HemisphereLight(0xf1f5ff, 0xad9075, 2.2));
  const directional = new THREE.DirectionalLight(0xfff0d7, 2.0);
  directional.position.set(
    (solar ? Math.sin(solar.azimuthRad) : -0.6) * 8,
    (solar ? Math.tan(solar.elevationRad) : 0.8) * 8,
    (solar ? -Math.cos(solar.azimuthRad) : -0.5) * 8,
  );
  group.add(directional);
  return group;
}

export function disposePhotoObjects(
  root: THREE.Object3D,
  disposeTextures = false,
  reusable = new Set<THREE.Material>(),
) {
  const geometry = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    if (list.some((material: THREE.Material) => reusable.has(material))) return;
    geometry.add(node.geometry);
    for (const material of list) {
      materials.add(material);
      if (disposeTextures) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    }
  });
  geometry.forEach((item) => item.dispose());
  materials.forEach((item) => item.dispose());
  textures.forEach((item) => item.dispose());
}
