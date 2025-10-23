// Centralized stable domain constants for E2E tests to avoid duplication and reduce DNS flakiness.
// Use globally resolvable, low-variance sites. Subpaths are permitted for disambiguation.
export const STABLE_DOMAIN_PRIMARY = 'https://example.com';
export const STABLE_DOMAIN_SECONDARY = 'https://example.org';
export const STABLE_DOMAIN_TERTIARY = 'https://example.net';
export const STABLE_DOMAIN_QUATERNARY = 'https://example.io';

// Helper to build a path variant
export function stablePath(base: string, path: string): string {
  return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}

// Common shorthands for tests needing multiple distinct stable URLs
export const STABLE_SET_TWO = [STABLE_DOMAIN_PRIMARY, STABLE_DOMAIN_SECONDARY];
export const STABLE_SET_THREE = [STABLE_DOMAIN_PRIMARY, STABLE_DOMAIN_SECONDARY, STABLE_DOMAIN_TERTIARY];
export const STABLE_SET_FOUR = [STABLE_DOMAIN_PRIMARY, STABLE_DOMAIN_SECONDARY, STABLE_DOMAIN_TERTIARY, STABLE_DOMAIN_QUATERNARY];
