export const STYLES = {
  modern: {
    id: 'modern', family: 'modern', name: 'Modern Minimal',
    blurb: 'Clean white facade, flat roof with dark parapet, wood-clad entrance and large glazing.',
    wall: '#f1f0ec', interior: '#f8f7f3', trim: '#2e3338', accent: '#a8744c', roof: '#d4d4d2', tile: '#5d646c',
    glass: '#8ec0dc', frame: '#22262a', floorLiving: 'marble', floorBed: 'wood', deco: 'wood', pillar: 'box',
  },
  classic: {
    id: 'classic', family: 'classic', name: 'Classic Elegance',
    blurb: 'Warm cream walls, cornice detailing, columns at the porch and a traditional feel.',
    wall: '#eadbbd', interior: '#fbf4e6', trim: '#fffaf0', accent: '#b8955a', roof: '#d8cdb8', tile: '#8c4a30',
    glass: '#9cc6dd', frame: '#fffaf0', floorLiving: 'marble-warm', floorBed: 'wood-dark', deco: 'cornice', pillar: 'column',
  },
  spanish: {
    id: 'spanish', family: 'spanish', name: 'Mediterranean',
    blurb: 'Sandy stucco with terracotta roof tiles, arched porch and dark timber frames.',
    wall: '#e8cfa6', interior: '#fbf0df', trim: '#a9482a', accent: '#c4673a', roof: '#b95a34', tile: '#c2623a',
    glass: '#8fb8cc', frame: '#5a3220', floorLiving: 'terracotta', floorBed: 'wood', deco: 'tiles', pillar: 'arch',
  },
  box: {
    id: 'box', family: 'modern', name: 'Modern Box',
    blurb: 'A sharp cube look: pale grey walls, black frames, a timber panel at the entrance and big windows.',
    wall: '#8a9096', interior: '#f8f7f3', trim: '#1b1e21', accent: '#8a6a4a', roof: '#3a3f44', tile: '#4d545b',
    glass: '#7fb0cc', frame: '#15181b', floorLiving: 'marble', floorBed: 'wood', deco: 'wood', pillar: 'box',
  },
  colonial: {
    id: 'colonial', family: 'classic', name: 'Colonial',
    blurb: 'White walls, tall white columns, moulded window surrounds and green accents on doors and shutters.',
    wall: '#fbfaf5', interior: '#fbf6ea', trim: '#ffffff', accent: '#2f5d50', roof: '#cfc6b4', tile: '#7a3b2e',
    glass: '#a6cbe0', frame: '#2f5d50', floorLiving: 'marble-warm', floorBed: 'wood-dark', deco: 'cornice', pillar: 'column',
  },
  haveli: {
    id: 'haveli', family: 'spanish', name: 'Desi Haveli',
    blurb: 'Warm brick-red walls, cream arches and a tiled edge, in the spirit of a traditional Pakistani haveli.',
    wall: '#b9694c', interior: '#f6ead6', trim: '#f2e4c9', accent: '#6b4a32', roof: '#a9573a', tile: '#8c4a30',
    glass: '#8fb8cc', frame: '#4a2f1f', floorLiving: 'terracotta', floorBed: 'wood-dark', deco: 'tiles', pillar: 'arch',
  },
};
export const STYLE_IDS = Object.keys(STYLES);
