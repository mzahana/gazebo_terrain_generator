# Task Tracking — Gazebo Terrain Generator TERCOM/PX4 Readiness

See `ISSUES_AND_PLAN.md` for full context, issue descriptions, and implementation details.

Recommended implementation order: Task 6 → Task 3 → Task 5 → Task 2 → Task 1 → Task 4.

---

## Completed

### Task 6 — Store DEM Zoom Level in metadata.json
**Status**: Done  
**Files changed**: `scripts/utils/fileWriter.py`, `scripts/server.py`, `scripts/utils/gazeboWorldGenerator.py`

- Added `dem_zoom` parameter to `FileWriter.addMetadata`; written to `metadata.json`.
- `server.py:start_download` computes `dem_zoom = min(zoom_level, 15)` and passes it to `addMetadata`.
- `GazeboTerrianGenerator.__init__` reads `dem_zoom` from `metadata.json` (falls back to `globalParam.DEM_RESOLUTION` for old metadata files).
- `get_true_origin` and `get_launch_location` now pass `self.dem_zoom` to `HeightmapGenerator.get_amsl`.

---

### Task 3 — Fix DEM Zoom Level to Use UI Value
**Status**: Done  
**Files changed**: `scripts/server.py`, `scripts/utils/heightMapGenerator.py`

- `server.py:process_end_download` computes `dem_zoom = min(zoom_level, 15)` and passes it as `zoom_range=(dem_zoom, dem_zoom)` to `download_dem_data`.
- `HeightmapGenerator.get_amsl` now accepts a `zoom` parameter (defaults to `globalParam.DEM_RESOLUTION` for backwards compatibility); all internal tile path lookups use `zoom`.
- `HeightmapGenerator.generate_rgb_heightmap` now uses `zoomlevel` (already passed as parameter) instead of `globalParam.DEM_RESOLUTION` for `get_max_tilenumber`, `image_dir`, and `get_true_boundaries`.

---

### Task 5 — Fix DEM Tile Download to Use Lossless Format
**Status**: Superseded — switched to Maps API v4 with `.pngraw`  
**Files changed**: `scripts/utils/demTilesDownloader.py`

- Original plan changed `.webp` → `.png` on the Raster Tiles API v1 endpoint, which returned 404 (tileset has no `.png`).
- Raster Tiles API v1 (`/raster/v1/mapbox.mapbox-terrain-dem-v1/`) also returned 401 Unauthorized because it requires a separate Mapbox plan beyond the free tier.
- **Final fix**: switched to the Maps API v4 endpoint (`/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw`) which is accessible on all Mapbox accounts and returns lossless PNG — achieving the original lossless goal.
- Removed the hardcoded `sku=101CUGorpzzyK` parameter (a client-side SDK token that caused rejections on server-to-server requests).

---

### Task 3 Bug Fix — `generate_rgb_heightmap` called with satellite zoom, not DEM zoom
**Status**: Fixed  
**Files changed**: `scripts/utils/gazeboWorldGenerator.py`

- `generate_gazebo_world` was passing `self.zoom_level` (satellite zoom, e.g. 18) to `generate_rgb_heightmap`, causing it to look for DEM tiles in `/output/dem/18` instead of `/output/dem/15`.
- Fixed by passing `self.dem_zoom` instead.

---

### Bug Fix — `<elevation>None</elevation>` written to world SDF
**Status**: Fixed  
**Files changed**: `scripts/utils/heightMapGenerator.py`, `scripts/utils/demTilesDownloader.py`, `scripts/server.py`

- Root cause: `get_amsl` returned Python `None` when the DEM tile file was missing on disk. This was silently string-interpolated into the SDF template as the literal text `"None"`, producing `<elevation>None</elevation>` and breaking simulation.
- Tile files were missing because: (a) zoom-15 tiles returned 401/404 so nothing was written to disk, yet `self.dem_zoom=15` was stored in metadata; (b) `get_amsl` had no fallback — it returned `None` instead of raising.
- **`demTilesDownloader.py`**: `download_dem_data` now returns the actual zoom level used. If the requested zoom yields 0 successfully downloaded tiles, it automatically retries at `globalParam.DEM_RESOLUTION` (zoom 13).
- **`server.py`**: Uses the returned actual zoom; if it differs from the requested zoom (fallback triggered), rewrites `dem_zoom` in `metadata.json` so `GazeboTerrianGenerator` reads the correct zoom.
- **`heightMapGenerator.py` — `get_amsl`**: Now tries `globalParam.DEM_RESOLUTION` as fallback if the tile is missing at the requested zoom. Raises `FileNotFoundError` with a clear message instead of returning `None`.

---

### Bug Fix — Gazebo OGRE2 Terra crash on heightmaps larger than 2049×2049
**Status**: Fixed  
**Files changed**: `scripts/utils/heightMapGenerator.py`, `scripts/utils/param.py`

- After removing square clipping (Tasks 1 & 2), rectangular regions combined with coarser DEM fallback tiles produced large stitched images. `get_nearest_map_size` returned 4097 (2^12+1) for these inputs.
- Gazebo gz-sim-7 OGRE2 Terra renderer asserts `m_shadowStarts->getNumElements() >= (m_heightMapTex->getHeight() << 4u)` and crashes for heightmaps larger than 2049×2049.
- Added `globalParam.HEIGHTMAP_MAX_SIZE = 2049` (2^11+1) and capped `get_nearest_map_size` output at this value.
- Physical world dimensions in the SDF (`$SIZEX$ $SIZEY$`) are independent of image pixel count and are unaffected.

---

### Task 2 — Remove Square Clipping from the Backend
**Status**: Done  
**Files changed**: `scripts/utils/maptileUtils.py`

- Removed the `if height != width` branch in `get_max_tilenumber`.
- Now returns actual rectangular tile bounds using all four corner coordinates independently.

---

### Task 1 — Remove Square Clipping from the UI
**Status**: Done  
**Files changed**: `scripts/UI/main.js`

- Removed the `if (height !== width)` block; `tileBounds` is now assigned unconditionally using the true NW/NE/SW/SE tile coordinates.
- Updated tile dimension display variables to use actual width × height.
- Updated toast message to `"Area selected: W × H tiles (N total)"` — no longer mentions "Square".

---

### Task 4 — Generate a Separate, Correct TERCOM Elevation GeoTIFF
**Status**: Done  
**Files changed**: `scripts/utils/heightMapGenerator.py`

- Replaced `_elevation.tif` (square, EPSG:4326) with `_tercom_dem.tif` in the local UTM zone CRS.
- Reproject uses `rasterio.warp.reproject` with bilinear resampling at native (non-square) resolution, computed before the Gazebo square resize.
- Sidecar JSON (`_tercom_dem.json`) written alongside the TIF with vertical datum, UTM EPSG code, source zoom, geographic bounds, elevation range, and pixel size in metres.
- Added `json`, `reproject`, `Resampling`, and `calculate_default_transform` imports.
