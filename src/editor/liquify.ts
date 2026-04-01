export type LiquifyBrushMode = "push" | "smooth";

export interface LiquifyBrushParams {
  dispX: Float32Array;
  dispY: Float32Array;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  brushSize: number;
  strength: number;
  moveX: number;
  moveY: number;
  mode: LiquifyBrushMode;
}

export function hasLiquifyDisplacement(dispX: Float32Array, dispY: Float32Array, threshold = 0.01) {
  for (let i = 0; i < dispX.length; i += 1) {
    if (Math.abs(dispX[i]) > threshold || Math.abs(dispY[i]) > threshold) {
      return true;
    }
  }
  return false;
}

function applyLiquifyBrushStamp(params: LiquifyBrushParams) {
  const {
    dispX,
    dispY,
    width,
    height,
    centerX,
    centerY,
    brushSize,
    strength,
    moveX,
    moveY,
    mode,
  } = params;

  const radius = brushSize;
  const radiusSq = radius * radius;
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius));

  if (mode === "push") {
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const distanceSq = (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY);
        if (distanceSq >= radiusSq) continue;
        const falloff = 1 - Math.sqrt(distanceSq) / radius;
        const factor = falloff * falloff * strength;
        const index = y * width + x;
        dispX[index] += moveX * factor;
        dispY[index] += moveY * factor;
      }
    }
    return;
  }

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distanceSq = (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY);
      if (distanceSq >= radiusSq) continue;
      const falloff = 1 - Math.sqrt(distanceSq) / radius;
      const factor = falloff * falloff * strength * 0.5;
      const index = y * width + x;

      let avgX = 0;
      let avgY = 0;
      let count = 0;
      if (x > 0) {
        avgX += dispX[index - 1];
        avgY += dispY[index - 1];
        count += 1;
      }
      if (x < width - 1) {
        avgX += dispX[index + 1];
        avgY += dispY[index + 1];
        count += 1;
      }
      if (y > 0) {
        avgX += dispX[index - width];
        avgY += dispY[index - width];
        count += 1;
      }
      if (y < height - 1) {
        avgX += dispX[index + width];
        avgY += dispY[index + width];
        count += 1;
      }
      if (count === 0) continue;

      avgX /= count;
      avgY /= count;
      dispX[index] += (avgX - dispX[index]) * factor;
      dispY[index] += (avgY - dispY[index]) * factor;
    }
  }
}

export function applyLiquifyBrush(params: LiquifyBrushParams) {
  const { brushSize, strength, centerX, centerY, moveX, moveY } = params;
  if (brushSize <= 0 || strength <= 0) {
    return;
  }

  const moveDistance = Math.hypot(moveX, moveY);
  if (moveDistance < 0.01) {
    return;
  }

  const spacing = Math.max(1, brushSize * 0.25);
  const steps = Math.max(1, Math.ceil(moveDistance / spacing));
  const startX = centerX - moveX;
  const startY = centerY - moveY;
  const stepMoveX = moveX / steps;
  const stepMoveY = moveY / steps;

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    applyLiquifyBrushStamp({
      ...params,
      centerX: startX + moveX * t,
      centerY: startY + moveY * t,
      moveX: stepMoveX,
      moveY: stepMoveY,
    });
  }
}

export function applyDisplacementMapToImageData(
  source: ImageData,
  dispX: Float32Array,
  dispY: Float32Array,
) {
  const width = source.width;
  const height = source.height;
  const output = new ImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const sourceX = x - dispX[index];
      const sourceY = y - dispY[index];
      const clampedX = Math.max(0, Math.min(width - 1, sourceX));
      const clampedY = Math.max(0, Math.min(height - 1, sourceY));
      const x0 = Math.floor(clampedX);
      const y0 = Math.floor(clampedY);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);
      const dx = clampedX - x0;
      const dy = clampedY - y0;

      const i00 = (y0 * width + x0) * 4;
      const i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const outIndex = index * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        output.data[outIndex + channel] = Math.round(
          source.data[i00 + channel] * (1 - dx) * (1 - dy) +
          source.data[i10 + channel] * dx * (1 - dy) +
          source.data[i01 + channel] * (1 - dx) * dy +
          source.data[i11 + channel] * dx * dy,
        );
      }
    }
  }

  return output;
}
