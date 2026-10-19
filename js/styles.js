export const STYLES = {
  modern: {
    id: 'modern', name: 'Modern Minimal',
    blurb: 'Clean white facade, flat roof with dark parapet, wood-clad entrance and large glazing.',
    wall: '#f1f0ec', interior: '#f8f7f3', trim: '#2e3338', accent: '#a8744c', roof: '#d4d4d2', tile: '#5d646c',
    glass: '#8ec0dc', frame: '#22262a', floorLiving: 'marble', floorBed: 'wood', deco: 'wood', pillar: 'box',
  },
  classic: {
    id: 'classic', name: 'Classic Elegance',
    blurb: 'Warm cream walls, cornice detailing, columns at the porch and a traditional feel.',
    wall: '#eadbbd', interior: '#fbf4e6', trim: '#fffaf0', accent: '#b8955a', roof: '#d8cdb8', tile: '#8c4a30',
    glass: '#9cc6dd', frame: '#fffaf0', floorLiving: 'marble-warm', floorBed: 'wood-dark', deco: 'cornice', pillar: 'column',
  },
  spanish: {
    id: 'spanish', name: 'Mediterranean',
    blurb: 'Sandy stucco with terracotta roof tiles, arched porch and dark timber frames.',
    wall: '#e8cfa6', interior: '#fbf0df', trim: '#a9482a', accent: '#c4673a', roof: '#b95a34', tile: '#c2623a',
    glass: '#8fb8cc', frame: '#5a3220', floorLiving: 'terracotta', floorBed: 'wood', deco: 'tiles', pillar: 'arch',
  },
};
export const STYLE_IDS = Object.keys(STYLES);
