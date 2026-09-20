export type Vertex = [lng: number, lat: number];

const validLng = (v: number) => Number.isFinite(v) && v >= -180 && v <= 180;
const validLat = (v: number) => Number.isFinite(v) && v >= -90 && v <= 90;

/** A double click reaches the map as click + click + dblclick on the same point: never store the same vertex twice in a row. */
export function addVertex(vertices: readonly Vertex[], next: Vertex): Vertex[] {
  const last = vertices.at(-1);
  if (last && Math.abs(last[0] - next[0]) < 1e-7 && Math.abs(last[1] - next[1]) < 1e-7) return [...vertices];
  return [...vertices, next];
}

export const canClose = (vertices: readonly Vertex[]): boolean => vertices.length >= 3;

/**
 * Keyboard alternative to drawing: one vertex per line as `lat, lng` (the order every map app copies), or a GeoJSON-like
 * array `[[lng, lat], …]`. A repeated closing vertex is dropped. Returns null when fewer than 3 valid vertices remain.
 */
export function parseCoordinates(input: string): Vertex[] | null {
  const text = input.trim();
  if (!text) return null;
  let vertices: Vertex[] = [];
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) return null;
      for (const pair of parsed) {
        if (!Array.isArray(pair) || pair.length < 2) return null;
        const [lng, lat] = [Number(pair[0]), Number(pair[1])];
        if (!validLng(lng) || !validLat(lat)) return null;
        vertices.push([lng, lat]);
      }
    } catch {
      return null;
    }
  } else {
    for (const line of text.split(/\n|;/)) {
      if (!line.trim()) continue;
      const parts = line
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (parts.length !== 2) return null;
      const [lat, lng] = parts as [number, number];
      if (!validLng(lng) || !validLat(lat)) return null;
      vertices.push([lng, lat]);
    }
  }
  const first = vertices[0];
  const last = vertices.at(-1);
  if (first && last && vertices.length > 3 && first[0] === last[0] && first[1] === last[1])
    vertices = vertices.slice(0, -1);
  return canClose(vertices) ? vertices : null;
}

export const formatCoordinates = (vertices: readonly Vertex[]): string =>
  vertices.map(([lng, lat]) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`).join('\n');
