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
**Status**: Done  
**Files changed**: `scripts/utils/demTilesDownloader.py`

- Changed tile URL from `.webp` (lossy) to `.png` (lossless) in `download_tile_image`.
- Eliminates quantization artifacts at tile boundaries caused by WebP compression.

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
