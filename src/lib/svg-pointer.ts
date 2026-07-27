interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ViewBoxLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert browser pointer coordinates to authored SVG/viewBox coordinates.
 *
 * getScreenCTM() is inconsistent when an SVG is nested in a scrolled, resized
 * zoom viewport. The preview always uses xMidYMid meet, so calculating the
 * rendered SVG content box explicitly keeps the lasso rectangle under the
 * pointer at every responsive size and zoom level.
 */
export function clientPointToSvg(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  viewBox: ViewBoxLike
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
    return { x: viewBox.x, y: viewBox.y };
  }

  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  const renderedWidth = viewBox.width * scale;
  const renderedHeight = viewBox.height * scale;
  const renderedLeft = rect.left + (rect.width - renderedWidth) / 2;
  const renderedTop = rect.top + (rect.height - renderedHeight) / 2;
  const x = viewBox.x + (clientX - renderedLeft) / scale;
  const y = viewBox.y + (clientY - renderedTop) / scale;

  return {
    x: clamp(x, viewBox.x, viewBox.x + viewBox.width),
    y: clamp(y, viewBox.y, viewBox.y + viewBox.height)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
