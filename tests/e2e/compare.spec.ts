import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addDefaultCanopy, createBranch, openEditor, signIn } from "./helpers";

const publishForm = (page: Page) =>
  page.getByRole("form", { name: "Publicar revisión" });
const editorStatus = (page: Page) => page.locator(".editor-status");

async function saveAndPublish(page: Page, summary: string) {
  await page.getByLabel("Describe el cambio").fill(`Guardar ${summary}`);
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();

  await page.locator("#publish-summary").fill(summary);
  await page.locator("#publish-consent").check();
  await publishForm(page)
    .getByRole("button", { name: "Publicar revisión" })
    .click();
  const link = editorStatus(page).getByRole("link", {
    name: "Abrir enlace público",
  });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/es\/publications\/[0-9a-f-]{36}$/);
  return href!.split("/").pop()!;
}

async function publishCanopy(page: Page, label: string) {
  const { branchId } = await createBranch(page, label);
  await openEditor(page, branchId);
  await addDefaultCanopy(page);
  return saveAndPublish(page, `Resumen ${label}`);
}

async function publishTree(page: Page, label: string) {
  const { branchId } = await createBranch(page, label);
  await openEditor(page, branchId);
  await page
    .getByLabel("Tipo de intervención")
    .selectOption({ label: "Árbol de sombra" });
  await page.getByRole("button", { name: "Agregar a la rama" }).click();
  await expect(page.locator(".editor-feature-list")).toContainText(
    "Árbol de sombra",
  );
  return saveAndPublish(page, `Resumen ${label}`);
}

