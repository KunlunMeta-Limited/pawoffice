// Reuse the actual board painted into the office background. Nine viewports keep
// its aluminum corners and frame thin as the reading surface grows.
const columns = [393, 405, 1010, 1023] as const
const rows = [46, 58, 279, 291] as const
const roomArtwork = `${import.meta.env.BASE_URL}assets/office/reference-v1/room-whiteboard-v3.png`

export function OfficeWhiteboardSurface() {
  return <div className="office-whiteboard-surface" aria-hidden="true">
    {Array.from({ length: 9 }, (_, index) => {
      const column = index % 3, row = Math.floor(index / 3)
      return <svg key={index} viewBox={`${columns[column]} ${rows[row]} ${columns[column + 1] - columns[column]} ${rows[row + 1] - rows[row]}`}
        preserveAspectRatio="none" focusable="false">
        <image href={roomArtwork} width="1424" height="1105" />
      </svg>
    })}
  </div>
}
