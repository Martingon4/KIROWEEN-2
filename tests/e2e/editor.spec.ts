import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addDefaultCanopy,
  api,
  createBranch,
  featureList,
  openEditor,
  revealCoordinates,
  signIn,
} from "./helpers";

test("bloquea un árbol dentro del mercado y permite moverlo fuera", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor ocupación");
  await openEditor(page, branchId);
  const kind = page.getByLabel("Tipo de intervención");
  const add = page.getByRole("button", { name: "Agregar a la rama" });
  await kind.selectOption({ label: "Mercado temporal" });
  await (
    await revealCoordinates(page)
  ).fill(
    "-98.19820, 19.04360\n-98.19800, 19.04360\n-98.19800, 19.04370\n-98.19820, 19.04370",
  );
  await add.click();
  await expect(featureList(page)).toContainText("Mercado temporal");

  await kind.selectOption({ label: "Árbol de sombra" });
  await (await revealCoordinates(page)).fill("-98.19815, 19.04365");
  await add.click();
  await expect(page.getByText(/El tronco del árbol coincide/)).toBeVisible();
  await expect(featureList(page).locator("li")).toHaveCount(1);

  await (await revealCoordinates(page)).fill("-98.19775, 19.04360");
  await add.click();
  await expect(featureList(page)).toContainText("Árbol de sombra");
  await page
    .getByLabel("Describe el cambio")
    .fill("Separar el tronco y el mercado");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  const head = (await api(page, `/api/v1/branches/${branchId}`)).body!.data;
  const bypass = await api(page, `/api/v1/branches/${branchId}/revisions`, {
    method: "POST",
    key: randomUUID(),
    body: {
      message: "Intento desde la API",
      expectedHeadId: head.revisionId,
      features: head.features.map(
        (feature: { kind: string; geometry: unknown }) =>
          feature.kind === "shade_tree"
            ? {
                ...feature,
                geometry: { type: "Point", coordinates: [-98.19815, 19.04365] },
              }
            : feature,
      ),
    },
  });
  expect(bypass.status).toBe(422);
  expect(bypass.body?.code).toBe("market_tree_overlap");
});

test("guarda una revisión desde el formulario y la conserva al recargar", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor guardar");
  await openEditor(page, branchId);

  const coordinates = page.locator("details.coordinates-details");
  const draft = page.locator("svg.editor-preview polygon.preview-draft");
  const initialFootprint = await draft.getAttribute("points");
  const place = page.getByRole("button", { name: "Agregar a la rama" });
  await place.press("Shift+ArrowRight");
  await expect(draft).not.toHaveAttribute("points", initialFootprint!);
  await place.press("Enter");
  await expect(coordinates).toHaveJSProperty("open", false);
  await expect(
    page.getByText("Cambios sin guardar en este dispositivo"),
  ).toBeVisible();

  await page
    .getByRole("link", { name: /guarda los cambios de la rama/ })
    .click();
  await expect(page).toHaveURL(/#editor-message$/);
  await page.getByLabel("Describe el cambio").fill("Agrego cubierta de sombra");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /publica la revisión guardada/ }),
  ).toBeVisible();

  await page.reload();
  await expect(featureList(page)).toContainText("Cubierta de sombra");
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();
});

