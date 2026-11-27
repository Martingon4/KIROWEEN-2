# Third-party notices

## OpenStreetMap

The pilot boundary is derived from OpenStreetMap data obtained through Nominatim.

© OpenStreetMap contributors. Data is available under the Open Database License (ODbL) 1.0.

- https://www.openstreetmap.org/copyright
- https://opendatacommons.org/licenses/odbl/1-0/

## Software dependencies

Runtime and development dependencies retain their respective licenses. The resolved dependency graph is recorded by `package-lock.json`. Run the release license audit before public distribution and update this file with any attribution requirements that apply to bundled assets.

## MapLibre GL JS

The interactive pilot map uses MapLibre GL JS. Its packaged worker is copied from the pinned npm dependency into `public/maplibre-gl-worker.mjs` for Next.js/Turbopack compatibility.

Copyright MapLibre contributors. MapLibre GL JS is distributed under the BSD 3-Clause License.

- https://github.com/maplibre/maplibre-gl-js

## Atkinson Hyperlegible

The interface uses Atkinson Hyperlegible through Next.js font self-hosting. The typeface is distributed under the SIL Open Font License 1.1.

- https://fonts.google.com/specimen/Atkinson+Hyperlegible
## SunCalc
`scripts/generate-solar-scenarios.mjs` usa SunCalc 1.9.0 para calcular los escenarios solares de `data/sites/zocalo-puebla/solar-scenarios.json`. La captura asistida también usa esa versión en el navegador para calcular la posición del sol del terreno elegido.
- https://github.com/mourner/suncalc

```text
Copyright (c) 2014, Vladimir Agafonkin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice, this list of
      conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright notice, this list
      of conditions and the following disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Depth Anything V2 Small y ONNX Runtime Web

La estimación local usa los pesos cuantizados de Depth Anything V2 Small (Apache-2.0) en la revisión `4472b7362082ad9968fee890ca0f1e5aca36b93d` y ONNX Runtime Web (MIT). El comando `npm run setup:terrain-depth` descarga y verifica los pesos públicos y prepara WebAssembly en `public/terrain-model/`. La foto se procesa dentro del navegador.

- https://github.com/DepthAnything/Depth-Anything-V2
- https://huggingface.co/onnx-community/depth-anything-v2-small
- https://github.com/microsoft/onnxruntime

## Recursos visuales del visor fotográfico

- **Aspen**, tevy, formato GLB nivel LOD1, versión v1. [Ficha del árbol y licencia CC0 1.0](https://tevy.dev/models/aspen).
- **Park Bench**, **Concrete Planter** y **Baker’s Awning Stall**, tevy, GLB LOD1, versión v1. [Banca](https://tevy.dev/models/park-bench), [jardinera](https://tevy.dev/models/concrete-planter) y [puesto](https://tevy.dev/models/bakers-awning-stall), con licencia CC0 1.0.
- **Wooden Planks**, de Charlotte Baglioni y Dario Barresi, mapas de color y normales en JPG de 1K. [Ficha del material y licencia CC0](https://polyhaven.com/a/wooden_planks).
- **Three.js** (MIT) importa el GLB, sus texturas Basis Universal y dibuja la propuesta con WebGL. Los recursos se sirven desde el proyecto local.
- **Basis Universal**, de Binomial LLC, transcodifica las texturas KTX2 del árbol. El proyecto distribuye el transcodificador incluido en Three.js bajo la [licencia Apache 2.0](docs/licenses/basis-universal.txt).
- **Meshoptimizer**, de Arseny Kapoulkine, descomprime la geometría del árbol. [Licencia MIT del decodificador](https://github.com/zeux/meshoptimizer/blob/v1.1/LICENSE.md).
