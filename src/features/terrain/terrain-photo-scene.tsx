"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { ShadeSolar } from "@/features/compare/shade-geometry";
import type { ShadeScene } from "@/lib/schemas/shade-scene";
import type es from "@/messages/es.json";
import {
  disposePhotoObjects,
  loadTerrainModels,
  photoLighting,
  photoProposal,
  photoScene,
} from "./terrain-photo-render";
import type { PhotoRelief } from "./terrain-relief";

type Resources = {
  renderer: THREE.WebGLRenderer;
  photo: THREE.Texture;
  models: Awaited<ReturnType<typeof loadTerrainModels>>;
  treeMaterials: Set<THREE.Material>;
};

export default function TerrainPhotoScene({
  copy,
  photoUrl,
  ratio,
  scene,
  solar,
  relief,
}: {
  copy: typeof es.terrain.photoScene;
  photoUrl: string;
  ratio: number;
  scene: ShadeScene;
  solar: ShadeSolar | null;
  relief?: PhotoRelief;
}) {
  const target = useRef<HTMLCanvasElement>(null);
  const [resources, setResources] = useState<Resources | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [showProposal, setShowProposal] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let loaded: Resources | undefined;

    function release(state: Resources) {
      state.photo.dispose();
      state.models.color?.dispose();
      state.models.normal?.dispose();
      if (state.models.tree) disposePhotoObjects(state.models.tree, true);
    }

    async function prepare() {
      try {
        if (!target.current) return;
        renderer = new THREE.WebGLRenderer({
          canvas: target.current,
          antialias: true,
          preserveDrawingBuffer: true,
        });
        const width = Math.round(Math.min(1152, 760 * ratio));
        renderer.setSize(width, Math.round(width / ratio), false);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        const photo = await new THREE.TextureLoader().loadAsync(photoUrl);
        photo.colorSpace = THREE.SRGBColorSpace;
        if (cancelled) {
          photo.dispose();
          return;
        }
        const models = await loadTerrainModels(renderer);
        const treeMaterials = new Set<THREE.Material>();
        models.tree?.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          const materials = Array.isArray(node.material)
            ? node.material
            : [node.material];
          materials.forEach((material: THREE.Material) =>
            treeMaterials.add(material),
          );
        });
        loaded = { renderer, photo, models, treeMaterials };
        if (cancelled) release(loaded);
        else setResources(loaded);
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    }

    void Promise.resolve().then(prepare);
    return () => {
      cancelled = true;
      if (loaded) release(loaded);
      renderer?.dispose();
    };
  }, [photoUrl, ratio]);

  useEffect(() => {
    if (!resources) return;
    const { renderer, photo, models, treeMaterials } = resources;
    const view = photoScene(
      ratio,
      photo,
      renderer.getDrawingBufferSize(new THREE.Vector2()),
      relief,
    );
    if (showProposal) {
      view.scene.add(
        photoLighting(solar),
        photoProposal(scene, view.camera, solar, models),
      );
    }
    renderer.render(view.scene, view.camera);
    return () => disposePhotoObjects(view.scene, false, treeMaterials);
  }, [ratio, relief, resources, scene, showProposal, solar]);

  return (
    <div className="terrain-photo-preview">
      <div
        className="terrain-actions terrain-photo-preview-controls"
        role="group"
        aria-label={copy.compare}
      >
        <button
          type="button"
          className="button terrain-view-button"
          aria-pressed={!showProposal}
          onClick={() => setShowProposal(false)}
        >
          {copy.before}
        </button>
        <button
          type="button"
          className="button terrain-view-button"
          aria-pressed={showProposal}
          onClick={() => setShowProposal(true)}
        >
          {copy.after}
        </button>
      </div>
      {!resources && !unavailable && (
        <p className="field-help" role="status">
          {copy.loading}
        </p>
      )}
      {unavailable && (
        <>
          <p className="field-help" role="status">
            {copy.unavailable}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- The local photo uses a browser object URL. */}
          <img
            className="terrain-photo-frame"
            src={photoUrl}
            alt={copy.before}
          />
        </>
      )}
      <canvas
        ref={target}
        className="terrain-photo-frame"
        role="img"
        aria-label={showProposal ? copy.graphic : copy.before}
        hidden={!resources || unavailable}
        data-terrain-photo-mode={
          resources
            ? relief?.cameraDepth
              ? "depth"
              : "approximate"
            : "loading"
        }
        data-terrain-model={resources?.models.tree ? "aspen" : "fallback"}
      />
      <p className="field-help">
        {copy.materials} · <a href="https://tevy.dev/models/aspen">tevy</a> ·{" "}
        <a href="https://polyhaven.com/a/wooden_planks">Poly Haven</a>
      </p>
    </div>
  );
}
