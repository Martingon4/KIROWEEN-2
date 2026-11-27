import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

test("traza un terreno, compara dos alternativas y recupera el diseño local", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 19.043675, longitude: -98.198094 });
  await page.goto("/es");
  await page.getByRole("link", { name: "Diseñar en mi terreno" }).click();

  await page.getByLabel("Elegir foto").setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN8sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const plan = page.getByRole("img", { name: /Plano esquemático/ });
  await expect(plan.locator("image")).toHaveAttribute("href", /^blob:/);
  await page.getByRole("button", { name: "Quitar foto" }).click();

  await plan.scrollIntoViewIfNeeded();
  const { width, height } = (await plan.boundingBox())!;
  for (const [x, y] of [
    [0.2, 0.2],
    [0.75, 0.2],
    [0.75, 0.75],
    [0.2, 0.75],
  ]) {
    await plan.click({ position: { x: width * x, y: height * y } });
  }
  await expect(page.getByText("Esquinas marcadas: 4")).toBeVisible();
  await page
    .getByText("Ajustar medidas, ubicación y horario", { exact: true })
    .click();
  await page.getByLabel("Longitud real del primer lado en metros").fill("24");
  await page.getByRole("button", { name: "Usar mi ubicación" }).click();
  await expect(page.getByLabel("Latitud", { exact: true })).toHaveValue(
    "19.043675",
  );
  await page
    .getByLabel("Diferencia con UTC en horas", { exact: false })
    .fill("-6");
  await page.getByLabel("Fecha", { exact: true }).fill("2027-03-20");
  await page.getByRole("button", { name: "Abrir simulación 3D" }).click();

  await expect(
    page.getByRole("heading", { name: "Simulación del terreno" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cubierta", exact: true }).click();
  const add = page.getByRole("button", { name: "Agregar objeto" });
  await add.press("ArrowRight");
  await add.press("Enter");
  await expect(page.locator(".shade-footprint")).toHaveCount(1);

  await page
    .getByRole("combobox", { name: "Alternativa", exact: true })
    .selectOption("b");
  await expect(page.locator(".shade-footprint")).toHaveCount(0);
  await page.getByRole("button", { name: "Árbol", exact: true }).click();
  await add.click();
  await expect(
    page.getByRole("spinbutton", { name: /1\. Árbol/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Guardar en este navegador" }).click();
  await expect(
    page.getByText("Terreno y alternativas guardados en este navegador."),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Abrir diseño guardado" }).click();
  await expect(
    page.getByRole("spinbutton", { name: /1\. Cubierta/ }),
  ).toBeVisible();
  await expect(page.locator(".shade-ground-photo")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Alternativa", exact: true })
    .selectOption("b");
  await expect(
    page.getByRole("spinbutton", { name: /1\. Árbol/ }),
  ).toBeVisible();
  await expect(page.locator(".shade-footprint")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBe(0);
});

test("el patio hipotético en inglés conserva el árbol al cambiar a una hora sin sol", async ({
  page,
}) => {
  await page.goto("/en/terrain");
  await page.getByRole("button", { name: "Try a sample patio" }).click();
  await expect(page.getByText(/Hypothetical example/)).toBeVisible();
  await page.getByRole("button", { name: "Add object" }).click();
  await expect(page.locator(".shade-footprint")).toHaveCount(1);
  await page.getByLabel("Site time", { exact: true }).fill("22:00");
  await expect(page.getByText(/The sun is less than 10°/)).toBeVisible();
  await expect(page.locator(".shade-footprint")).toHaveCount(0);
  await expect(
    page.getByRole("spinbutton", { name: /1\. Tree/ }),
  ).toBeVisible();
});

test("coloca mobiliario con teclado, inclina la vista 3D y recupera los objetos", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/en/terrain");
  await page.getByRole("button", { name: "Try a sample patio" }).click();
  const perspective = page.getByRole("button", {
    name: "3D perspective",
    exact: true,
  });
  const scene = page.locator("canvas.terrain-perspective-canvas");
  const pixels = () =>
    scene.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await perspective.click();
  await expect.poll(async () => (await pixels()).length).toBeGreaterThan(10000);
  const empty = await pixels();
  await page.getByRole("button", { name: /edit in plan/i }).click();
  const add = page.getByRole("button", { name: "Add object" });
  await page.getByRole("button", { name: "Bench", exact: true }).click();
  await add.press("Enter");
  await page.getByRole("button", { name: "Planter", exact: true }).click();
  for (let i = 0; i < 4; i++) await add.press("ArrowRight");
  await add.press("Enter");
  const bench = page.getByRole("spinbutton", { name: /1\. Bench/ });
  const planter = page.getByRole("spinbutton", { name: /2\. Planter/ });
  await expect(bench).toHaveValue("0.95");
  await expect(planter).toHaveValue("0.7");
  await expect(page.locator(".shade-footprint")).toHaveCount(0);
  await perspective.click();
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute("data-detail-models", /bench.*planter/, {
    timeout: 45000,
  });
  await expect(page.getByLabel("Object to focus on").locator("option")).toHaveText([
    "Overview",
    "1. Bench",
    "2. Planter",
  ]);
  await expect.poll(pixels).not.toBe(empty);
  const eyeLevel = await pixels();
  await scene.press("ArrowUp");
  await expect.poll(pixels).not.toBe(eyeLevel);
  await expect(
    page.getByRole("combobox", { name: "Camera height" }),
  ).toHaveValue("custom");

  await page.getByRole("button", { name: "Save in this browser" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Open saved design" }).click();
  await expect(bench).toHaveValue("0.95");
  await expect(planter).toHaveValue("0.7");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBe(0);
});

test("agrega objetos del catálogo, evita cruces y reubica sin coordenadas", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/es/terrain");
  await page.getByRole("button", { name: /patio de ejemplo/i }).click();
  await expect(page.locator(".shade-object-source")).toHaveCount(18);
  const category = page.getByLabel("Objetos por categoría");
  await category.selectOption("activity");
  await expect(page.locator(".shade-object-source")).toHaveCount(6);
  await page
    .getByRole("button", { name: "Puesto de mercado", exact: true })
    .click();
  const add = page.getByRole("button", { name: "Agregar objeto" });
  await add.press("Enter");
  await expect(
    page.getByRole("spinbutton", { name: /1\. Puesto de mercado/ }),
  ).toHaveValue("2.53");

  await category.selectOption("shade");
  await page.getByRole("button", { name: "Árbol", exact: true }).click();
  await add.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: /espacio ya está ocupado/ }),
  ).toBeVisible();
  await expect(page.locator(".shade-object-list li")).toHaveCount(1);

  await page
    .getByRole("button", { name: "Reubicar 1. Puesto de mercado" })
    .click();
  const confirm = page.getByRole("button", { name: "Confirmar ubicación" });
  await expect(confirm).toBeFocused();
  for (let i = 0; i < 4; i++) await confirm.press("ArrowRight");
  await confirm.press("Enter");
  await page.getByRole("button", { name: "Sombrilla", exact: true }).click();
  for (let i = 0; i < 4; i++) await add.press("ArrowLeft");
  await add.press("Enter");
  await expect(
    page.getByRole("spinbutton", { name: /2\. Sombrilla/ }),
  ).toBeVisible();
  await expect(page.locator(".shade-footprint")).toHaveCount(2);

  await page.getByRole("button", { name: "Revisar en 3D" }).click();
  await expect(
    page.locator("canvas.terrain-perspective-canvas"),
  ).toHaveAttribute("data-detail-models", /stall/, { timeout: 45000 });
  await expect(
    page.getByRole("button", { name: "Enfocar modelos" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Guardar en este navegador" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Abrir diseño guardado" }).click();
  await expect(page.locator(".shade-object-list li")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBe(0);
});

test("el plano cenital admite arrastre y teclado con los objetos nuevos", async ({
  page,
}) => {
  await page.goto("/es/terrain");
  await page.getByRole("button", { name: /patio de ejemplo/i }).click();
  await page.getByLabel("Objetos por categoría").selectOption("access");
  const catalog = page.locator(".terrain-catalog-tiles");
  await expect(catalog.getByRole("button")).toHaveCount(2);
  const ramp = catalog.getByRole("button", { name: "Rampa" });
  await expect(ramp).toContainText("1,4 × 3,2 m");
  await expect
    .poll(async () =>
      ramp.locator("canvas").evaluate((node) => {
        const canvas = node as HTMLCanvasElement;
        const ctx = canvas.getContext("2d")!;
        return ctx
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.some((value) => value > 0);
      }),
    )
    .toBe(true);

  const plan = page.getByRole("img", {
    name: "Plano del terreno con objetos y sombras modeladas",
  });
  await expect(plan).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const points = await ramp.evaluate((node) => {
    const ground = document.querySelector<SVGPathElement>(
      ".shade-scene-ground",
    )!;
    function source() {
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    function pointOnPlan() {
      const position = new DOMPoint(6, 5).matrixTransform(
        ground.getScreenCTM()!,
      );
      return { x: position.x, y: position.y };
    }
    window.scrollBy({
      top: (source().y + pointOnPlan().y - innerHeight) / 2,
      behavior: "instant",
    });
    const start = source();
    const target = pointOnPlan();
    return {
      start,
      target,
      sourceVisible: node.contains(document.elementFromPoint(start.x, start.y)),
      targetVisible: document.elementFromPoint(target.x, target.y) === ground,
    };
  });
  expect(points).toMatchObject({ sourceVisible: true, targetVisible: true });
  const { start, target } = points;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText("Se agregó Rampa.")).toBeVisible();
  await catalog.getByRole("button", { name: "Bolardo" }).press("Enter");
  const add = page.getByRole("button", { name: "Agregar objeto" });
  for (let i = 0; i < 3; i++) await add.press("ArrowRight");
  await add.press("Enter");
  await expect(
    page.getByRole("spinbutton", { name: /2\. Bolardo/ }),
  ).toHaveValue("0.85");
  await page.getByRole("button", { name: "Guardar en este navegador" }).click();
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("fork-the-city.terrain.v1")!).alternatives
        .a,
  );
  expect(saved[0].kind).toBe("ramp");
  expect(saved[0].coordinates[0]).toBeCloseTo(6, 1);
  expect(saved[0].coordinates[1]).toBeCloseTo(-5, 1);
});

test("muestra calles y edificios al activar la consulta de OpenStreetMap", async ({
  page,
}) => {
  const endpoint = "https://overpass-api.de/api/interpreter?*";
  let requests = 0;
  await page.route(endpoint, async (route) => {
    requests++;
    const query = new URL(route.request().url()).searchParams.get("data");
    expect(query).toContain("way[building]");
    expect(query).toContain("way[highway]");
    await route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        elements: [
          {
            tags: { building: "yes", "building:levels": "3" },
            geometry: [
              { lat: 19.0438, lon: -98.1986 },
              { lat: 19.0438, lon: -98.1984 },
              { lat: 19.044, lon: -98.1984 },
              { lat: 19.044, lon: -98.1986 },
              { lat: 19.0438, lon: -98.1986 },
            ],
          },
          {
            tags: { highway: "residential" },
            geometry: [
              { lat: 19.0435, lon: -98.1988 },
              { lat: 19.0435, lon: -98.1978 },
            ],
          },
        ],
      },
    });
  });
  await page.goto("/en/terrain");
  await page.getByRole("button", { name: "Try a sample patio" }).click();
  await page
    .getByRole("button", { name: "3D perspective", exact: true })
    .click();
  expect(requests).toBe(0);
  await page
    .getByRole("button", { name: "Show streets and buildings" })
    .click();
  const scene = page.locator("canvas.terrain-perspective-canvas");
  await expect(scene).toHaveAttribute("data-context-buildings", "1");
  await expect(scene).toHaveAttribute("data-context-routes", "1");
  await expect(
    page.getByRole("link", { name: "© OpenStreetMap" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Hide streets and buildings" })
    .click();
  await expect(scene).not.toHaveAttribute("data-context-buildings", /.+/);
  expect(requests).toBe(1);
});

test("conserva el recorte del Zócalo cuando Overpass responde con error", async ({
  page,
}) => {
  await page.route("https://overpass-api.de/api/interpreter?*", (route) =>
    route.fulfill({
      status: 503,
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.goto("/en/terrain");
  await page.getByRole("button", { name: "Try a sample patio" }).click();
  await page
    .getByRole("button", { name: "3D perspective", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show streets and buildings" })
    .click();
  await expect(
    page.getByText(/Local extract of the Zócalo de Puebla/),
  ).toBeVisible();
  const scene = page.locator("canvas.terrain-perspective-canvas");
  await expect(scene).toHaveAttribute("data-context-buildings", /^[1-9]\d*$/);
  await expect(scene).toHaveAttribute("data-context-routes", /^[1-9]\d*$/);
  await expect(
    page.getByRole("button", { name: "Start auto-rotation" }),
  ).toBeEnabled();
});

test("dos fotos de igual tamaño generan contornos y módulos distintos", async ({ page }) => {
  await page.route("**/terrain-model/depth-anything-v2-small.onnx", (route) =>
    route.fulfill({ status: 404 }),
  );
  const observed = [];
  for (const floor of ["M25 80H475V283H25Z", "M25 80H215V182H475V283H25Z"]) {
    await page.goto("/es/terrain");
    await page.getByLabel("Elegir foto").setInputFiles({
      name: "patio.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="500" height="300" fill="#335a70"/><path fill="#af997e" d="${floor}"/></svg>`,
      ),
    });
    await expect(page.getByText(/Contorno sugerido a partir del suelo visible/)).toBeVisible();
    const outline = await page.getByRole("img", { name: /Plano esquemático a partir/ })
      .locator("polygon").getAttribute("points");
    await page.getByRole("button", { name: "Abrir simulación 3D" }).click();
    await page.getByRole("combobox", { name: "Alternativa", exact: true }).selectOption("a");
    const dimensions = page.getByText(/Huella del módulo construido/);
    await expect(dimensions).toBeVisible();
    observed.push({ outline, dimensions: await dimensions.innerText() });
  }
  expect(observed[0].outline).not.toBe(observed[1].outline);
  expect(observed[0].dimensions).not.toBe(observed[1].dimensions);
  await page.getByRole("button", { name: "Volver al contorno y la ubicación" }).click();
  await page.getByText("Ajustar medidas, ubicación y horario", { exact: true }).click();
  await page.getByLabel("Longitud real del primer lado en metros").fill("1");
  await page.getByLabel(/Fondo real del terreno/).fill("5");
  await page.getByRole("button", { name: "Abrir simulación 3D" }).click();
  await expect(page.getByText(/El espacio disponible no admite una construcción del catálogo/)).toBeVisible();
});

test("ofrece las dos construcciones desde una foto también en inglés", async ({ page }) => {
  await page.route("**/terrain-model/depth-anything-v2-small.onnx", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto("/en/terrain");
  await page.getByLabel("Choose photo").setInputFiles({
    name: "site.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="500" height="300" fill="#567f9a"/><rect x="30" y="95" width="440" height="190" fill="#72984d"/></svg>'),
  });
  await expect(page.getByText(/Suggested outline from the visible ground/)).toBeVisible();
  await page.getByRole("button", { name: "Open 3D simulation" }).click();
  await expect(page.locator(".shade-object-list li").first()).toContainText("Community room module");
  await page.getByRole("combobox", { name: "Alternative", exact: true }).selectOption("b");
  await expect(page.locator(".shade-object-list li").first()).toContainText("Public pavilion");
});

test("ajusta una construcción a la foto y recalcula al reservar un paso", async ({
  page,
}) => {
  await page.goto("/es/terrain");
  await page.getByLabel("Elegir foto").setInputFiles({
    name: "patio.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN8sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByRole("img", { name: /Plano esquemático a partir/ })).toBeVisible();
  await page.getByRole("button", { name: "Abrir simulación 3D" }).click();
  await expect(
    page.getByText(/Dos propuestas de construcción hipotéticas listas/),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Alternativa", exact: true }).selectOption("a");
  const perspective = page.getByRole("img", {
    name: /Perspectiva del terreno/,
  });
  await expect(perspective).toBeVisible();
  const pixels = () =>
    perspective.evaluate(
      (node) => (node as HTMLCanvasElement).toDataURL().length,
    );
  await expect.poll(pixels).toBeGreaterThan(10000);
  const previous = await pixels();
  await expect(page.getByRole("slider")).toHaveCount(0);
  await perspective.scrollIntoViewIfNeeded();
  const box = (await perspective.boundingBox())!;
  const midY = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 3, midY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, midY, { steps: 8 });
  await page.mouse.up();
  await expect.poll(pixels).not.toBe(previous);
  const orbit = await pixels();
  await perspective.press("ArrowRight");
  await expect.poll(pixels).not.toBe(orbit);
  const camera = page.getByRole("combobox", { name: "Altura de la cámara" });
  await camera.selectOption("high");
  await page
    .getByRole("combobox", { name: "Alternativa", exact: true })
    .selectOption("b");
  await expect(camera).toHaveValue("high");
  await page
    .getByRole("combobox", { name: "Alternativa", exact: true })
    .selectOption("a");
  await page.getByRole("button", { name: "Editar en planta" }).click();
  await expect(page.locator(".shade-ground-photo")).toHaveCount(0);
  await expect(page.getByText(/Escala aproximada/)).toBeVisible();
  await expect(page.getByText(/Sol de ejemplo de Puebla/)).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: /1\. Módulo comunitario/ }),
  ).toBeVisible();
  const modules = page.locator(
    ".shade-scene g[pointer-events='none'] > path[fill='#d5a067']",
  );
  const firstModule = await modules.first().getAttribute("d");
  await page
    .getByRole("combobox", { name: "Alternativa", exact: true })
    .selectOption("b");
  await expect(page.locator(".shade-object-list li").first()).toContainText("Pabellón público");
  await page.getByRole("button", { name: "Volver al contorno y la ubicación" }).click();
  await page.getByRole("button", { name: "Marcar paso libre" }).click();
  const mark = page.getByRole("button", { name: "Marcar punto del paso" });
  for (let i = 0; i < 15; i++) await mark.press("ArrowRight");
  await mark.press("Enter");
  for (let i = 0; i < 12; i++) await mark.press("ArrowDown");
  await mark.press("Enter");
  await page.getByLabel("Ancho del paso en metros").fill("2");
  await page.getByRole("button", { name: "Abrir simulación 3D" }).click();
  await page.getByRole("combobox", { name: "Alternativa", exact: true }).selectOption("a");
  await page.getByRole("button", { name: "Editar en planta" }).click();
  await expect(page.locator("[data-terrain-reserved]")).toBeVisible();
  await expect(modules.first()).not.toHaveAttribute("d", firstModule!);
  await expect(page.getByText(/Huella del módulo construido/)).toBeVisible();
});

test("actualiza un boceto de foto guardado sin perder objetos manuales", async ({ page }) => {
  const manualId = "95858fd0-b20c-4b95-bb1c-858aba8ca7f1";
  await page.goto("/es/terrain");
  await page.evaluate((id) => {
    const roof = (uuid: string) => ({
      id: uuid,
      kind: "shade_canopy",
      heightM: 3,
      coordinates: [[
        [2, 2], [8, 2], [8, 4], [2, 4], [2, 2],
      ]],
    });
    localStorage.setItem("fork-the-city.terrain.v1", JSON.stringify({
      capture: {
        corners: [[50, 250], [450, 250], [450, 50], [50, 50]],
        distance: 10,
        estimatedScale: true,
        location: null,
        utcOffset: 0,
      },
      example: false,
      photoGenerated: true,
      photoLayout: { detected: false, fitted: true },
      date: "2026-11-27",
      time: "16:00",
      alternatives: {
        a: [roof("c163ee20-e32f-4e2e-a825-bcbc825b9c6b"), {
          id,
          kind: "bench",
          heightM: 0.95,
          coordinates: [5, 5],
        }],
        b: [roof("c163ee20-e32f-4e2e-a825-bcbc825b9c6c")],
      },
    }));
  }, manualId);
  await page.getByRole("button", { name: "Abrir diseño guardado" }).click();
  await expect(page.getByRole("combobox", { name: "Alternativa", exact: true })).toHaveValue("a");
  await expect(page.locator(".shade-object-list li").first()).toContainText("Módulo comunitario");
  await page.getByRole("combobox", { name: "Alternativa", exact: true }).selectOption("a");
  await page.getByRole("button", { name: "Guardar en este navegador" }).click();
  expect(await page.evaluate((id) => {
    const stored = JSON.parse(localStorage.getItem("fork-the-city.terrain.v1")!);
    return {
      generation: stored.photoLayout.generation,
      depth: stored.capture.measuredDepth,
      manual: stored.alternatives.a.some((element: { id: string }) => element.id === id),
      oldRoof: stored.alternatives.a.some((element: { id: string }) =>
        element.id === "c163ee20-e32f-4e2e-a825-bcbc825b9c6b"),
    };
  }, manualId)).toEqual({ generation: 3, depth: 10, manual: true, oldRoof: false });
});

test("ignora esquinas repetidas y abre el croquis sin medir", async ({
  page,
}) => {
  await page.goto("/es/terrain");
  const plan = page.getByRole("img", { name: /Plano esquemático/ });
  await plan.scrollIntoViewIfNeeded();
  const { width, height } = (await plan.boundingBox())!;
  for (const [x, y] of [
    [0.25, 0.35],
    [0.15, 0.75],
    [0.68, 0.6],
  ]) {
    await plan.click({ position: { x: width * x, y: height * y } });
  }
  await page
    .getByRole("button", { name: "Agregar esquina", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /Esa esquina ya está marcada/ }),
  ).toContainText("Esquinas marcadas: 3");
  await page.getByRole("button", { name: "Abrir simulación 3D" }).click();
  await expect(
    page.getByRole("heading", { name: "Simulación del terreno" }),
  ).toBeVisible();
  await expect(page.getByText(/Escala aproximada/)).toBeVisible();
});

test("estima el relieve con el modelo local y conserva la malla al guardar", async ({
  page,
  request,
}) => {
  const model = await request.head(
    "/terrain-model/depth-anything-v2-small.onnx",
  );
  test.skip(!model.ok(), "Activa el modelo con npm run setup:terrain-depth");
  test.setTimeout(120000);

  await page.goto("/es/terrain");
  await page.getByLabel("Elegir foto").setInputFiles({
    name: "patio-sintetico.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="340"><defs><linearGradient id="floor" x2="0" y2="1"><stop stop-color="#a1a182"/><stop offset="1" stop-color="#eee0ba"/></linearGradient></defs><rect width="460" height="340" fill="#bfd5e6"/><path d="M0 178L460 106V340H0Z" fill="url(#floor)"/><path d="M31 169V86l122 14v78z" fill="#8e7963"/><path d="M153 100l44-21v78l-44 21z" fill="#665444"/><path d="M310 258v-32h87v31z" fill="#845e42"/><path d="M310 226l18-16h86l-17 16z" fill="#cc9f70"/><circle cx="360" cy="159" r="55" fill="#54794b"/></svg>',
    ),
  });
  await page.getByRole("button", { name: "Abrir simulación 3D" }).click();
  await page
    .getByRole("button", { name: "Perspectiva 3D", exact: true })
    .click();
  const view = page.getByRole("img", { name: /Perspectiva del terreno/ });
  await expect(view).toHaveAttribute("data-terrain-relief", "photo", {
    timeout: 60000,
  });
  await expect(
    page.getByText(/Relieve estimado a partir de tu foto/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Guardar en este navegador" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Abrir diseño guardado" }).click();
  await expect(view).toHaveAttribute("data-terrain-relief", "photo");
  await page
    .getByRole("button", { name: "Volver al contorno y la ubicación" })
    .click();
  await page
    .getByText("Ajustar medidas, ubicación y horario", { exact: true })
    .click();
  await page.getByLabel("Longitud real del primer lado en metros").fill("12");
  await page.getByLabel(/Fondo real del terreno/).fill("18");
  await page.getByRole("button", { name: "Abrir simulación 3D" }).click();
  await page.getByRole("combobox", { name: "Alternativa", exact: true }).selectOption("a");
  await expect(view).toHaveAttribute("data-terrain-relief", "photo");
  await expect(
    page.getByRole("spinbutton", { name: /1\. Cubierta/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Guardar en este navegador" }).click();
  expect(
    await page.evaluate(() => {
      const raw = localStorage.getItem("fork-the-city.terrain.v1");
      const { capture } = JSON.parse(raw!);
      return [capture.distance, capture.measuredDepth];
    }),
  ).toEqual([12, 18]);
});

test("conserva el encuadre de la foto y carga los recursos 3D reales", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.route("**/terrain-model/depth-anything-v2-small.onnx", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto("/es/terrain");
  await page.getByLabel("Elegir foto").setInputFiles({
    name: "fachada.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="380"><rect width="560" height="380" fill="#b4cbd4"/><rect x="5" y="42" width="550" height="200" fill="#e1d5bd"/><rect x="188" y="97" width="84" height="146" fill="#615a4d"/><rect x="328" y="95" width="122" height="83" fill="#68858e"/><path d="M0 241H560V380H0Z" fill="#b2a087"/><circle cx="65" cy="175" r="48" fill="#405a3b"/></svg>',
    ),
  });
  await page.getByRole("button", { name: "Abrir simulación 3D" }).click();

  await page.getByRole("button", { name: "Vista desde la foto" }).click();
  await expect(
    page.getByRole("button", { name: "Vista desde la foto" }),
  ).toHaveAttribute("aria-pressed", "true");
  const canvas = page.locator("canvas.terrain-photo-frame");
  await expect(canvas).toHaveAttribute("data-terrain-model", "aspen", {
    timeout: 45000,
  });
  const pixels = async () =>
    createHash("sha256")
      .update(
        await canvas.evaluate((node) =>
          (node as HTMLCanvasElement).toDataURL(),
        ),
      )
      .digest("hex");
  const blank = await canvas.evaluate((node) => {
    const { width, height } = node as HTMLCanvasElement;
    const empty = document.createElement("canvas");
    empty.width = width;
    empty.height = height;
    return empty.toDataURL();
  });
  await expect
    .poll(pixels, { timeout: 15000 })
    .not.toBe(createHash("sha256").update(blank).digest("hex"));
  await page.getByRole("button", { name: "Foto original" }).click();
  await expect(canvas).toHaveAccessibleName("Foto original");
  const original = await pixels();
  await page.getByRole("button", { name: "Ver propuesta" }).click();
  await expect(canvas).toHaveAccessibleName(
    /Propuesta de diseño en la perspectiva/,
  );
  await expect.poll(pixels, { timeout: 15000 }).not.toBe(original);

  await page
    .getByRole("button", { name: "Perspectiva 3D", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /Perspectiva del terreno/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBe(0);
});
