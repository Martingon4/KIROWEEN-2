import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addDefaultCanopy,
  api,
  createBranch,
  featureList,
  localSupabaseDbContainer,
  openEditor,
  signIn,
} from "./helpers";

const FORKED_FROM = "Esta rama se bifurcó de una publicación pública.";
const SOURCE_GONE =
  "Esta rama se bifurcó de una publicación que ya no está disponible.";
const forkSection = (page: Page) =>
  page.getByRole("region", { name: "Bifurcar esta propuesta" });
const forkTitleInput = (page: Page) => page.getByLabel("Nombre de tu rama");
const forkSubmit = (page: Page) =>
  page.getByRole("button", { name: "Crear mi copia privada" });

async function publishNewProposal(page: Page, label: string) {
  const { branchId, title } = await createBranch(page, label);
  await openEditor(page, branchId);
  await addDefaultCanopy(page);
  await page.getByLabel("Describe el cambio").fill("Guardar para bifurcar");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();
  await page.locator("#publish-summary").fill("Resumen para bifurcar");
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
  expect(href).toMatch(/^\/es\/publications\/[0-9a-f-]{36}$/);
  return { title, branchId, publicationId: href.split("/").pop()!, href };
}

// Moderación simulada desde la base de datos; argumentos como arreglo, sin shell.
function setModeration(publicationId: string, state: "hidden" | "visible") {
  expect(publicationId).toMatch(/^[0-9a-f-]{36}$/);
  execFileSync("docker", [
    "exec",
    localSupabaseDbContainer(),
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `update public.publications set moderation_state='${state}' where id='${publicationId}'`,
  ]);
}

