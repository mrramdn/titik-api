/** A 16 px green disc with a white check mark, drawn once for the checked-incident badge on the map. */
export function checkBadge(pixelRatio = 2): ImageData | null {
  const size = 16 * pixelRatio;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#2F9E44';
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1.5 * pixelRatio;
  g.beginPath(); g.arc(size / 2, size / 2, size / 2 - g.lineWidth / 2, 0, Math.PI * 2); g.fill(); g.stroke();
  g.lineWidth = 1.8 * pixelRatio; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(size * 0.3, size * 0.52); g.lineTo(size * 0.45, size * 0.66); g.lineTo(size * 0.71, size * 0.37); g.stroke();
  return g.getImageData(0, 0, size, size);
}
