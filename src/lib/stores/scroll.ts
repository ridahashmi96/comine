/**
 * Scroll Position Store
 *
 * Persists scroll positions per-route so they're restored when navigating
 * back to a page, regardless of how you navigate (sidebar clicks, back button, etc.)
 */

// Store scroll positions by route path
const scrollPositions = new Map<string, number>();

/**
 * Save scroll position for a route
 */
export function saveScrollPosition(path: string, position: number): void {
  scrollPositions.set(path, position);
}

/**
 * Get saved scroll position for a route
 */
export function getScrollPosition(path: string): number {
  return scrollPositions.get(path) ?? 0;
}

/**
 * Clear scroll position for a route (e.g., when content changes)
 */
export function clearScrollPosition(path: string): void {
  scrollPositions.delete(path);
}

/**
 * Clear all scroll positions
 */
export function clearAllScrollPositions(): void {
  scrollPositions.clear();
}
