import { copyFile, mkdir } from "node:fs/promises";

const source = new URL(
  "../node_modules/three/examples/jsm/libs/basis/",
  import.meta.url,
);
const destination = new URL("../public/terrain-assets/basis/", import.meta.url);
await mkdir(destination, { recursive: true });
await Promise.all(
  ["basis_transcoder.js", "basis_transcoder.wasm"].map((file) =>
    copyFile(new URL(file, source), new URL(file, destination)),
  ),
);
