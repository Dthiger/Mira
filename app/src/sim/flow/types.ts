/**
 * Flowmap-mode data shapes. The output is a 2D vector field, one (x, y)
 * vector per pixel, intended for export as a Substance Designer flowmap.
 */

export interface FlowParams {
  /** Noise scale in doc-px (wavelength of the curl noise). */
  scale: number;
  /** Overall magnitude multiplier in doc-px. */
  strength: number;
  /** PRNG seed for the noise field. */
  seed: number;
  /** 0 = pure per-region internal swirl (curl of noise). 1 = pure
   *  boundary-tangent flow (vectors aligned along each region's outline).
   *  Intermediate values smoothly blend. */
  tangentMix: number;
  /** Falloff width in doc-px over which flow magnitude attenuates as we
   *  approach a region boundary. 0 = no attenuation; higher = wider
   *  buffer of quiet flow near edges. */
  boundaryFalloff: number;
  /** Directional push angle in degrees (0 = right, 90 = down in screen
   *  coords). Drives the fluid sim with a continuous wind in that
   *  direction. Combined with open boundaries this gives flow-past-
   *  obstacle behavior with wakes and vortex shedding behind shapes. */
  pushAngle: number;
  /** Directional push magnitude (0–100). 0 = no wind (just curl-noise
   *  stirring); 100 = strong wind that drives most of the flow. */
  pushStrength: number;
}

export interface FlowField {
  width: number;
  height: number;
  /** Per-pixel x component, doc-space units. */
  fx: Float32Array;
  /** Per-pixel y component. */
  fy: Float32Array;
}
