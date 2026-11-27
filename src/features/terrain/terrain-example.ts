import type { TerrainDraft } from "./terrain-model";

// Fictional patio footprint and empty alternatives for the Puebla demonstration.
export const terrainExample: TerrainDraft = {
  example: true,
  capture: {
    corners: [
      [120, 75],
      [370, 75],
      [370, 220],
      [120, 220],
    ],
    distance: 24,
    location: { latitude: 19.043675, longitude: -98.198094 },
    utcOffset: -6,
  },
  date: "2027-03-20",
  time: "16:00",
  alternatives: { a: [], b: [] },
};
