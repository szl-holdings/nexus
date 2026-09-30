/** Unknown router failures must never be treated as an arbitrary object. */
export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "An unexpected error occurred. Try reloading the page.";
}
