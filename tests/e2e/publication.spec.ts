import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addDefaultCanopy,
  api,
  createBranch,
  featureList,
  openEditor,
  signIn,
} from "./helpers";

const publishForm = (page: Page) =>
  page.getByRole("form", { name: "Publicar revisión" });
const publishButton = (page: Page) =>
  publishForm(page).getByRole("button", { name: "Publicar revisión" });
const editorStatus = (page: Page) => page.locator(".editor-status");
const publicFeatures = (page: Page) => page.locator(".publication-features li");

async function saveRevision(page: Page, message: string) {
  await page.getByLabel("Describe el cambio").fill(message);
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();
}

async function publishFromForm(page: Page, summary: string) {
  await page.locator("#publish-summary").fill(summary);
  await page.locator("#publish-consent").check();
  await publishButton(page).click();
  await expect(
    editorStatus(page).getByText(
      "Revisión publicada. Su enlace no cambiará aunque sigas editando.",
    ),
  ).toBeVisible();
  const href = await editorStatus(page)
    .getByRole("link", { name: "Abrir enlace público" })
    .getAttribute("href");
  expect(href).toMatch(/^\/es\/publications\/[0-9a-f-]{36}$/);
  return { href: href!, publicationId: href!.split("/").pop()! };
}

test("el botón de publicar se deshabilita con cambios pendientes y con rama vacía", async ({
  page,
}) => {
  await signIn(page);
  const { branchId, title } = await createBranch(page, "Publicar bloqueo");
  await openEditor(page, branchId);

  await expect(page.locator("#publish-label")).toHaveValue(title);
  await expect(publishButton(page)).toBeDisabled();
  await expect(
    page.getByText("Guarda al menos una intervención antes de publicar."),
  ).toBeVisible();

  await addDefaultCanopy(page);
  await expect(publishButton(page)).toBeDisabled();
  await expect(
    page.getByText("Guarda los cambios pendientes antes de publicar."),
  ).toBeVisible();

  await saveRevision(page, "Guardar para publicar");
  await expect(publishButton(page)).toBeEnabled();
  await expect(page.getByText("Todavía no has publicado")).toBeVisible();
});

test("valida resumen y consentimiento en el cliente", async ({ page }) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Publicar validación");
  await openEditor(page, branchId);
  await addDefaultCanopy(page);
  await saveRevision(page, "Guardar para validar");

  await publishButton(page).click();
  await expect(
    page.getByText("Escribe un resumen público de 1 a 1000 caracteres."),
  ).toBeVisible();

  await page.locator("#publish-summary").fill("Resumen válido");
  await publishButton(page).click();
  await expect(
    page.getByText("Confirma que entiendes qué se publicará."),
  ).toBeVisible();
  await expect(page.getByText("Revisión publicada.")).toHaveCount(0);
});

