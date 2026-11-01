/** One eye: width and height (R), a tilt (degrees, clockwise) and how open it is (0..1). */
export interface EyeShape {
  w: number;
  h: number;
  tilt: number;
  open: number;
}

/** A face: where it looks (degrees, on top of the head's own turn) and its two eyes. */
export interface Expression {
  yaw: number;
  pitch: number;
  roll: number;
  /** Half the angle between the two eyes on the head, degrees. */
  split: number;
  left: EyeShape;
  right: EyeShape;
}
