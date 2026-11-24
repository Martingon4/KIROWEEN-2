import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  api,
  createBranch,
  featureList,
  openEditor,
  revealCoordinates,
  signIn,
} from "./helpers";

const CANOPY_COORDS = [
  "-98.19825, 19.04358",
  "-98.19805, 19.04358",
  "-98.19805, 19.04372",
  "-98.19825, 19.04372",
].join("\n");
const MARKET_COORDS = [
  "-98.19820, 19.04360",
  "-98.19800, 19.04360",
  "-98.19800, 19.04370",
  "-98.19820, 19.04370",
].join("\n");
const MARKET_REDRAW = [
  "-98.19840, 19.04368",
  "-98.19828, 19.04368",
  "-98.19828, 19.04378",
  "-98.19840, 19.04378",
].join("\n");

const MERGED_FROM = "La revisión actual fusiona una propuesta publicada.";
const COMMITTED = /Fusión guardada\. La nueva revisión tiene dos padres/;

const commitButton = (page: Page) =>
  page.getByRole("button", { name: "Guardar la fusión" });
const checkButton = (page: Page) =>
  page.getByRole("button", { name: "Revisar mis decisiones" });
const visibleFeatureItems = (page: Page) =>
  page.locator(".editor-feature-list:visible li");
const conflictItems = (page: Page) => page.locator(".merge-conflict");

async function addCanopy(page: Page, label: string) {
  await page
    .getByLabel("Tipo de intervención")
    .selectOption({ label: "Cubierta de sombra" });
  await page.locator("#editor-label").fill(label);
  await page.locator("#editor-heightM").fill("4");
  await (await revealCoordinates(page)).fill(CANOPY_COORDS);
  await page.getByRole("button", { name: "Agregar a la rama" }).click();
  await expect(featureList(page)).toContainText(label);
}

async function addMarket(page: Page, label: string) {
  await page
    .getByLabel("Tipo de intervención")
    .selectOption({ label: "Mercado temporal" });
  await page.locator("#editor-label").fill(label);
  await page.locator("#editor-stallCount").fill("10");
  await page.locator("#editor-moduleM2").fill("6");
  await page.locator("#editor-timeSlot").fill("Sábados 8–14 h");
  await (await revealCoordinates(page)).fill(MARKET_COORDS);
  await page.getByRole("button", { name: "Agregar a la rama" }).click();
  await expect(featureList(page)).toContainText(label);
}

async function saveRevision(page: Page, message: string) {
  await page.getByLabel("Describe el cambio").fill(message);
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();
}

type Story = {
  canopyLabel: string;
  marketLabel: string;
  branchId: string;
  branchTitle: string;
  branchHeadId: string;
  publicationId: string;
  publicationHref: string;
};

/** Coordinator publishes B (market); participant saves branch A (canopy). */
async function setupStory(
  page: Page,
  browser: Browser,
  baseURL: string | undefined,
): Promise<Story> {
  const suffix = randomUUID().slice(0, 8);
  const canopyLabel = `Cubierta A ${suffix}`;
  const marketLabel = `Mercado B ${suffix}`;

  const coordinatorContext = await browser.newContext({ baseURL });
  let publicationId: string;
  let publicationHref: string;
  try {
    const coordinator = await coordinatorContext.newPage();
    await signIn(coordinator, "coordinator");
    const { branchId } = await createBranch(coordinator, "Propuesta B");
    await openEditor(coordinator, branchId);
    await addMarket(coordinator, marketLabel);
    await saveRevision(coordinator, "Mercado para fusionar");
    await coordinator.locator("#publish-summary").fill("Mercado temporal B");
    await coordinator.locator("#publish-consent").check();
    await coordinator
      .getByRole("form", { name: "Publicar revisión" })
      .getByRole("button", { name: "Publicar revisión" })
      .click();
    const link = coordinator
      .locator(".editor-status")
      .getByRole("link", { name: "Abrir enlace público" });
    await expect(link).toBeVisible();
    publicationHref = (await link.getAttribute("href"))!;
    expect(publicationHref).toMatch(/^\/es\/publications\/[0-9a-f-]{36}$/);
    publicationId = publicationHref.split("/").pop()!;
  } finally {
    await coordinatorContext.close();
  }

  await signIn(page);
  const branch = await createBranch(page, "Rama A");
  await openEditor(page, branch.branchId);
  await addCanopy(page, canopyLabel);
  await saveRevision(page, "Cubierta propia");
  const head = await api(page, `/api/v1/branches/${branch.branchId}`);
  expect(head.status).toBe(200);
  return {
    canopyLabel,
    marketLabel,
    branchId: branch.branchId,
    branchTitle: branch.title,
    branchHeadId: head.body!.data.revisionId as string,
    publicationId,
    publicationHref,
  };
}

