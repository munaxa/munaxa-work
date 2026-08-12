import type { MetadataRoute } from 'next';

import { brandManifest } from '@munaxa/ui';

/**
 * The web app manifest — what an installed Munaxa Work — Manager looks like on a home screen.
 *
 * Built from the brand registry, so the installed icon is the same approved Work app icon the
 * tab shows and the chrome colour is the same burgundy the theme paints. A hand-written manifest
 * is where a corporate icon quietly outlives a product's rebrand, because nothing renders it in
 * review.
 */
export default function manifest(): MetadataRoute.Manifest {
  return brandManifest('work', 'Manager self-service.') as MetadataRoute.Manifest;
}
