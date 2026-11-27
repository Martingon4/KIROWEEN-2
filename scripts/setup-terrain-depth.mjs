import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const assets = new URL("../public/terrain-model/", import.meta.url);
const weights = new URL("depth-anything-v2-small.onnx", assets);
const source =
  "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx";
const sha256 =
  "fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

await mkdir(assets, { recursive: true });
const current = await readFile(weights).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});

if (!current || digest(current) !== sha256) {
  const response = await fetch(source, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok)
    throw new Error(`No se pudo descargar el modelo (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== sha256)
    throw new Error("La suma del modelo descargado no coincide.");
  await writeFile(weights, bytes);
}

for (const file of [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
]) {
  await copyFile(
    new URL(`../node_modules/onnxruntime-web/dist/${file}`, import.meta.url),
    new URL(file, assets),
  );
}
console.log(
  "Modelo de profundidad y WebAssembly disponibles en public/terrain-model/.",
);
