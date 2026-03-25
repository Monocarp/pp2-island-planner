/**
 * Node-only: planner data + tile geometry deps for save production scaling.
 * Mirrors browser globals (getBuildingData, FOOTPRINTS, TILE_RESOURCE_IDS, …).
 */

const path = require('path');

const { PP2DATA } = require(path.join(__dirname, '..', 'data.js'));
global.PP2DATA = PP2DATA;

const {
  getBuildingData,
  FOOTPRINTS,
  LOCATION_REQUIREMENTS,
  PLACEABLE_TERRAIN,
} = require(path.join(__dirname, '..', 'buildings.js'));
const { TILE_RESOURCE_IDS } = require(path.join(__dirname, '..', 'island.js'));
const { footprintCellCountsForGathering } = require(path.join(__dirname, '..', 'tile-resource-geometry.js'));
const { buildPlannerIslandFromSaveIsland } = require(path.join(__dirname, '..', 'save-island-from-save.js'));
const {
  buildSpatialTileClaimantsMap,
  buildGrassPoolRatiosByAnchor,
  computeTileUtilizationForProducer,
} = require(path.join(__dirname, '..', 'save-tile-utilization.js'));

const tileUtilDeps = {
  getBuildingData,
  FOOTPRINTS,
  TILE_RESOURCE_IDS,
  LOCATION_REQUIREMENTS,
  footprintCellCountsForGathering,
  placeableTerrain: PLACEABLE_TERRAIN,
};

function reconstructIslandFromSaveSlice(islandSlice, warnings) {
  return buildPlannerIslandFromSaveIsland(islandSlice, {
    getBuildingData,
    warnings: warnings || [],
  });
}

function tileClaimantsForReconstructedIsland(islandGrid) {
  return buildSpatialTileClaimantsMap(islandGrid, tileUtilDeps);
}

function grassPoolRatiosForIsland(islandGrid) {
  return buildGrassPoolRatiosByAnchor(islandGrid, tileUtilDeps);
}

function tileUtilizationForEntity(islandGrid, plannerBuildingId, xy, claimantsMap, grassPoolRatios) {
  return computeTileUtilizationForProducer(
    islandGrid,
    plannerBuildingId,
    xy,
    claimantsMap,
    tileUtilDeps,
    grassPoolRatios
  );
}

module.exports = {
  reconstructIslandFromSaveSlice,
  tileClaimantsForReconstructedIsland,
  grassPoolRatiosForIsland,
  tileUtilizationForEntity,
  tileUtilDeps,
};
