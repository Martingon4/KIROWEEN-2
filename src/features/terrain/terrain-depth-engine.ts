"use client";

import { createPhotoRelief, type PhotoRegion } from "./terrain-relief";

const modelPath = "/terrain-model/depth-anything-v2-small.onnx";
let runtime: Promise<typeof import("onnxruntime-web/wasm")> | undefined;
let session:
  Promise<import("onnxruntime-web/wasm").InferenceSession> | undefined;

export async function estimatePhotoRelief(
  image: HTMLImageElement,
  colors: ImageData,
  region?: PhotoRegion,
) {
  if (!session) {
    const asset = await fetch(modelPath, { method: "HEAD" });
    if (!asset.ok) return null;
    runtime ??= import("onnxruntime-web/wasm");
    session ??= runtime
      .then(({ env, InferenceSession }) => {
        env.wasm.numThreads = 1;
        env.wasm.wasmPaths = "/terrain-model/";
        return InferenceSession.create(modelPath, {
          executionProviders: ["wasm"],
        });
      })
      .catch((error: unknown) => {
        session = undefined;
        throw error;
      });
  }

  const [{ Tensor }, model] = await Promise.all([runtime!, session]);
  const metadata = model.inputMetadata[0];
  if (!metadata.isTensor) return null;
  const [, , inputHeight, inputWidth] = metadata.shape;
  const aspect = image.naturalWidth / image.naturalHeight;
  const modelSize = (n: number) => Math.max(98, Math.round(n / 14) * 14);
  const width =
    typeof inputWidth === "number" && inputWidth > 0
      ? inputWidth
      : modelSize(280 * Math.min(1, aspect));
  const height =
    typeof inputHeight === "number" && inputHeight > 0
      ? inputHeight
      : modelSize(280 * Math.min(1, 1 / aspect));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const pixels = width * height;
  const values = new Float32Array(pixels * 3);
  const means = [0.485, 0.456, 0.406];
  const scales = [0.229, 0.224, 0.225];
  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < pixels; i++) {
      values[channel * pixels + i] =
        (data[i * 4 + channel] / 255 - means[channel]) / scales[channel];
    }
  }

  const output = await model.run({
    [model.inputNames[0]]: new Tensor("float32", values, [1, 3, height, width]),
  });
  const predicted = output[model.outputNames[0]];
  if (!predicted || !(predicted.data instanceof Float32Array)) return null;
  const [depthHeight, depthWidth] = predicted.dims.slice(-2);
  return createPhotoRelief(
    { data: predicted.data, width: depthWidth, height: depthHeight },
    colors,
    region,
  );
}
