import { z } from 'zod';

/** Public runtime configuration. NEXT_PUBLIC_* values are inlined at build time, so each is referenced literally. */
const schema = z.object({
  apiUrl: z.string().url().default('http://localhost:4000'),
  apiMock: z.boolean(),
  mockSpeed: z.number().positive().default(1),
  mapTileJsonUrl: z.string().url().default('https://tiles.openfreemap.org/planet'),
  mapGlyphsUrl: z.string().default('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'),
  pmtilesUrl: z.string().url().optional(),
  pmtilesSchema: z.enum(['openmaptiles', 'protomaps']).default('openmaptiles'),
  mapFontRegular: z.string().default('Noto Sans Regular'),
  mapFontBold: z.string().default('Noto Sans Bold'),
});

const orUndefined = (v: string | undefined): string | undefined =>
  v && v.trim() !== '' ? v.trim() : undefined;

export const env = schema.parse({
  apiUrl: orUndefined(process.env.NEXT_PUBLIC_API_URL),
  apiMock: process.env.NEXT_PUBLIC_API_MOCK === '1',
  mockSpeed: orUndefined(process.env.NEXT_PUBLIC_MOCK_SPEED)
    ? Number(process.env.NEXT_PUBLIC_MOCK_SPEED)
    : undefined,
  mapTileJsonUrl: orUndefined(process.env.NEXT_PUBLIC_MAP_TILEJSON_URL),
  mapGlyphsUrl: orUndefined(process.env.NEXT_PUBLIC_MAP_GLYPHS_URL),
  pmtilesUrl: orUndefined(process.env.NEXT_PUBLIC_PMTILES_URL),
  pmtilesSchema: orUndefined(process.env.NEXT_PUBLIC_PMTILES_SCHEMA),
  mapFontRegular: orUndefined(process.env.NEXT_PUBLIC_MAP_FONT_REGULAR),
  mapFontBold: orUndefined(process.env.NEXT_PUBLIC_MAP_FONT_BOLD),
});

export type Env = typeof env;
