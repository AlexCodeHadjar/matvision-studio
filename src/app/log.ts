export type LogCategory =
  'APP' | 'RENDERER' | 'TEXTURE' | 'PROJECT' | 'EXPORT' | 'PERFORMANCE' | 'NATIVE';
/** No source paths or image payloads may be logged. No external telemetry. */
export function log(
  category: LogCategory,
  event: string,
  details: Record<string, string | number | boolean> = {},
) {
  if (import.meta.env.DEV) console.info(JSON.stringify({ category, event, ...details }));
}
