// Curated PP2 ship types (not in data.js). In-region travel only; cross-region TBD.

/**
 * @typedef {Object} ShipTypeDef
 * @property {string} id
 * @property {string} label
 * @property {'temperate'|'tropical'} archetype
 * @property {number} cargoSlots
 * @property {number} goodsPerSlotMax
 * @property {number} inRegionTravelMinutes
 * @property {string} inRegionTravelLabel
 */

const SHIP_TYPES_BY_ARCHETYPE = {
  temperate: [
    { id: 'cog', label: 'Cog', archetype: 'temperate', cargoSlots: 2, goodsPerSlotMax: 60, inRegionTravelMinutes: 120, inRegionTravelLabel: '2 hours' },
    { id: 'caravel', label: 'Caravel', archetype: 'temperate', cargoSlots: 2, goodsPerSlotMax: 40, inRegionTravelMinutes: 60, inRegionTravelLabel: '1 hour' },
    { id: 'hulk', label: 'Hulk', archetype: 'temperate', cargoSlots: 4, goodsPerSlotMax: 90, inRegionTravelMinutes: 120, inRegionTravelLabel: '2 hours' },
    { id: 'pinnace', label: 'Pinnace', archetype: 'temperate', cargoSlots: 3, goodsPerSlotMax: 60, inRegionTravelMinutes: 40, inRegionTravelLabel: '40 minutes' },
    { id: 'galleon', label: 'Galleon', archetype: 'temperate', cargoSlots: 6, goodsPerSlotMax: 180, inRegionTravelMinutes: 120, inRegionTravelLabel: '2 hours' },
    { id: 'clipper', label: 'Clipper', archetype: 'temperate', cargoSlots: 4, goodsPerSlotMax: 100, inRegionTravelMinutes: 30, inRegionTravelLabel: '30 minutes' },
    { id: 'schooner', label: 'Schooner', archetype: 'temperate', cargoSlots: 6, goodsPerSlotMax: 540, inRegionTravelMinutes: 120, inRegionTravelLabel: '2 hours' },
    { id: 'windjammer', label: 'Windjammer', archetype: 'temperate', cargoSlots: 5, goodsPerSlotMax: 200, inRegionTravelMinutes: 24, inRegionTravelLabel: '24 minutes' },
  ],
  tropical: [
    { id: 'barque', label: 'Barque', archetype: 'tropical', cargoSlots: 2, goodsPerSlotMax: 60, inRegionTravelMinutes: 120, inRegionTravelLabel: '2 hr' },
    { id: 'skiff', label: 'Skiff', archetype: 'tropical', cargoSlots: 2, goodsPerSlotMax: 40, inRegionTravelMinutes: 60, inRegionTravelLabel: '1 hr' },
  ],
};

/** @returns {string[]} */
function getAllShipTypeIds() {
  const ids = [];
  for (const list of Object.values(SHIP_TYPES_BY_ARCHETYPE)) {
    for (const s of list) ids.push(s.id);
  }
  return ids;
}

/** @returns {ShipTypeDef[]} */
function getAllShipTypesFlat() {
  return [...SHIP_TYPES_BY_ARCHETYPE.temperate, ...SHIP_TYPES_BY_ARCHETYPE.tropical];
}