test("publica, abre el enlace y la página pública conserva la instantánea", async ({
  page,
}) => {
  await signIn(page);
  const { branchId, title } = await createBranch(page, "Publicar flujo");
  await openEditor(page, branchId);

  await addDefaultCanopy(page);
  await saveRevision(page, `Mensaje privado ${randomUUID().slice(0, 8)}`);
  const { href, publicationId } = await publishFromForm(
    page,
    "Sombra para la plaza",
  );

  const list = page.locator(".publications-list");
  await expect(list.getByRole("link", { name: title })).toHaveAttribute(
    "href",
    href,
  );
  await expect(
    page.getByText("Esta revisión ya está publicada."),
  ).toBeVisible();
  await expect(publishButton(page)).toBeDisabled();

  await editorStatus(page)
    .getByRole("link", { name: "Abrir enlace público" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/es/publications/${publicationId}$`),
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.locator(".publication-byline")).toHaveText(
    /^Publicada el .+ por .+/,
  );
  await expect(
    page.getByText("Esta revisión publicada es fija", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Todas las intervenciones son hipotéticas", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("Sombra para la plaza")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Intervenciones propuestas" }),
  ).toBeVisible();
  await expect(publicFeatures(page)).toHaveCount(1);
  await expect(page.locator(".publication-preview svg").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "English" })).toHaveAttribute(
    "href",
    `/en/publications/${publicationId}`,
  );

  // Seguir editando en privado no cambia la publicación.
  await openEditor(page, branchId);
  await addDefaultCanopy(page);
  await expect(featureList(page).locator("li")).toHaveCount(2);
  await saveRevision(page, "Segunda revisión privada");
  await expect(publishButton(page)).toBeEnabled();
  await expect(page.getByText("Esta revisión ya está publicada.")).toHaveCount(
    0,
  );

  await page.goto(href);
  await expect(publicFeatures(page)).toHaveCount(1);
  const publicApi = await api(page, `/api/v1/publications/${publicationId}`);
  expect(publicApi.status).toBe(200);
  expect(publicApi.body!.data.features).toHaveLength(1);
});

test("un navegador anónimo ve la página y la API sin datos privados", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  const email = process.env.FTC_PARTICIPANT_EMAIL!;
  const { branchId, title } = await createBranch(page, "Publicar anónimo");
  await openEditor(page, branchId);
  await addDefaultCanopy(page);
  const message = `Mensaje-privado-${randomUUID()}`;
  await saveRevision(page, message);
  const { publicationId } = await publishFromForm(page, "Resumen anónimo");

  const anonymous = await browser.newContext({ baseURL });
  try {
    expect(await anonymous.cookies()).toEqual([]);
    const anonPage = await anonymous.newPage();

    const response = await anonPage.goto(`/es/publications/${publicationId}`);
    expect(response!.status()).toBe(200);
    await expect(anonPage.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(publicFeatures(anonPage)).toHaveCount(1);
    const html = await anonPage.content();
    const text = await anonPage.locator("body").innerText();

    const apiResponse = await anonymous.request.get(
      `/api/v1/publications/${publicationId}`,
    );
    expect(apiResponse.status()).toBe(200);
    const apiText = await apiResponse.text();
    const apiBody = JSON.parse(apiText);
    expect(apiBody.data.publicationId).toBe(publicationId);
    expect(apiBody.data.scenario).toBe("hypothetical");
    expect(apiBody.data.label).toBe(title);
    expect(Object.keys(apiBody.data)).not.toContain("branchId");

    for (const content of [html, text, apiText]) {
      expect(content).not.toContain(email);
      expect(content).not.toContain(branchId);
      expect(content).not.toContain(message);
    }
    const emailPattern = /[\w.+-]+@[\w-]+\.[\w.-]+/;
    expect(html).not.toMatch(emailPattern);
    expect(apiText).not.toMatch(emailPattern);
  } finally {
    await anonymous.close();
  }
});

test("la segunda publicación, la repetición idempotente y el conflicto de clave", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Publicar idempotencia");
  await openEditor(page, branchId);
  await addDefaultCanopy(page);
  await saveRevision(page, "Guardar para idempotencia");

  const head = await api(page, `/api/v1/branches/${branchId}`);
  expect(head.status).toBe(200);
  const revisionId = head.body!.data.revisionId as string;
  const path = `/api/v1/revisions/${revisionId}/publish`;
  const key = randomUUID();
  const body = { label: "Etiqueta API", summary: "Resumen API" };

  const first = await api(page, path, { method: "POST", key, body });
  expect(first.status).toBe(201);
  const publicationId = first.body!.data.publicationId as string;
  expect(first.body!.data).toMatchObject({ revisionId, branchId });
  expect(typeof first.body!.data.publishedAt).toBe("string");

  const replay = await api(page, path, { method: "POST", key, body });
  expect(replay.status).toBe(201);
  expect(replay.body!.data.publicationId).toBe(publicationId);

  const conflict = await api(page, path, {
    method: "POST",
    key,
    body: { ...body, summary: "Otro resumen" },
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body!.code).toBe("idempotency_conflict");

  const second = await api(page, path, {
    method: "POST",
    key: randomUUID(),
    body,
  });
  expect(second.status).toBe(409);
  expect(second.body!.code).toBe("already_published");
  expect(second.body!.details.publicationId).toBe(publicationId);

  // El editor muestra el estado ya publicado con enlace al mismo URL.
  await page.reload();
  await expect(
    page.getByText("Esta revisión ya está publicada."),
  ).toBeVisible();
  await expect(publishButton(page)).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Abrir enlace público" }),
  ).toHaveAttribute("href", `/es/publications/${publicationId}`);
});

test("la API valida la solicitud de publicación", async ({ page }) => {
  await signIn(page);
  const { revisionId } = await createBranch(page, "Publicar API vacía");
  const path = `/api/v1/revisions/${revisionId}/publish`;

  const empty = await api(page, path, {
    method: "POST",
    key: randomUUID(),
    body: { label: "Vacía", summary: "Sin intervenciones" },
  });
  expect(empty.status).toBe(422);
  expect(empty.body!.code).toBe("empty_revision");

  const invalid = await api(page, path, {
    method: "POST",
    key: randomUUID(),
    body: { label: "", summary: "" },
  });
  expect(invalid.status).toBeGreaterThanOrEqual(400);
  expect(invalid.status).toBeLessThan(500);

  const missing = await api(page, `/api/v1/revisions/${randomUUID()}/publish`, {
    method: "POST",
    key: randomUUID(),
    body: { label: "x", summary: "y" },
  });
  expect(missing.status).toBe(404);
});

test("un id aleatorio o inválido da 404 en la API y en la página", async ({
  page,
}) => {
  const unknown = randomUUID();
  const apiUnknown = await page.request.get(`/api/v1/publications/${unknown}`);
  expect(apiUnknown.status()).toBe(404);
  expect((await apiUnknown.json()).code).toBe("publication_not_found");

  const apiInvalid = await page.request.get("/api/v1/publications/no-es-uuid");
  expect(apiInvalid.status()).toBe(404);
  expect((await apiInvalid.json()).code).toBe("publication_not_found");

  const unavailable = page.getByRole("heading", {
    level: 1,
    name: "Esta publicación no está disponible",
  });
  await page.goto(`/es/publications/${unknown}`);
  await expect(unavailable).toBeVisible();
  await expect(page.locator(".publication-features")).toHaveCount(0);

  await page.goto("/es/publications/no-es-uuid");
  await expect(unavailable).toBeVisible();
});

// Proxy checks existence before streaming starts, so the status is a real 404.
test("la página de una publicación inexistente o inválida responde HTTP 404", async ({
  page,
}) => {
  const missing = await page.goto(`/es/publications/${randomUUID()}`);
  expect(missing!.status()).toBe(404);
  const invalid = await page.goto("/en/publications/not-a-uuid");
  expect(invalid!.status()).toBe(404);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "This publication is not available",
    }),
  ).toBeVisible();
});

test("la página pública y el formulario de publicar no tienen hallazgos graves ni desbordamiento a 360 px", async ({
  page,
}) => {
  await signIn(page);
  const { branchId } = await createBranch(page, "Publicar a11y");
  await page.setViewportSize({ width: 360, height: 800 });
  await openEditor(page, branchId);
  await addDefaultCanopy(page);
  await saveRevision(page, "Guardar para a11y");

  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
  const serious = async (include?: string) => {
    const builder = new AxeBuilder({ page });
    if (include) builder.include(include);
    const results = await builder.analyze();
    return results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    );
  };

  expect(await serious(".publish-form")).toEqual([]);
  expect(await serious(".publications-list")).toEqual([]);
  expect(await overflow()).toBeLessThanOrEqual(0);

  const { href } = await publishFromForm(page, "Resumen de accesibilidad");
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.goto(href);
  await expect(publicFeatures(page)).toHaveCount(1);
  expect(await serious()).toEqual([]);
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test("la ruta en inglés muestra el texto en inglés", async ({ page }) => {
  await signIn(page);
  const { branchId, title } = await createBranch(page, "Publicar English");
  await openEditor(page, branchId);
  await addDefaultCanopy(page);
  await saveRevision(page, "Guardar para inglés");
  const { publicationId } = await publishFromForm(page, "English summary");

  await page.goto(`/en/publications/${publicationId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.locator(".publication-byline")).toHaveText(
    /^Published on .+ by .+/,
  );
  await expect(
    page.getByText("Published proposal · hypothetical"),
  ).toBeVisible();
  await expect(
    page.getByText("This published revision is fixed", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Every intervention is hypothetical", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Proposed interventions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Schematic preview" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Español" })).toHaveAttribute(
    "href",
    `/es/publications/${publicationId}`,
  );
  await expect(page.getByText("Publicada el")).toHaveCount(0);
});

test("una publicación oculta por moderación se muestra sin enlace y la página pública da 404", async ({
  page,
}) => {
  await signIn(page);
  const { branchId, title } = await createBranch(page, "Publicar oculta");
  await openEditor(page, branchId);
  await addDefaultCanopy(page);
  await saveRevision(page, "Guardar para ocultar");
  const { publicationId } = await publishFromForm(page, "Resumen a ocultar");
  expect(publicationId).toMatch(/^[0-9a-f-]{36}$/);

  // Moderación simulada desde la base de datos; argumentos como arreglo, sin shell.
  execFileSync("docker", [
    "exec",
    "supabase_db_KIROWEEN-2",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `update public.publications set moderation_state='hidden' where id='${publicationId}'`,
  ]);

  await openEditor(page, branchId);
  await expect(
    publishForm(page).getByText(
      "Esta revisión se publicó, pero moderación la ocultó. Su enlace público no está disponible.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Abrir enlace público" }),
  ).toHaveCount(0);
  await expect(publishButton(page)).toBeDisabled();

  const item = page.locator(".publications-list li");
  await expect(item).toHaveCount(1);
  await expect(item.getByRole("link")).toHaveCount(0);
  await expect(item).toContainText(title);
  await expect(item).toContainText(" · Oculta por moderación");

  const response = await page.goto(`/es/publications/${publicationId}`);
  expect(response!.status()).toBe(404);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Esta publicación no está disponible",
    }),
  ).toBeVisible();
});
