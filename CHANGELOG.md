# Changelog

## 2026-04-07 — TERCOM/PX4 Simulation Readiness

### Fixed: Rectangular Region Support (UI and Backend)

**Files:** `scripts/UI/main.js`, `scripts/utils/maptileUtils.py`

The UI and backend both silently clipped any rectangular selection to a square by taking `Math.min(height, width)`. This made it impossible to generate terrain for non-square flight corridors required by TERCOM trajectory matching.

**UI (`main.js`):** Removed the `if (height !== width)` branch. `tileBounds` is now assigned unconditionally from the true NW/NE/SW/SE tile coordinates. The toast message now reports actual tile dimensions (`W × H tiles`) instead of `"Area snapped to a Square"`.

**Backend (`maptileUtils.py` — `get_max_tilenumber`):** Removed the `if height != width` branch. The function now returns all four corner tile coordinates verbatim, allowing rectangular tile grids to pass through DEM stitching, heightmap generation, and ortho generation unchanged.

---

### Fixed: DEM Downloaded and Read at UI Zoom Level

**Files:** `scripts/server.py`, `scripts/utils/heightMapGenerator.py`

The DEM was always downloaded and read at the hardcoded zoom level 13 (`globalParam.DEM_RESOLUTION`) regardless of what the user selected in the UI. Mapbox Terrain DEM v1 supports up to zoom 15 (~2.4 m/px GSD).

- `server.py`: `process_end_download` now computes `dem_zoom = min(zoom_level, 15)` and passes it as `zoom_range=(dem_zoom, dem_zoom)` to `download_dem_data`.
- `heightMapGenerator.generate_rgb_heightmap`: Uses the `zoomlevel` parameter (already passed) instead of `globalParam.DEM_RESOLUTION` for the tile directory path and all tile lookups.
- `HeightmapGenerator.get_amsl`: Now accepts a `zoom` parameter (defaults to `globalParam.DEM_RESOLUTION` for backward compatibility). All call sites pass `self.dem_zoom` read from `metadata.json`.

---

### Fixed: DEM Zoom Level Stored in metadata.json

**Files:** `scripts/utils/fileWriter.py`, `scripts/server.py`, `scripts/utils/gazeboWorldGenerator.py`

`get_amsl` is a static method with no access to instance state. To avoid depending on the hardcoded global, the DEM zoom is now written to `metadata.json` at download time and read back at world-generation time.

- `fileWriter.py:addMetadata`: Added `dem_zoom` field written to `metadata.json`.
- `server.py:start_download`: Computes and passes `dem_zoom = min(zoom_level, 15)` to `addMetadata`.
- `GazeboTerrianGenerator.__init__`: Reads `dem_zoom` from `metadata.json` (falls back to `globalParam.DEM_RESOLUTION` for old files); stores as `self.dem_zoom` and passes it to all `get_amsl` calls.

---

### Fixed: DEM Tiles Downloaded as Lossless PNG

**File:** `scripts/utils/demTilesDownloader.py`

DEM tiles were fetched as `.webp` (lossy compression). WebP quantization errors in the green channel produce ~25.6 m elevation noise; tile boundary seam artifacts were visible in stitched heightmaps.

Changed the Mapbox Terrain DEM v1 tile URL from `.webp` to `.png` (lossless), eliminating quantization artifacts entirely.

---

### Fixed: TERCOM Elevation GeoTIFF Now Uses UTM Projected CRS

**File:** `scripts/utils/heightMapGenerator.py` — `generate_rgb_heightmap()`

The previous `{model}_elevation.tif` had two problems for TERCOM use:

1. **Distorted by Gazebo's square resize** — Gazebo requires a `2^n+1` square image. The same resize was applied to the elevation TIF, making pixel counts equal in X and Y even for physically rectangular regions. TERCOM algorithms that treat pixels as a uniform grid computed wrong coordinates.
2. **Geographic CRS (EPSG:4326)** — Pixel spacing was in decimal degrees. A 1° longitude step varies from ~111 km (equator) to ~55 km (60°N), introducing latitude-dependent distance errors in TERCOM profile matching.

**Changes:**

- Replaced `{model}_elevation.tif` with `{model}_tercom_dem.tif`. The new file is written **before** the Gazebo square resize at native (rectangular) resolution.
- Reprojected to the local UTM zone (`EPSG:326xx` / `EPSG:327xx`) using `rasterio.warp.reproject` with bilinear resampling, giving uniform metre-based pixel spacing.
- Added sidecar `{model}_tercom_dem.json` recording:
  - `vertical_datum`: `"EGM96 (orthometric / MSL)"` — consistent with PX4 barometer; GPS altitude users must apply a geoid correction.
  - `horizontal_crs`: UTM EPSG code for the region.
  - `source` / `source_zoom`: Mapbox Terrain DEM v1 and the zoom level used.
  - `geographic_bounds`: WGS84 west/south/east/north.
  - `elevation_range_m`: min and max AMSL elevation in the tile.
  - `pixel_size_m`: cell size in metres.

The Gazebo `{model}_height_map.tif` (16-bit, square, EPSG:4326) is unchanged.

---

## Fixed: Minimum Terrain Altitude Should Be Zero

**File:** `scripts/utils/gazeboWorldGenerator.py` — `get_world_dimensions()`

The `get_world_dimensions()` method previously computed `pose_z` by looking up the launch pad's pixel value in the heightmap and negating it, which placed the terrain floor at a negative world-z coordinate. This caused PX4 autopilot to reject drones spawned in valleys below the launch pad due to negative altitude values.

**Before:**
```python
launch_px, launch_py = self.get_launch_pixelcord(...)
launch_height = self.heightmap.getpixel((launch_px, launch_py)) * self.size_z / 255
pose_z = round(-1 * (launch_height + 0.03 * launch_height), 2)
```
Example output: `pose_z = -176.66` (taif_map)

**After:**
```python
pose_z = 0.0
```

Terrain floor now starts at z=0; all terrain points have non-negative world-z coordinates.

---

## Fixed: Proper GeoTIFF with Georeferencing and 16-bit Encoding

**File:** `scripts/utils/heightMapGenerator.py` — `generate_rgb_heightmap()`

The heightmap TIFF was previously saved as 8-bit grayscale via PIL with no georeferencing. This caused two issues: low elevation precision (~1.9m stairstepping over mountainous terrain) and no geographic metadata for GIS tools.

**Changes:**
1. **Upgraded to 16-bit** — The Gazebo heightmap TIF (`{model}_height_map.tif`) is now 16-bit unsigned int (0–65535) written via `rasterio`, reducing elevation stairstepping from ~1.9m to ~0.007m precision.
2. **Added float32 elevation GeoTIFF** — A new `{model}_elevation.tif` contains actual AMSL elevation values (float32) for use in GIS tools (QGIS, GDAL).
3. **Embedded CRS and affine transform** — Both output TIFFs include EPSG:4326 (WGS84) and a pixel-to-coordinate mapping derived from the region's true boundaries.

The in-memory `self.heightmap` PIL image remains 8-bit since downstream code (`buildingsGenerator.py`, `gazeboWorldGenerator.py`) relies on `getpixel()` scaled by `size_z / 255`.
