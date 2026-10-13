// Each visible fragment is a clipped copy of the same complete card. Shared
// boundary coordinates make the torn edges meet exactly when assembled.
const point = ([x, y]) => `${x.toFixed(3)}% ${y.toFixed(3)}%`;

function tornVertical(x, y0, y1) {
  const points = [[x, y0]];
  const steps = Math.round((y1 - y0) / 12.5);
  for (let step = 1; step < steps; step++) {
    const y = y0 + (y1 - y0) * step / steps;
    points.push([x + (step % 2 ? -1.8 : 1.8), y]);
  }
  points.push([x, y1]);
  return points;
}

function tornHorizontal(y, x0, x1) {
  const points = [[x0, y]];
  const steps = Math.round((x1 - x0) / 12.5);
  for (let step = 1; step < steps; step++) {
    const x = x0 + (x1 - x0) * step / steps;
    points.push([x, y + (step % 2 ? 1.8 : -1.8)]);
  }
  points.push([x1, y]);
  return points;
}

function edge(a, b, torn) { return torn ? torn(a, b) : [a, b]; }

export function fragmentClipPath(required, index) {
  if (![2, 3, 4].includes(required) || index < 0 || index >= required) throw new RangeError('Fragment Collect invalide');
  const cols = required === 3 ? 3 : 2;
  const rows = required === 4 ? 2 : 1;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const x0 = col * 100 / cols, x1 = (col + 1) * 100 / cols;
  const y0 = row * 100 / rows, y1 = (row + 1) * 100 / rows;
  const top = edge([x0, y0], [x1, y0], row ? () => tornHorizontal(y0, x0, x1) : null);
  const right = edge([x1, y0], [x1, y1], col < cols - 1 ? () => tornVertical(x1, y0, y1) : null);
  const bottom = edge([x1, y1], [x0, y1], row < rows - 1 ? () => tornHorizontal(y1, x0, x1).reverse() : null);
  const left = edge([x0, y1], [x0, y0], col ? () => tornVertical(x0, y0, y1).reverse() : null);
  return `polygon(${[...top, ...right.slice(1), ...bottom.slice(1), ...left.slice(1)].map(point).join(',')})`;
}

export function renderFragmentMosaic({ required, count, fullCardHtml }) {
  if (![2, 3, 4].includes(required)) return '';
  const earned = Math.max(0, Math.min(required, Number(count) || 0));
  const cols = required === 3 ? 3 : 2;
  const pieces = Array.from({ length: required }, (_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const shiftX = col === 0 ? -2 : col === cols - 1 ? 2 : 0;
    const shiftY = required === 4 ? (row ? 2 : -2) : 0;
    return `<div class="collect-fragment-piece ${index < earned ? 'is-earned' : 'is-missing'}" style="clip-path:${fragmentClipPath(required, index)};--fragment-x:${shiftX}px;--fragment-y:${shiftY}px" aria-hidden="true">${index < earned ? fullCardHtml : ''}</div>`;
  }).join('');
  return `<div class="collect-fragment-mosaic" role="img" aria-label="${earned} fragment${earned > 1 ? 's' : ''} sur ${required} de la carte obtenus">${pieces}</div>`;
}
