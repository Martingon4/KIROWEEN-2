"use client";

import type { FeatureCollection } from "geojson";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PublicSite } from "@/features/places/site-data";

type InteractiveMapProps = {
  ariaLabel: string;
  baseline: PublicSite["baseline"];
  osmContext: PublicSite["osmContext"];
  fallback: ReactNode;
  readyLabel: string;
  scenario: PublicSite["scenario"];
};

type MapState = "loading" | "ready" | "fallback";

export function InteractiveMap({
  ariaLabel,
  baseline,
  osmContext,
  fallback,
  readyLabel,
  scenario,
}: InteractiveMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<MapState>("loading");

  useEffect(() => {
    let disposed = false;
    let map: import("maplibre-gl").Map | undefined;

    async function mountMap() {
      if (!container.current) return;
      if (
        new URLSearchParams(window.location.search).get("map") === "fallback"
      ) {
        setState("fallback");
        return;
      }

      try {
        const maplibregl = await import("maplibre-gl");
        if (disposed || !container.current) return;
        maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
        const [west, south, east, north] = osmContext.bbox;

        map = new maplibregl.Map({
          container: container.current,
          style: {
            version: 8,
            sources: {
              streets: {
                type: "geojson",
                data: osmContext as unknown as FeatureCollection,
              },
              baseline: {
                type: "geojson",
                data: baseline as unknown as FeatureCollection,
              },
              scenario: {
                type: "geojson",
                data: scenario as unknown as FeatureCollection,
              },
            },
            layers: [
              {
                id: "paper",
                type: "background",
                paint: { "background-color": "#e2e8f0" },
              },
              {
                id: "boundary-fill",
                type: "fill",
                source: "baseline",
                paint: { "fill-color": "#f8fafc", "fill-opacity": 0.92 },
              },
              {
                id: "boundary-line",
                type: "line",
                source: "baseline",
                paint: {
                  "line-color": "#0f172a",
                  "line-width": 4,
                  "line-dasharray": [3, 2],
                },
              },
              {
                id: "reference-buildings",
                type: "fill",
                source: "streets",
                filter: ["==", ["get", "kind"], "building"],
                paint: { "fill-color": "#c7beb2", "fill-outline-color": "#989188" },
              },
              {
                id: "reference-streets",
                type: "line",
                source: "streets",
                filter: ["==", ["get", "kind"], "street"],
                paint: { "line-color": "#64748b", "line-width": 2.3 },
              },
              {
                id: "reference-paths",
                type: "line",
                source: "streets",
                filter: ["in", ["get", "kind"], ["literal", ["path", "crossing"]]],
                paint: { "line-color": "#64748b", "line-width": 1.5, "line-dasharray": [2, 2] },
              },
              {
                id: "reference-crossings",
                type: "circle",
                source: "streets",
                filter: ["==", ["geometry-type"], "Point"],
                paint: { "circle-color": "#475569", "circle-radius": 3 },
              },
              {
                id: "shade-fill",
                type: "fill",
                source: "scenario",
                filter: ["==", ["get", "kind"], "shade_canopy"],
                paint: { "fill-color": "#0369a1", "fill-opacity": 0.62 },
              },
              {
                id: "shade-line",
                type: "line",
                source: "scenario",
                filter: ["==", ["get", "kind"], "shade_canopy"],
                paint: { "line-color": "#075985", "line-width": 3 },
              },
              {
                id: "market-fill",
                type: "fill",
                source: "scenario",
                filter: ["==", ["get", "kind"], "temporary_market"],
                paint: { "fill-color": "#f59e0b", "fill-opacity": 0.42 },
              },
              {
                id: "market-line",
                type: "line",
                source: "scenario",
                filter: ["==", ["get", "kind"], "temporary_market"],
                paint: { "line-color": "#b45309", "line-width": 3 },
              },
            ],
          },
          bounds: [
            [west, south],
            [east, north],
          ],
          fitBoundsOptions: { padding: 56 },
          attributionControl: false,
          cooperativeGestures: true,
          dragRotate: false,
          keyboard: true,
          pitchWithRotate: false,
        });

        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "top-right",
        );
        map.once("load", () => {
          if (!disposed) setState("ready");
        });
        map.once("error", () => {
          if (!disposed && !map?.loaded()) setState("fallback");
        });
      } catch {
        if (!disposed) setState("fallback");
      }
    }

    void mountMap();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [baseline, osmContext, scenario]);

  return (
    <div className="map-stage" data-map-state={state}>
      <div
        className={
          state === "ready"
            ? "map-fallback map-fallback-hidden"
            : "map-fallback"
        }
      >
        {fallback}
      </div>
      <div
        ref={container}
        className={
          state === "ready"
            ? "interactive-map interactive-map-ready"
            : "interactive-map"
        }
        role="region"
        aria-label={ariaLabel}
        inert={state !== "ready"}
        tabIndex={state === "ready" ? 0 : -1}
      />
      <span className="sr-only" aria-live="polite">
        {state === "ready" ? readyLabel : ""}
      </span>
    </div>
  );
}
