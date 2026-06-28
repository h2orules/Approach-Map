/** Rasterize an inline SVG string into an HTMLImageElement for map.addImage. */
export function svgToImage(svg: string, size = 28): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size)
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}
