import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaceCatalog } from "@/features/places/place-catalog";
import { pilotSite } from "@/features/places/site-data";
import es from "@/messages/es.json";

describe("PlaceCatalog", () => {
  it("distinguishes sourced reference data from hypothetical fixtures in text", () => {
    render(<PlaceCatalog locale="es" messages={es} site={pilotSite} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Una plaza real. Propuestas que no borran su historia.",
    );
    expect(screen.getByText("Dato de referencia")).toBeVisible();
    expect(screen.getByText("Escenario hipotético")).toBeVisible();
    expect(screen.getByText(/no describen obras existentes/i)).toBeVisible();
    expect(screen.getByText(/sin evidencia de ejecución/i)).toBeVisible();
  });

  it("keeps a textual alternative and source link alongside the schematic", () => {
    render(<PlaceCatalog locale="es" messages={es} site={pilotSite} />);

    expect(
      screen.getByRole("img", { name: /dos intervenciones hipotéticas/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Alternativa disponible sin mapa" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Abrir fuente de OpenStreetMap" }),
    ).toHaveAttribute("rel", "noopener noreferrer");
  });
});
