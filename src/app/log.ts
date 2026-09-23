export type LogCategory =
  'APP' | 'RENDERER' | 'TEXTURE' | 'PROJECT' | 'EXPORT' | 'PERFORMANCE' | 'NATIVE' | 'ANIMATION';
/** No source paths or image payloads may be logged. No external telemetry. */
export function log(
  category: LogCategory,
  event: string,
  details: Record<string, string | number | boolean> = {},
) {
  if (import.meta.env.DEV) console.info(JSON.stringify({ category, event, ...details }));
}

/** Error messages/stacks may contain filenames, source bytes or user-defined data. */
export function logError(category: LogCategory, event: string, error: unknown) {
  const errorKind =
    error instanceof TypeError
      ? 'TypeError'
      : error instanceof RangeError
        ? 'RangeError'
        : error instanceof SyntaxError
          ? 'SyntaxError'
          : error instanceof Error
            ? 'Error'
            : 'Unknown';
  log(category, event, { status: 'failed', errorKind });
}