test("coloca mobiliario en una rama, lo guarda y lo conserva al publicar y bifurcar", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  const { branchId } = await createBranch(page, "Mobiliario del Zócalo");
  await openEditor(page, branchId);
  await page.getByRole("button", { name: "Colocar objetos" }).click();
  await expect(page.getByLabel("Tipo de intervención")).toHaveValue("bench");
  await page.getByRole("button", { name: "Banca", exact: true }).click();
  const plan = page.getByRole("img", { name: /Vista previa esquemática/ });
  await plan.click();
  const add = page.getByRole("button", { name: "Agregar a la rama" });
  await add.click();
  await expect(featureList(page)).toContainText("Banca");
  await plan.click();
  await add.click();
  await expect(page.getByText(/Ese espacio ya está ocupado/)).toBeVisible();
  await expect(featureList(page).locator("li")).toHaveCount(1);

  await page.getByLabel("Objetos por categoría").selectOption("access");
  await expect(page.getByRole("button", { name: "Rampa" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await add.press("Shift+ArrowRight");
  await add.press("Enter");
  await expect(featureList(page)).toContainText("Rampa");
  await page
    .getByLabel("Describe el cambio")
    .fill("Coloco mobiliario hipotético");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  await page.reload();
  await expect(featureList(page).locator("li")).toHaveCount(2);
  await page.getByRole("button", { name: "Vista previa 3D" }).click();
  const scene = page.locator("canvas.terrain-perspective-canvas");
  await expect(scene).toHaveAttribute("data-detail-models", /bench/, {
    timeout: 45000,
  });
  await expect(
    page.getByRole("button", { name: "Enfocar modelos" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBe(0);

  const head = (await api(page, `/api/v1/branches/${branchId}`)).body!.data;
  expect(
    head.features
      .map(
        (feature: { properties: { objectType: string } }) =>
          feature.properties.objectType,
      )
      .sort(),
  ).toEqual(["bench", "ramp"]);
  const existing = head.features[0];
  const collision = await api(page, `/api/v1/branches/${branchId}/revisions`, {
    method: "POST",
    key: randomUUID(),
    body: {
      message: "Intento solapar objetos",
      expectedHeadId: head.revisionId,
      features: [...head.features, { ...existing, id: randomUUID() }],
    },
  });
  expect(collision.status).toBe(422);
  expect(collision.body?.code).toBe("urban_object_overlap");

  await page
    .locator("#publish-summary")
    .fill("Banca y rampa en una propuesta hipotética.");
  await page.locator("#publish-consent").check();
  await page
    .getByRole("form", { name: "Publicar revisión" })
    .getByRole("button", { name: "Publicar revisión" })
    .click();
  const link = page
    .locator(".editor-status")
    .getByRole("link", { name: "Abrir enlace público" });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  const publicationId = href.split("/").pop();
  await page.goto(href);
  await expect(page.locator(".publication-features")).toContainText("Rampa");
  const comparison = await api(
    page,
    `/api/v1/compare?left=baseline:${head.baselineId}&right=publication:${publicationId}`,
  );
  expect(comparison.status).toBe(200);
  expect(comparison.body?.data.right.cost).toMatchObject({
    partial: true,
    lines: [{ concept: "urban_object", quantity: 2, status: "unpriced" }],
  });
  await page.getByRole("button", { name: "Crear mi copia privada" }).click();
  await expect(page).toHaveURL(/\/es\/branches\/[^/]+$/);
  await expect(featureList(page).locator("li")).toHaveCount(2);
  await page.goto(new URL(page.url()).pathname.replace("/es/", "/en/"));
  await expect(
    page.getByRole("button", { name: "Place objects" }),
  ).toBeVisible();
  await expect(featureList(page)).toContainText("Ramp");
});

test("elige modelos individuales en Tipo de intervención y los dibuja sin cerrar el 3D", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  const { branchId } = await createBranch(
    page,
    "Diseño desde el menú de la rama",
  );
  await openEditor(page, branchId);
  const selector = page.getByLabel("Tipo de intervención");
  await expect(selector.locator("option")).toHaveCount(13);
  await expect(selector.locator("optgroup")).toHaveCount(4);
  await expect(selector.locator("optgroup option")).toHaveCount(9);
  await expect(
    selector.locator('optgroup[label="Actividad y recreación"] option'),
  ).toContainText(["Puesto de mercado", "Fuente", "Escenario"]);

  const preview = page.getByRole("button", { name: "Vista previa 3D" });
  await preview.click();
  const canvas = page.locator("canvas.terrain-perspective-canvas");
  await expect(canvas).toHaveAttribute("data-detail-models", /bench/, {
    timeout: 45000,
  });
  await expect(canvas).toHaveAttribute("data-context-buildings", /^[1-9]/);
  const pixels = async () =>
    createHash("sha256")
      .update(
        await canvas.evaluate((element) =>
          (element as HTMLCanvasElement).toDataURL(),
        ),
      )
      .digest("hex");
  const empty = await pixels();
  await selector.selectOption({ label: "Escenario" });
  await expect(page.getByLabel("Nombre visible")).toHaveValue("Escenario");
  const add = page.getByRole("button", { name: "Agregar a la rama" });
  await add.click();
  await expect(featureList(page)).toContainText("Escenario");
  await expect(preview).toHaveAttribute("aria-pressed", "true");
  await expect.poll(pixels, { timeout: 15000 }).not.toBe(empty);
  const withStage = await pixels();

  await selector.selectOption({ label: "Banca" });
  for (let i = 0; i < 4; i++) await add.press("Shift+ArrowRight");
  await add.press("Enter");
  await expect(featureList(page).locator("li")).toHaveCount(2);
  await expect.poll(pixels, { timeout: 15000 }).not.toBe(withStage);
  const overview = await pixels();
  const focus = page.getByLabel("Objeto a enfocar");
  await expect(focus.locator("option")).toHaveText([
    "Vista general",
    "1. Escenario",
    "2. Banca",
  ]);
  await expect(focus).toHaveValue("");
  await expect(page.locator(".terrain-overview-marker").first()).toBeVisible();
  const benchMarker = page.getByRole("button", { name: "Enfocar Banca" });
  if (await benchMarker.count()) {
    await benchMarker.click();
  } else {
    await page.getByRole("button", { name: "2 objetos cercanos" }).click();
    const group = page.getByLabel("Objetos del grupo");
    await expect(group).toBeFocused();
    await group.selectOption({ label: "Banca" });
  }
  await expect(focus.locator("option:checked")).toHaveText("2. Banca");
  await expect(page.locator(".terrain-selection")).toHaveText("Banca");
  await page.getByRole("button", { name: "Ver todo el terreno" }).click();
  await page.getByRole("button", { name: "Enfocar modelos" }).click();
  await expect.poll(pixels, { timeout: 15000 }).not.toBe(overview);
  const stageDetail = await pixels();
  await focus.selectOption({ label: "2. Banca" });
  await expect.poll(pixels, { timeout: 15000 }).not.toBe(stageDetail);
  await page.getByRole("button", { name: "Ver todo el terreno" }).click();
  await expect.poll(pixels, { timeout: 15000 }).toBe(overview);
  await expect(focus).toHaveValue("");
  await page.getByRole("button", { name: "Ver en 3D · Banca" }).click();
  await expect(focus.locator("option:checked")).toHaveText("2. Banca");
  await expect(
    page.getByRole("heading", { name: "Vista previa esquemática" }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Elegir ubicación en el plano" })
    .click();
  await expect(page.locator(".editor-object-location")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBe(0);
});

test("deshace y rehace desde la interfaz", async ({ page }) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor deshacer");
  await openEditor(page, branchId);

  await addDefaultCanopy(page);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(featureList(page).locator("li")).toHaveCount(0);
  await expect(page.getByText(/La rama no tiene intervenciones/)).toBeVisible();

  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(featureList(page)).toContainText("Cubierta de sombra");
});

test("muestra la intervención en 3D al agregarla y al deshacer", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor vista 3D");
  await openEditor(page, branchId);

  const button = page.getByRole("button", { name: "Vista previa 3D" });
  await button.click();
  const scene = page.getByRole("img", {
    name: "Vista 3D con las intervenciones de esta rama",
  });
  const pixels = async () =>
    createHash("sha256")
      .update(
        await scene.evaluate((element) =>
          (element as HTMLCanvasElement).toDataURL(),
        ),
      )
      .digest("hex");
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute("data-detail-models", /bench/, {
    timeout: 45000,
  });
  const empty = await pixels();

  await addDefaultCanopy(page);
  await expect.poll(pixels).not.toBe(empty);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(pixels).toBe(empty);
  await scene.press("ArrowRight");
  await expect.poll(pixels).not.toBe(empty);
  await button.click();
  await expect(
    page.getByRole("img", { name: /Vista previa esquemática/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBe(0);
});

test("dibuja diez puestos con el modelo GLB y permite pausar el giro", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  const { branchId } = await createBranch(page, "Mercado con modelos 3D");
  await openEditor(page, branchId);
  await page
    .getByLabel("Tipo de intervención")
    .selectOption({ label: "Mercado temporal" });
  await page.locator("#editor-stallCount").fill("10");
  await page.locator("#editor-moduleM2").fill("6");
  await (
    await revealCoordinates(page)
  ).fill(
    "-98.19820, 19.04360\n-98.19800, 19.04360\n-98.19800, 19.04370\n-98.19820, 19.04370",
  );
  await page.getByRole("button", { name: "Agregar a la rama" }).click();
  await page.getByRole("button", { name: "Vista previa 3D" }).click();
  const canvas = page.locator("canvas.terrain-perspective-canvas");
  await expect(canvas).toHaveAttribute("data-detail-models", /stall/, {
    timeout: 45000,
  });
  await expect(
    page.getByText(/Puestos dibujados a escala: 10 de 10/),
  ).toBeVisible();
  const pixels = async () =>
    createHash("sha256")
      .update(
        await canvas.evaluate((node) =>
          (node as HTMLCanvasElement).toDataURL(),
        ),
      )
      .digest("hex");
  const wide = await pixels();
  await page.getByRole("button", { name: "Enfocar modelos" }).click();
  await expect.poll(pixels).not.toBe(wide);
  const still = await pixels();
  await page.getByRole("button", { name: "Girar en automático" }).click();
  await expect.poll(pixels, { timeout: 15000 }).not.toBe(still);
  await page.getByRole("button", { name: "Pausar giro" }).click();
  const stopped = await pixels();
  await expect
    .poll(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return pixels();
    })
    .toBe(stopped);
  await page.getByRole("button", { name: "Ver todo el terreno" }).click();
  await expect.poll(pixels).not.toBe(stopped);
});

test("recupera un borrador local tras recargar", async ({ page }) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor borrador");
  await openEditor(page, branchId);

  await addDefaultCanopy(page);
  await page.reload();

  await expect(page.getByText(/Hay un borrador local guardado/)).toBeVisible();
  await expect(featureList(page).locator("li")).toHaveCount(0);
  await page.getByRole("button", { name: "Recuperar borrador" }).click();
  await expect(featureList(page)).toContainText("Cubierta de sombra");
});

test("avisa cuando otra sesión guardó antes y conserva el borrador", async ({
  page,
}) => {
  await signIn(page);
  const { branchId, revisionId } = await createBranch(page, "Editor obsoleto");
  await openEditor(page, branchId);

  await addDefaultCanopy(page);

  const other = await api(page, `/api/v1/branches/${branchId}/revisions`, {
    method: "POST",
    key: randomUUID(),
    body: {
      expectedHeadId: revisionId,
      message: "Otra sesión",
      features: [],
    },
  });
  expect(other.status).toBe(201);

  await page.getByLabel("Describe el cambio").fill("Mi cambio local");
  await page.getByRole("button", { name: "Guardar revisión" }).click();

  await expect(
    page.getByText("Otra sesión guardó esta rama antes que tú"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Cargar la versión guardada más reciente",
    }),
  ).toBeVisible();
  await expect(featureList(page)).toContainText("Cubierta de sombra");
  await expect(
    page.getByText("Cambios sin guardar en este dispositivo"),
  ).toBeVisible();
});

test("la API de revisiones es idempotente y oculta ramas ajenas", async ({
  page,
}) => {
  await signIn(page);
  const { branchId, revisionId } = await createBranch(page, "Editor API");
  const path = `/api/v1/branches/${branchId}/revisions`;
  const key = randomUUID();
  const body = {
    expectedHeadId: revisionId,
    message: "Primera",
    features: [],
  };

  const first = await api(page, path, { method: "POST", key, body });
  const replay = await api(page, path, { method: "POST", key, body });
  const conflict = await api(page, path, {
    method: "POST",
    key,
    body: { ...body, message: "Otro mensaje" },
  });

  expect(first.status).toBe(201);
  expect(first.body!.data.parentRevisionId).toBe(revisionId);
  expect(replay.status).toBe(201);
  expect(replay.body!.data.revisionId).toBe(first.body!.data.revisionId);
  expect(conflict.status).toBe(409);
  expect(conflict.body!.code).toBe("idempotency_conflict");

  const missing = await api(page, `/api/v1/branches/${randomUUID()}`);
  expect(missing.status).toBe(404);

  const own = await api(page, `/api/v1/branches/${branchId}`);
  expect(own.status).toBe(200);
});

test("el editor no tiene hallazgos graves de accesibilidad ni desbordamiento", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor a11y");
  await openEditor(page, branchId);
  await addDefaultCanopy(page);

  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(serious).toEqual([]);

  await page.setViewportSize({ width: 360, height: 800 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("la lista de ramas enlaza al editor y al simulador con foto", async ({ page }) => {
  await signIn(page);
  const { branchId, title } = await createBranch(page, "Editor enlace");
  await page.goto("/es/branches");
  const link = page.getByRole("link", {
    name: `Abrir el editor de ${title}`,
  });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/es/branches/${branchId}$`));

  await page.goto("/es/branches");
  const simulator = page.getByRole("link", { name: "Diseñar en mi terreno" });
  await expect(simulator).toBeVisible();
  await simulator.press("Enter");
  await expect(page).toHaveURL(/\/es\/terrain$/);
  await expect(page.getByLabel("Elegir foto")).toBeVisible();

  await page.goto("/en/branches");
  await page.getByRole("link", { name: "Design on my land" }).click();
  await expect(page).toHaveURL(/\/en\/terrain$/);
});

test("el primer Tab del editor enfoca el enlace de salto visible", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor salto");
  await openEditor(page, branchId);

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#editor-main$/);
});

const boundaryRing: number[][] = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "data/sites/zocalo-puebla/baseline.geojson"),
    "utf8",
  ),
).features[0].geometry.coordinates[0];
function insideBoundary([x, y]: number[]) {
  let inside = false;
  for (
    let i = 0, j = boundaryRing.length - 1;
    i < boundaryRing.length;
    j = i++
  ) {
    const [xi, yi] = boundaryRing[i];
    const [xj, yj] = boundaryRing[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
async function clickPreview(page: Page, fx: number, fy: number) {
  const preview = page.locator("svg.editor-preview");
  await preview.scrollIntoViewIfNeeded();
  const box = (await preview.boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}
async function readCoordinates(page: Page) {
  const text = await (await revealCoordinates(page)).inputValue();
  return text.split(",").map((part) => Number(part.trim()));
}
async function chooseShadeTree(page: Page) {
  await page.getByLabel("Tipo de intervención").selectOption({
    label: "Árbol de sombra",
  });
}
test("colocar con un clic en la vista previa agrega y guarda la intervención", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor clic");
  await openEditor(page, branchId);
  await chooseShadeTree(page);
  const field = await revealCoordinates(page);
  const before = await field.inputValue();
  await clickPreview(page, 0.5, 0.5);
  await expect(field).not.toHaveValue(before);
  const point = await readCoordinates(page);
  expect(point).toHaveLength(2);
  expect(insideBoundary(point)).toBe(true);
  await expect(page.locator("svg.editor-preview .preview-draft")).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Agregar a la rama" }).click();
  await expect(featureList(page)).toContainText("Árbol de sombra");
  await page.getByLabel("Describe el cambio").fill("Árbol colocado con clic");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();
});
test("un clic fuera del límite de la plaza produce el error al agregar", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor fuera");
  await openEditor(page, branchId);
  await chooseShadeTree(page);
  await clickPreview(page, 0.02, 0.02);
  const point = await readCoordinates(page);
  expect(insideBoundary(point)).toBe(false);
  await page.getByRole("button", { name: "Agregar a la rama" }).click();
  await page.getByLabel("Describe el cambio").fill("Fuera del límite");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(
    page.getByText(
      "Una intervención queda fuera del límite de la plaza. Revisa sus coordenadas.",
    ),
  ).toBeVisible();
});
test("el formulario por teclado sigue funcionando junto al clic", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor teclado");
  await openEditor(page, branchId);
  await chooseShadeTree(page);
  const field = await revealCoordinates(page);
  await field.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("-98.1981, 19.0437");
  await expect(field).toHaveValue("-98.1981, 19.0437");
  await expect(page.locator("svg.editor-preview .preview-draft")).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Agregar a la rama" }).focus();
  await page.keyboard.press("Enter");
  await expect(featureList(page)).toContainText("Árbol de sombra");
});
test("el editor con clic en la vista previa no tiene hallazgos graves de accesibilidad", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor clic a11y");
  await openEditor(page, branchId);
  await chooseShadeTree(page);
  await clickPreview(page, 0.5, 0.5);
  await expect(page.locator("svg.editor-preview .preview-draft")).toHaveCount(
    1,
  );
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(serious).toEqual([]);
});

test("las coordenadas son opcionales: details cerrado, clic actualiza el trazo y el error lo abre", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor details");
  await openEditor(page, branchId);
  await chooseShadeTree(page);
  const details = page.locator("details.coordinates-details");
  await expect(details).toHaveJSProperty("open", false);
  await expect(
    details.locator("summary", {
      hasText: "Ajustar las coordenadas a mano (opcional)",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Toca la vista previa de arriba para elegir dónde va. No necesitas escribir coordenadas.",
    ),
  ).toBeVisible();
  await clickPreview(page, 0.5, 0.5);
  await expect(page.locator("svg.editor-preview .preview-draft")).toHaveCount(
    1,
  );
  await expect(details).toHaveJSProperty("open", false);
  const field = await revealCoordinates(page);
  const value = await field.inputValue();
  expect(value).not.toBe("");
  expect(insideBoundary(await readCoordinates(page))).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  // Un error de coordenadas abre el details por sí solo.
  await field.fill("no son coordenadas");
  await details.locator("summary").click();
  await expect(details).toHaveJSProperty("open", false);
  await page.getByRole("button", { name: "Agregar a la rama" }).click();
  await expect(details).toHaveJSProperty("open", true);
  await expect(field).toHaveAttribute("aria-invalid", "true");
});