/** Opens the public page and follows the baseline-compare link; returns its URL. */
async function compareFromPublication(page: Page, publicationId: string) {
  await page.goto(`/es/publications/${publicationId}`);
  await page.getByRole("link", { name: "Comparar con la línea base" }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/es/compare\\?left=baseline(:|%3A)[0-9a-f-]{36}&right=publication(:|%3A)${publicationId}`,
    ),
  );
  return page.url();
}

const h1 = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });

function parseNumber(text: string): number {
  const cleaned = text
    .replace(/[^\d,.\-−]/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace("−", "-");
  return Number(cleaned);
}

test("la persona participante publica, compara con la línea base y ve la sombra añadida", async ({
  page,
}) => {
  await signIn(page);
  const publicationId = await publishCanopy(page, "Comparar flujo");
  await compareFromPublication(page, publicationId);

  await expect(h1(page, "Comparación de propuestas")).toBeVisible();
  const overview = page.getByRole("region", { name: "Resumen de la comparación" });
  await expect(overview).toContainText(
    "No se detectaron solapamientos entre los cambios.",
  );
  await expect(overview).toContainText(/\+[\d.,]+ m²/);
  await expect(overview).toContainText("Costo ilustrativo por alternativa");
  await expect(
    page.getByRole("heading", { level: 2, name: "Indicadores" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Diferencia (B − A)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Costo estimado \(rango\)/ }),
  ).toBeVisible();

  const shadeRow = page.getByRole("row", { name: /Sombra modelada \(m²\)/ });
  await expect(shadeRow).toBeVisible();
  const delta = await shadeRow.getByRole("cell").last().innerText();
  expect(parseNumber(delta)).toBeGreaterThan(0);

  await expect(
    page.getByRole("heading", { level: 2, name: "Mapa de cambios" }),
  ).toBeVisible();
  await expect(page.locator("svg.compare-map[role='img']")).toBeVisible();
  await expect(page.locator("svg.compare-map")).toHaveAttribute(
    "aria-label",
    /Mapa esquemático de los cambios/,
  );
  const legend = page.locator(".compare-legend");
  for (const item of ["Agregada", "Retirada", "Modificada"]) {
    await expect(legend.getByText(item, { exact: true })).toBeVisible();
  }

  await expect(
    page.getByRole("heading", { level: 2, name: "Tabla de cambios" }),
  ).toBeVisible();
  const addedRow = page.getByRole("row", { name: /Cubierta de sombra/ });
  await expect(addedRow.locator(".cmp-badge-added")).toHaveText("Agregada");
  await expect(addedRow.getByRole("rowheader")).toHaveText(
    "Cubierta de sombra",
  );
});

test("un navegador anónimo ve la misma comparación", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  const publicationId = await publishCanopy(page, "Comparar anónimo");
  const url = await compareFromPublication(page, publicationId);

  const anonymous = await browser.newContext({ baseURL });
  try {
    expect(await anonymous.cookies()).toEqual([]);
    const anon = await anonymous.newPage();
    const response = await anon.goto(url);
    expect(response!.status()).toBe(200);
    await expect(h1(anon, "Comparación de propuestas")).toBeVisible();
    await expect(anon.locator(".cmp-badge-added").first()).toHaveText(
      "Agregada",
    );
    await expect(anon.locator("svg.compare-map")).toBeVisible();
  } finally {
    await anonymous.close();
  }
});

test("dos publicaciones distintas muestran un cambio agregado y uno retirado", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  const publicationA = await publishCanopy(page, "Comparar A");

  const second = await browser.newContext({ baseURL });
  try {
    const page2 = await second.newPage();
    await signIn(page2, "coordinator");
    const publicationB = await publishTree(page2, "Comparar B");

    await page.goto(
      `/es/compare?left=publication:${publicationA}&right=publication:${publicationB}`,
    );
    await expect(h1(page, "Comparación de propuestas")).toBeVisible();
    const added = page.locator(".cmp-badge-added");
    const removed = page.locator(".cmp-badge-removed");
    await expect(added).toHaveCount(1);
    await expect(removed).toHaveCount(1);
    await expect(added).toHaveText("Agregada");
    await expect(removed).toHaveText("Retirada");
    await expect(
      page
        .getByRole("row", { name: /Árbol de sombra/ })
        .locator(".cmp-badge-added"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("row", { name: /Cubierta de sombra/ })
        .locator(".cmp-badge-removed"),
    ).toBeVisible();
  } finally {
    await second.close();
  }
});

test("sin parámetros, con referencias mal formadas o desconocidas muestra el estado vacío", async ({
  page,
}) => {
  const uuid = randomUUID();
  const choose = h1(page, "Elige qué comparar");

  await page.goto("/es/compare");
  await expect(choose).toBeVisible();

  await page.goto("/es/compare?left=basura&right=otra");
  await expect(choose).toBeVisible();

  await page.goto(
    `/es/compare?left=publication:${uuid}x&right=baseline:${uuid}`,
  );
  await expect(choose).toBeVisible();

  await page.goto(`/es/compare?left=publication:${uuid}`);
  await expect(choose).toBeVisible();

  await page.goto(
    `/es/compare?left=publication:${randomUUID()}&right=publication:${randomUUID()}`,
  );
  await expect(h1(page, "No encontramos una de las revisiones")).toBeVisible();
  await expect(page.locator(".cmp-badge")).toHaveCount(0);
});

test("la API de comparación devuelve 200, 400, 404 y 422", async ({ page }) => {
  await signIn(page);
  const publicationId = await publishCanopy(page, "Comparar API");
  const compareUrl = await compareFromPublication(page, publicationId);
  const query = new URL(compareUrl).searchParams;
  const left = query.get("left")!;
  const right = query.get("right")!;
  expect(right).toBe(`publication:${publicationId}`);

  const ok = await page.request.get(
    `/api/v1/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`,
  );
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toContain("no-store");
  const body = await ok.json();
  expect(body.data.counts.added).toBe(1);
  expect(body.data.metricDeltas.shadeM2).toBeGreaterThan(0);
  expect(body.data.features.map((f: { class: string }) => f.class)).toEqual([
    "added",
  ]);

  const malformed = await page.request.get(
    "/api/v1/compare?left=nope&right=publication:xyz",
  );
  expect(malformed.status()).toBe(400);
  expect((await malformed.json()).code).toBe("invalid_snapshot_ref");

  const missingParams = await page.request.get("/api/v1/compare");
  expect(missingParams.status()).toBe(400);

  const unknown = await page.request.get(
    `/api/v1/compare?left=baseline:${randomUUID()}&right=publication:${randomUUID()}`,
  );
  expect(unknown.status()).toBe(404);
  expect((await unknown.json()).code).toBe("snapshot_not_found");

  const scenario = await page.request.get(
    `/api/v1/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}&scenario=nope`,
  );
  expect(scenario.status()).toBe(422);
  expect((await scenario.json()).code).toBe("invalid_scenario");
});

test("la página de comparación no tiene hallazgos graves ni desbordamiento a 360 px", async ({
  page,
}) => {
  await signIn(page);
  const publicationId = await publishCanopy(page, "Comparar a11y");
  const url = await compareFromPublication(page, publicationId);

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(url);
  await expect(h1(page, "Comparación de propuestas")).toBeVisible();
  await expect(page.locator(".cmp-badge-added").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Vista esquemática en 3D/ })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Estado vacío también sin desbordamiento.
  await page.goto("/es/compare");
  await expect(h1(page, "Elige qué comparar")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test("la simulación conserva la cubierta compartida y cambia su sombra según la hora", async ({ page }) => {
  await signIn(page);
  const publicationId = await publishCanopy(page, "Sombra 3D");
  const ref = `publication:${publicationId}`;
  await page.goto(`/es/compare?left=${ref}&right=${ref}`);

  await expect(page.getByText("Las dos revisiones tienen las mismas intervenciones.")).toBeVisible();
  const scene = page.getByRole("region", { name: "Simulación de sombra en 3D" });
  const footprint = scene.locator(".shade-footprint");
  await expect(footprint).toHaveCount(1);
  const morning = await footprint.getAttribute("d");
  await scene.getByLabel("Revisión").selectOption("left");
  await scene.getByLabel("Hora en Puebla").selectOption("equinox-1600");
  await scene.getByRole("button", { name: "Actualizar simulación" }).press("Enter");

  await expect(page).toHaveURL(/scenario=equinox-1600#shade-3d$/);
  await expect(scene.getByLabel("Revisión")).toHaveValue("left");
  await expect(scene.getByLabel("Hora en Puebla")).toHaveValue("equinox-1600");
  await expect(footprint).toHaveCount(1);
  await expect(footprint).not.toHaveAttribute("d", morning!);

  const add = scene.getByRole("button", { name: "Agregar objeto" });
  await add.press("ArrowRight");
  await add.press("Enter");
  await expect(footprint).toHaveCount(2);
  const before = await scene.locator(".shade-scene").innerHTML();
  await scene.getByRole("spinbutton", { name: "2. Árbol · Altura (m)" }).fill("12");
  await expect.poll(() => scene.locator(".shade-scene").innerHTML()).not.toBe(before);
  await scene.getByRole("button", { name: "Eliminar 2. Árbol" }).click();
  await expect(footprint).toHaveCount(1);

  const canopy = scene.getByRole("button", { name: "Cubierta", exact: true });
  await canopy.evaluate((button) => button.scrollIntoView({ block: "start", behavior: "instant" }));
  const source = (await canopy.boundingBox())!;
  const ground = (await scene.locator(".shade-scene-ground").boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(ground.x + ground.width / 2, ground.y + ground.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(footprint).toHaveCount(2);
});

test("la ruta en inglés muestra la comparación en inglés", async ({ page }) => {
  await signIn(page);
  const publicationId = await publishCanopy(page, "Comparar English");
  const url = await compareFromPublication(page, publicationId);

  await page.goto(url.replace("/es/compare", "/en/compare"));
  await expect(h1(page, "Proposal comparison")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Comparison overview" }),
  ).toContainText("No overlaps were detected between the changes.");
  await expect(page.locator(".cmp-badge-added").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "3D shade simulation" })).toBeVisible();
  await expect(page.getByLabel("Time in Puebla")).toHaveValue("equinox-1000");
  await expect(page.getByRole("link", { name: "Español" })).toHaveAttribute(
    "href",
    /^\/es\/compare\?left=/,
  );
  await expect(page.getByText("Comparación de propuestas")).toHaveCount(0);
});
