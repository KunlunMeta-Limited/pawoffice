/** Background window positions in the reference room's logical floor coordinates. */
export const COFFEE_WINDOW = 'office.coffee-window'
export const COFFEE_WINDOW_ANCHORS = ['window1', 'window2', 'window3', 'window4', 'window5'] as const
export const coffeeWindowLandmark = {
  id: COFFEE_WINDOW,
  anchors: Object.fromEntries(COFFEE_WINDOW_ANCHORS.map((anchor, index) => [anchor, { x: 18, y: 8 + index }])),
}
