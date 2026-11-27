import { z } from "zod";
import { terrainObjectKinds } from "./terrain-objects";

const point = z.tuple([z.number(), z.number()]);
const ring = z.array(point).min(4);
const furnitureSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(terrainObjectKinds),
    heightM: z.number().min(0.3).max(8),
    coordinates: point,
    dimensionsM: z.tuple([z.number().min(3).max(8), z.number().min(3).max(8)]).optional(),
  })
  .refine(
    ({ kind, heightM, dimensionsM }) =>
      ((kind !== "bench" && kind !== "planter") || heightM <= 3) &&
      (!dimensionsM || kind === "community_room" || kind === "civic_pavilion"),
    { path: ["heightM"] },
  );
export const shadeElementsSchema = z
  .array(
    z.discriminatedUnion("kind", [
      z.object({
        id: z.uuid(),
        kind: z.literal("shade_tree"),
        heightM: z.number().positive(),
        canopyDiameterM: z.number().positive(),
        coordinates: point,
      }),
      z.object({
        id: z.uuid(),
        kind: z.literal("shade_canopy"),
        heightM: z.number().positive(),
        coordinates: z.array(ring).min(1),
      }),
      furnitureSchema,
    ]),
  )
  .max(200);

export const shadeSceneSchema = z.object({
  surface: z.array(z.array(ring).min(1)).min(1),
  elements: shadeElementsSchema,
});

export type Point = z.infer<typeof point>;
export type ShadeScene = z.infer<typeof shadeSceneSchema>;