async function openMergePreview(page: Page, story: Story) {
  await page.goto(story.publicationHref);
  const section = page.getByRole("region", {
    name: "Fusionar en una de mis ramas",
  });
  await expect(section).toBeVisible();
  await page.locator("#merge-branch").selectOption(story.branchId);
  await expect(page.getByLabel("Rama de destino")).toHaveValue(story.branchId);
  await section
    .getByRole("button", { name: "Previsualizar la fusión" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/es/branches/${story.branchId}/merge\\?source=${story.publicationId}$`,
    ),
  );
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Fusionar una propuesta en tu rama",
    }),
  ).toBeVisible();
}

async function expectBlockingConflict(page: Page, story: Story) {
  await expect(page.getByRole("heading", { name: "Conflictos" })).toBeVisible();
  await expect(conflictItems(page)).toHaveCount(1);
  const conflict = conflictItems(page).first();
  await expect(conflict).toContainText("ocupan la misma superficie");
  await expect(conflict).toContainText(story.canopyLabel);
  await expect(conflict).toContainText(story.marketLabel);
  await expect(conflict).toContainText("Bloquea la fusión");
  await expect(
    conflict.getByRole("group", { name: "Cómo resolver este conflicto" }),
  ).toBeVisible();
  await expect(commitButton(page)).toBeDisabled();
  await expect(
    page.getByText(
      "Resuelve todos los conflictos y revisa tus decisiones antes de guardar.",
    ),
  ).toBeVisible();
}

async function commitAndOpen(
  page: Page,
  story: Story,
  expectedFeatures: number,
) {
  await expect(commitButton(page)).toBeEnabled();
  await commitButton(page).click();
  await expect(page.getByText(COMMITTED)).toBeVisible();
  await page.getByRole("link", { name: "Abrir la rama" }).click();
  await expect(page).toHaveURL(new RegExp(`/es/branches/${story.branchId}$`));
  await expect(
    page.getByRole("heading", { name: "Agregar intervención" }),
  ).toBeVisible();
  // Next conserva la página anterior oculta: solo cuenta la lista visible.
  await expect(visibleFeatureItems(page)).toHaveCount(expectedFeatures);
  await expect(page.getByText(MERGED_FROM)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Ver la propuesta fusionada" }),
  ).toHaveAttribute("href", `/es/publications/${story.publicationId}`);
}

test("historia: fusiona la propuesta B redibujando el mercado", async ({
  page,
  browser,
  baseURL,
}) => {
  const story = await setupStory(page, browser, baseURL);
  await openMergePreview(page, story);
  await expectBlockingConflict(page, story);

  const result = page.getByRole("region", { name: "Resultado de la fusión" });
  await expect(result.locator("svg").first()).toBeVisible();
  await expect(result).toContainText(story.canopyLabel);
  await expect(result).toContainText("de tu rama");
  await expect(result).toContainText(story.marketLabel);
  await expect(result).toContainText("de la propuesta");

  await page
    .getByRole("radio", { name: `Redibujar «${story.marketLabel}»` })
    .check();
  const textarea = page.getByLabel(
    `Coordenadas nuevas de «${story.marketLabel}»: longitud, latitud`,
  );
  await expect(textarea).toBeVisible();
  await textarea.fill(MARKET_REDRAW);
  await expect(commitButton(page)).toBeDisabled();
  await checkButton(page).click();

  await expect(page.getByText("Decisiones revisadas.")).toBeVisible();
  await expect(conflictItems(page).first()).toContainText("Resuelto:");
  await expect(conflictItems(page).first()).not.toContainText(
    "Bloquea la fusión",
  );
  await expect(result).toContainText("resuelto por ti");
  await commitAndOpen(page, story, 2);
  await expect(
    visibleFeatureItems(page).filter({ hasText: story.canopyLabel }),
  ).toHaveCount(1);
  await expect(
    visibleFeatureItems(page).filter({ hasText: story.marketLabel }),
  ).toHaveCount(1);
});

test("historia: fusiona retirando la cubierta propia", async ({
  page,
  browser,
  baseURL,
}) => {
  const story = await setupStory(page, browser, baseURL);
  await openMergePreview(page, story);
  await expectBlockingConflict(page, story);

  await page
    .getByRole("radio", { name: `Retirar «${story.canopyLabel}»` })
    .check();
  await expect(commitButton(page)).toBeDisabled();
  await checkButton(page).click();
  await expect(page.getByText("Decisiones revisadas.")).toBeVisible();
  await expect(conflictItems(page).first()).toContainText("Resuelto:");

  await commitAndOpen(page, story, 1);
  await expect(
    visibleFeatureItems(page).filter({ hasText: story.marketLabel }),
  ).toHaveCount(1);
  await expect(
    visibleFeatureItems(page).filter({ hasText: story.canopyLabel }),
  ).toHaveCount(0);
});

test("la API de fusión: vista previa, conflictos, versión obsoleta e idempotencia", async ({
  page,
  browser,
  baseURL,
}) => {
  const story = await setupStory(page, browser, baseURL);
  const previewPath = `/api/v1/branches/${story.branchId}/merge/preview`;
  const commitPath = `/api/v1/branches/${story.branchId}/merge/commit`;

  const preview = await api(page, previewPath, {
    method: "POST",
    key: randomUUID(),
    body: { sourcePublicationId: story.publicationId },
  });
  expect(preview.status).toBe(200);
  const data = preview.body!.data;
  expect(data.headRevisionId).toBe(story.branchHeadId);
  expect(data.conflicts).toHaveLength(1);
  expect(data.conflicts[0].type).toBe("exclusive_overlap");
  expect(data.conflicts[0].blocking).toBe(true);
  expect(data.unresolved).toEqual([data.conflicts[0].id]);
  const conflict = data.conflicts[0] as {
    id: string;
    featureIds: string[];
    kinds: string[];
    intersectionM2: number;
  };
  expect(conflict.intersectionM2).toBeGreaterThan(100);
  const marketId =
    conflict.featureIds[conflict.kinds.indexOf("temporary_market")];
  expect(marketId).toBeTruthy();

  const unresolved = await api(page, commitPath, {
    method: "POST",
    key: randomUUID(),
    body: {
      sourcePublicationId: story.publicationId,
      expectedHeadId: story.branchHeadId,
      message: "Sin resolver",
      resolutions: [],
    },
  });
  expect(unresolved.status).toBe(422);
  expect(unresolved.body!.code).toBe("unresolved_conflicts");
  expect(unresolved.body!.details.conflictIds).toEqual([conflict.id]);

  const resolutions = [
    { conflictId: conflict.id, action: "remove", featureId: marketId },
  ];
  const stale = await api(page, commitPath, {
    method: "POST",
    key: randomUUID(),
    body: {
      sourcePublicationId: story.publicationId,
      expectedHeadId: randomUUID(),
      message: "Cabeza vieja",
      resolutions,
    },
  });
  expect(stale.status).toBe(409);
  expect(stale.body!.code).toBe("stale_head");
  expect(stale.body!.details.currentHeadId).toBe(story.branchHeadId);

  const key = randomUUID();
  const body = {
    sourcePublicationId: story.publicationId,
    expectedHeadId: story.branchHeadId,
    message: "Fusión por API",
    resolutions,
  };
  const first = await api(page, commitPath, { method: "POST", key, body });
  expect(first.status).toBe(201);
  expect(first.body!.data).toMatchObject({
    branchId: story.branchId,
    parentRevisionId: story.branchHeadId,
    sourcePublicationId: story.publicationId,
    featureCount: 1,
    conflictCount: 1,
  });

  const replay = await api(page, commitPath, { method: "POST", key, body });
  expect(replay.status).toBe(201);
  expect(replay.body!.data.revisionId).toBe(first.body!.data.revisionId);

  const again = await api(page, commitPath, {
    method: "POST",
    key: randomUUID(),
    body: {
      ...body,
      expectedHeadId: first.body!.data.revisionId,
      resolutions: [],
    },
  });
  expect(again.status).toBe(422);
  expect(again.body!.code).toBe("already_merged");
});

test("la API de fusión exige sesión y origen permitido", async ({
  browser,
  baseURL,
}) => {
  const anonymous = await browser.newContext({ baseURL });
  try {
    const path = `/api/v1/branches/${randomUUID()}/merge/preview`;
    const data = { sourcePublicationId: randomUUID() };
    const noOrigin = await anonymous.request.post(path, {
      headers: { "Idempotency-Key": randomUUID() },
      data,
    });
    expect(noOrigin.status()).toBe(403);
    const response = await anonymous.request.post(path, {
      headers: { "Idempotency-Key": randomUUID(), Origin: baseURL! },
      data,
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe("authentication_required");
  } finally {
    await anonymous.close();
  }
});

async function tabTo(page: Page, target: Locator, maxTabs = 120) {
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press("Tab");
    const focused = await target.evaluateAll((els) =>
      els.some((el) => el === document.activeElement),
    );
    if (focused) return;
  }
  throw new Error("No se alcanzó el elemento con Tab");
}

test("teclado: radios, textarea y revisión funcionan sin ratón", async ({
  page,
  browser,
  baseURL,
}) => {
  const story = await setupStory(page, browser, baseURL);
  await openMergePreview(page, story);
  await expectBlockingConflict(page, story);

  const group = conflictItems(page).first().getByRole("radio");
  await expect(group).toHaveCount(4);
  const redraw = page.getByRole("radio", {
    name: `Redibujar «${story.marketLabel}»`,
  });

  // Tab llega al grupo de radios; las flechas cambian la opción marcada.
  await tabTo(page, group);
  for (let i = 0; i < 4 && !(await redraw.isChecked()); i += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(redraw).toBeChecked();
  await expect(redraw).toBeFocused();

  const textarea = page.getByLabel(
    `Coordenadas nuevas de «${story.marketLabel}»: longitud, latitud`,
  );
  await tabTo(page, textarea, 5);
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(MARKET_REDRAW);
  await expect(textarea).toHaveValue(MARKET_REDRAW);

  const check = checkButton(page);
  await tabTo(page, check, 5);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Decisiones revisadas.")).toBeVisible();
  await expect(conflictItems(page).first()).toContainText("Resuelto:");
  await expect(commitButton(page)).toBeEnabled();

  // Barra espaciadora sobre el mismo botón.
  await check.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Decisiones revisadas.")).toBeVisible();
  await expect(commitButton(page)).toBeEnabled();
});

test("la página de fusión es accesible y cabe en 360 px", async ({
  page,
  browser,
  baseURL,
}) => {
  const story = await setupStory(page, browser, baseURL);
  await page.setViewportSize({ width: 360, height: 800 });
  await openMergePreview(page, story);
  await expectBlockingConflict(page, story);

  const serious = async () =>
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    );
  expect(await serious()).toEqual([]);
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);

  // Con el textarea de redibujo abierto y tras revisar también debe cumplir.
  await page
    .getByRole("radio", { name: `Redibujar «${story.marketLabel}»` })
    .check();
  await page
    .getByLabel(
      `Coordenadas nuevas de «${story.marketLabel}»: longitud, latitud`,
    )
    .fill(MARKET_REDRAW);
  await checkButton(page).click();
  await expect(page.getByText("Decisiones revisadas.")).toBeVisible();
  expect(await serious()).toEqual([]);
  expect(await overflow()).toBeLessThanOrEqual(0);

  const box = await commitButton(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