test("otra persona bifurca una publicación y llega al editor con procedencia", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  const { title, publicationId, href } = await publishNewProposal(
    page,
    "Bifurcar flujo",
  );
  const other = await browser.newContext({ baseURL });
  try {
    const pageB = await other.newPage();
    await signIn(pageB, "coordinator");
    await pageB.goto(href);
    await expect(forkSection(pageB)).toBeVisible();
    await expect(forkTitleInput(pageB)).toHaveValue(`Alternativa a «${title}»`);
    await forkTitleInput(pageB).fill(`Mi copia ${randomUUID().slice(0, 8)}`);
    await forkSubmit(pageB).click();
    await expect(pageB).toHaveURL(/\/es\/branches\/[0-9a-f-]{36}$/);
    await expect(
      pageB.getByRole("heading", { name: "Agregar intervención" }),
    ).toBeVisible();
    await expect(featureList(pageB).locator("li")).toHaveCount(1);
    await expect(featureList(pageB)).toContainText("Cubierta de sombra");
    await expect(pageB.getByText(FORKED_FROM)).toBeVisible();
    await expect(
      pageB.getByRole("link", { name: "Ver la publicación de origen" }),
    ).toHaveAttribute("href", `/es/publications/${publicationId}`);
    await expect(pageB.getByText(SOURCE_GONE)).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test("un navegador anónimo que bifurca es enviado a iniciar sesión con returnTo", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  const { publicationId, href } = await publishNewProposal(
    page,
    "Bifurcar anónimo",
  );
  const anonymous = await browser.newContext({ baseURL });
  try {
    const anonPage = await anonymous.newPage();
    await anonPage.goto(href);
    await expect(forkSection(anonPage)).toBeVisible();
    await forkSubmit(anonPage).click();
    await expect(anonPage).toHaveURL(/\/es\/auth\/sign-in\?/);
    const url = new URL(anonPage.url());
    expect(url.pathname).toBe("/es/auth/sign-in");
    expect(url.searchParams.get("returnTo")).toBe(
      `/es/publications/${publicationId}`,
    );
    // No se creó ninguna rama: las cookies siguen vacías de sesión.
    expect(await anonymous.cookies()).toEqual([]);
  } finally {
    await anonymous.close();
  }
});

test("la API de bifurcación: creación, repetición idempotente y errores", async ({
  page,
  baseURL,
}) => {
  await signIn(page);
  const { publicationId, title } = await publishNewProposal(
    page,
    "Bifurcar API",
  );
  const key = randomUUID();
  const body = { sourcePublicationId: publicationId, title: `Fork ${title}` };

  const first = await page.request.post("/api/v1/branches", {
    headers: { "Idempotency-Key": key, Origin: baseURL! },
    data: body,
  });
  expect(first.status()).toBe(201);
  const firstJson = await first.json();
  expect(firstJson.data).toMatchObject({
    sourcePublicationId: publicationId,
    featureCount: 1,
    title: body.title,
  });
  expect(first.headers()["location"]).toContain(firstJson.data.branchId);

  const replay = await api(page, "/api/v1/branches", {
    method: "POST",
    key,
    body,
  });
  expect(replay.status).toBe(201);
  expect(replay.body!.data.branchId).toBe(firstJson.data.branchId);

  const conflict = await api(page, "/api/v1/branches", {
    method: "POST",
    key,
    body: { ...body, title: "Otro título" },
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body!.code).toBe("idempotency_conflict");

  const both = await api(page, "/api/v1/branches", {
    method: "POST",
    key: randomUUID(),
    body: {
      siteId: "8f5a6417-5f6d-4f02-a50c-76d97167db99",
      sourcePublicationId: publicationId,
      title: "Ambos",
    },
  });
  expect(both.status).toBe(422);
  expect(both.body!.code).toBe("invalid_branch");

  const blank = await api(page, "/api/v1/branches", {
    method: "POST",
    key: randomUUID(),
    body: { sourcePublicationId: publicationId, title: "   " },
  });
  expect(blank.status).toBe(422);
  expect(blank.body!.code).toBe("invalid_branch");

  const unknown = await api(page, "/api/v1/branches", {
    method: "POST",
    key: randomUUID(),
    body: { sourcePublicationId: randomUUID(), title: "Fantasma" },
  });
  expect(unknown.status).toBe(404);
  expect(unknown.body!.code).toBe("publication_not_found");

  setModeration(publicationId, "hidden");
  const hidden = await api(page, "/api/v1/branches", {
    method: "POST",
    key: randomUUID(),
    body: { sourcePublicationId: publicationId, title: "Oculta" },
  });
  expect(hidden.status).toBe(404);
  expect(hidden.body!.code).toBe("publication_not_found");
});

test("la API de bifurcación exige origen permitido y sesión", async ({
  browser,
  baseURL,
}) => {
  const anonymous = await browser.newContext({ baseURL });
  try {
    const data = { sourcePublicationId: randomUUID(), title: "Sin sesión" };
    const noOrigin = await anonymous.request.post("/api/v1/branches", {
      headers: { "Idempotency-Key": randomUUID() },
      data,
    });
    expect(noOrigin.status()).toBe(403);
    const response = await anonymous.request.post("/api/v1/branches", {
      headers: { "Idempotency-Key": randomUUID(), Origin: baseURL! },
      data,
    });
    expect(response.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});

test("si la publicación de origen se oculta, el editor lo indica sin enlace", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  const { publicationId, href } = await publishNewProposal(
    page,
    "Bifurcar oculta",
  );
  const other = await browser.newContext({ baseURL });
  try {
    const pageB = await other.newPage();
    await signIn(pageB, "coordinator");
    await pageB.goto(href);
    await forkSubmit(pageB).click();
    await expect(pageB).toHaveURL(/\/es\/branches\/[0-9a-f-]{36}$/);
    await expect(pageB.getByText(FORKED_FROM)).toBeVisible();
    const editorUrl = pageB.url();

    setModeration(publicationId, "hidden");
    await pageB.goto(editorUrl);
    await expect(
      pageB.getByRole("heading", { name: "Agregar intervención" }),
    ).toBeVisible();
    await expect(pageB.getByText(SOURCE_GONE)).toBeVisible();
    await expect(pageB.getByText(FORKED_FROM)).toHaveCount(0);
    await expect(
      pageB.getByRole("link", { name: "Ver la publicación de origen" }),
    ).toHaveCount(0);
    await expect(featureList(pageB).locator("li")).toHaveCount(1);
  } finally {
    await other.close();
  }
});

test("el formulario de bifurcar es accesible, cabe en 360 px y funciona con teclado", async ({
  page,
}) => {
  await signIn(page);
  const { href } = await publishNewProposal(page, "Bifurcar a11y");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(href);
  await expect(forkSection(page)).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include(".publication-fork")
    .analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);

  // Tamaño mínimo de objetivo táctil del botón de envío.
  const box = await forkSubmit(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // El campo de nombre es alcanzable con Tab y Enter envía el formulario.
  let reached = false;
  for (let i = 0; i < 60 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = await forkTitleInput(page).evaluate(
      (element) => element === document.activeElement,
    );
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(`Teclado ${randomUUID().slice(0, 8)}`);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/es\/branches\/[0-9a-f-]{36}$/);
  await expect(page.getByText(FORKED_FROM)).toBeVisible();
});

const BLANK_TITLE_ERROR =
  "Escribe un nombre de 1 a 100 caracteres para tu rama.";
// Cuenta ramas bifurcadas de una publicación concreta. Otros trabajadores en
// paralelo crean ramas con la misma cuenta, así que no se compara la lista global.
function forksOf(publicationId: string): number {
  expect(publicationId).toMatch(/^[0-9a-f-]{36}$/);
  const out = execFileSync("docker", [
    "exec",
    localSupabaseDbContainer(),
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `select count(*) from public.branches where source_publication_id='${publicationId}'`,
  ]);
  return Number(out.toString().trim());
}

test("un nombre en blanco vuelve a la publicación con alerta y no crea rama", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  const { href, publicationId } = await publishNewProposal(
    page,
    "Bifurcar vacío",
  );
  expect(forksOf(publicationId)).toBe(0);
  const other = await browser.newContext({ baseURL });
  try {
    const pageB = await other.newPage();
    await signIn(pageB, "coordinator");
    await pageB.goto(href);
    await forkTitleInput(pageB).fill("     ");
    await forkSubmit(pageB).click();
    await expect(pageB).toHaveURL(
      /\/es\/publications\/[0-9a-f-]{36}\?error=invalid_title$/,
    );
    await expect(pageB.locator("p.field-error[role=alert]")).toHaveText(
      BLANK_TITLE_ERROR,
    );
    await expect(forkSection(pageB)).toBeVisible();

    expect(forksOf(publicationId)).toBe(0);
  } finally {
    await other.close();
  }
});

test("un formulario ya renderizado cuyo origen se oculta lleva a publicación no disponible", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  const { publicationId, href } = await publishNewProposal(
    page,
    "Bifurcar obsoleto",
  );
  const other = await browser.newContext({ baseURL });
  try {
    const pageB = await other.newPage();
    await signIn(pageB, "coordinator");
    await pageB.goto(href);
    await expect(forkSection(pageB)).toBeVisible();

    setModeration(publicationId, "hidden");
    await forkSubmit(pageB).click();
    await expect(pageB).toHaveURL(/\/es\/publication-unavailable$/);
    await expect(
      pageB.getByRole("heading", {
        name: "Esta publicación no está disponible",
      }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});
