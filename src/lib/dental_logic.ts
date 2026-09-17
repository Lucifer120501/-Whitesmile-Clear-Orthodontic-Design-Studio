import * as THREE from "three";

// Types matching the dental CAD schema
interface Tooth {
  id: number;
  name: string;
  x: number;
  y: number;
}

/**
 * Validates trim line proximity to critical dental structures.
 */
export function checkTrimLineCompliance(
  trimPoints: THREE.Vector3[],
  teeth: Tooth[]
): { valid: boolean; message: string } {
  // Simple proximity check for demo purposes.
  // In a real application, this would use surface-level distance calculations.
  
  // Logic: Trim line should not be too close to tooth center (proxy for incisal edge/occlusal)
  // or too close to each other, etc.
  for (const tooth of teeth) {
    for (const point of trimPoints) {
      // Scale down tooth coordinates to match 3D viewer scale roughly
      const tx = (tooth.x - 213) * 0.25;
      const ty = (220 - tooth.y) * 0.25;
      
      const distance = Math.sqrt(
        Math.pow(point.x - tx, 2) + Math.pow(point.y - ty, 2)
      );
      
      if (distance < 2.0) { // e.g. < 2mm is too close
        return {
          valid: false,
          message: `Trim line too close to tooth ${tooth.id} structure (${distance.toFixed(1)}mm).`,
        };
      }
    }
  }

  return { valid: true, message: "Trim line is compliant." };
}
