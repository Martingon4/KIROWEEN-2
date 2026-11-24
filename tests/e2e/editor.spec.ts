import { randomUUID } from "node:crypto";
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

test("guarda una revisión desde el formulario y la conserva al recargar", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Editor guardar");
  await openEditor(page, branchId);

  await addDefaultCanopy(page);
  await expect(
    page.getByText("Cambios sin guardar en este dispositivo"),
  ).toBeVisible();

  await page.getByLabel("Describe el cambio").fill("Agrego cubierta de sombra");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();

  await page.reload();
  await expect(featureList(page)).toContainText("Cubierta de sombra");
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();
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

test("la lista de ramas enlaza al editor de cada rama", async ({ page }) => {
  await signIn(page);
  const { branchId, title } = await createBranch(page, "Editor enlace");
  await page.goto("/es/branches");
  const link = page.getByRole("link", {
    name: `Abrir el editor de ${title}`,
  });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/es/branches/${branchId}$`));
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
