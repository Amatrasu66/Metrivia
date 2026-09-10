/** Map viewport coordinates to SVG user space (no @visx/event). */
export function localPointFromSvg(svg, clientX, clientY) {
  if (!svg) {
    return null;
  }

  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;

  const matrix = svg.getScreenCTM();
  if (!matrix) {
    return null;
  }

  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}
