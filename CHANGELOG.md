# Changelog

## 2026-05-14 — DSM Export for Satellite-Tile Orthorectification

### Added: Optional Digital Surface Model export

**Files:** `scripts/utils/dsmGenerator.py` (new), `scripts/utils/gazeboWorldGenerator.py`, `scripts/server.py`, `scripts/UI/index.htm`, `scripts/UI/main.js`

Added a new "Export DSM" UI toggle that produces a `<model>_dsm.tif` Digital Surface Model alongside the existing TERCOM DEM. The DSM is built by rasterizing OpenStreetMap building footprints — already downloaded via the buildings vector tiles — at their OSM heights onto the bare-earth TERCOM DEM grid: `DSM(pixel) = terrain_AMSL(pixel) + building_height_above_ground(pixel)`.

**Why:** Off-nadir satellite imagery used as a UAV-localisation reference (e.g. Esri / Maxar tiles in dense-urban areas) bakes building-top parallax into the tile pixels — rooftops are displaced from their true ground footprints by `h · tan(θ_sat)`, which can reach 50–200 m in midtown Manhattan. A DSM is the geometric input required to undo this displacement offline, before the tiles are consumed by a matching pipeline. The terrain generator already downloads both the bare-earth DEM and OSM building heights — exporting them as a single co-registered DSM raster makes it a one-stop data source for orthorectification workflows.

**Design decisions:**

- **Decoupled from the Gazebo "Include Buildings" toggle.** Enabling DSM export only triggers the OSM building data download for rasterization; it does *not* extrude buildings into Gazebo `.dae` meshes or add them to the SDF. This lets the Gazebo simulation stay on flat terrain with the satellite texture (the controlled experimental setup for cross-view matching) while still producing the DSM artifact for offline use.
- **No PX4 vertical shift applied.** The DSM is built directly on the TERCOM DEM (absolute AMSL, float32, UTM-projected, native resolution), which is unaffected by the PX4 Compatibility toggle. The sidecar `_dsm.json` records `"px4_shift_applied": false` for traceability.
- **Same CRS, transform, and pixel grid as the TERCOM DEM**, so the DSM is a drop-in replacement wherever the DEM was being read. The output is byte-identical in geometry to the TERCOM TIF — only the elevation values differ where buildings exist.
- **Off by default.** The toggle is unchecked on UI load. DSM export is only worthwhile for dense-urban scenes (buildings > ~30 m); in rural / desert / suburban regions the rasterized DSM is virtually identical to the DEM and the extra building download is a net negative.
- **Independent failure mode.** If the DSM step fails (e.g. unreadable geojson), it logs a warning and continues — the rest of the world generation is unaffected.

**Output (when toggle enabled):**

```
<model>/textures/
├── <model>_dsm.tif    # float32, UTM, AMSL, matches _tercom_dem.tif geometry
└── <model>_dsm.json   # sidecar: building_count, height range, CRS, datum, px4_shift_applied=false
```

**Server / UI plumbing:**

- New `export_dsm` flag flows from the UI through `/end-download` → `process_end_download` → `GazeboTerrianGenerator(..., export_dsm=...)`.
- The building download is now triggered by `include_buildings OR export_dsm` — same dataset, two independent consumers.
- Mesh generation (`GeoJSONToDAE`) and SDF inclusion remain gated by `include_buildings` alone, so Gazebo output is unchanged when only DSM is requested.

---

## 2026-05-02 — Square Geographic Bounding Box & PX4 Vertical Offset Toggle

### Added: Square Geographic Bounding Box Enforcement

**Files:** `scripts/UI/main.js`, `scripts/utils/gazeboWorldGenerator.py`, `scripts/utils/heightMapGenerator.py`

To fix Gazebo's visual map stretching issue (Gazebo requires perfectly square terrain images), the WebUI now automatically enforces a perfect geographic square bounding box using `turf.js`. When a user draws a region, it instantly snaps to the largest square dimension. 

On the backend, `gazeboWorldGenerator.py` and `heightMapGenerator.py` are updated to precisely crop the downloaded Mapbox tiles to this exact square boundary, using sub-pixel Web Mercator calculations. This ensures Gazebo accurately renders the map 1:1 without any distortion or alignment drift.

---

### Added: PX4 SITL Compatibility Toggle & NavSat Elevation Fix

**Files:** `scripts/UI/index.html`, `scripts/UI/main.js`, `scripts/server.py`, `scripts/utils/gazeboWorldGenerator.py`, `scripts/utils/fileWriter.py`

Added a UI toggle for "PX4 SITL Compatible (Apply Vertical Offset)". 
- **If Enabled (Default):** The terrain is shifted down so the lowest point is at `Z=0` in Gazebo, preventing negative spawn coordinates for PX4 SITL. 
- **If Disabled:** The terrain is placed precisely at its true AMSL altitude in Gazebo.

**Bug Fix:** Fixed an issue where the Gazebo world `origin_elevation` was being incorrectly written as the `launch_altitude` instead of the `min_height` when the terrain was shifted to `Z=0`. This caused the Gazebo NavSat plugin to double-count altitude, producing massive errors in GPS altitude sent to PX4. The `origin_elevation` is now perfectly mathematically aligned depending on the PX4 Compatibility mode.

**Bug Fix (UI & Backend):** Resolved a `TypeError` (`object.__init__() takes exactly one argument`) by refactoring the `GazeboTerrianGenerator` instantiation to avoid redundant argument propagation in the Python MRO chain. Also fixed an issue where the generation sidebar in the Web UI appeared transparent or failed to show progress by adding an explicit background color and z-index to the sidebar CSS.

---
## 2026-04-07 — PX4-Compatible World SDF

### Added: PX4-ready Gazebo world file (`_px4.sdf`)

**Files:** `templates/px4_world.txt`, `scripts/utils/fileWriter.py`, `scripts/utils/gazeboWorldGenerator.py`

The generator now produces an additional `<model_name>_px4.sdf` world file alongside the existing world SDF. This file is designed to be directly usable with PX4 SITL simulation in Gazebo Harmonic without manual editing.

**What it includes:**
- **ODE physics** at 250 Hz (`max_step_size=0.004`, matching PX4 SITL requirements).
- **All PX4-required system plugins**: Physics, UserCommands, SceneBroadcaster, Contact, Imu, AirPressure, ApplyLinkWrench, NavSat, and Sensors (ogre2).
- **GUI plugins**: 3D View, WorldControl (starts paused), WorldStats, and EntityTree.
- **Dynamic isometric camera view**: Camera position is computed from terrain dimensions so the initial view shows the full terrain from a front-left isometric angle (~35° pitch), instead of the default side view that made it hard to see the terrain.
- **Spherical coordinates** with the launch location's lat/lon/elevation.
- Scene settings with shadows, no grid, and directional sunlight with realistic attenuation.

The PX4 world file is saved to both the model directory and the worlds directory.

---

## 2026-04-07 — Post-TERCOM Bug Fixes

### Fixed: Gazebo OGRE2 Terra crash on large heightmaps

**Files:** `scripts/utils/heightMapGenerator.py`, `scripts/utils/param.py`

After removing square clipping (rectangular region support), combined with DEM fallback to zoom 13 (coarser tiles covering a larger area), `get_nearest_map_size` could return 4097 (2^12+1). The OGRE2 Terra shadow mapper in gz-sim-7 asserts and aborts for heightmaps larger than 2049×2049:

```
Assertion `m_shadowStarts->getNumElements() >= (m_heightMapTex->getHeight() << 4u)' failed.
```

Added `globalParam.HEIGHTMAP_MAX_SIZE = 2049` and capped the output of `get_nearest_map_size` at this value. Physical world size in the SDF is set independently and is unaffected.

---

### Fixed: `<elevation>None</elevation>` written to world SDF

**Files:** `scripts/utils/heightMapGenerator.py`, `scripts/utils/demTilesDownloader.py`, `scripts/server.py`

`get_amsl` returned Python `None` when its DEM tile file was missing on disk. This `None` was silently string-interpolated into the SDF template, producing `<elevation>None</elevation>` and causing simulation failures.

Root cause chain:
1. DEM tiles at the requested zoom were not downloaded (401/404 from Mapbox).
2. `metadata.json` still stored the requested (failed) zoom.
3. `get_amsl` received that zoom, found no file, and returned `None` with no error.

Fixes applied across three files:
- **`demTilesDownloader.py`**: `download_dem_data` now returns the actual zoom used. If the requested zoom yields 0 tiles, it automatically retries at the fallback zoom 13.
- **`server.py`**: Rewrites `dem_zoom` in `metadata.json` if a fallback zoom was used.
- **`heightMapGenerator.py` — `get_amsl`**: Falls back to `globalParam.DEM_RESOLUTION` if the tile is missing at the requested zoom. Raises `FileNotFoundError` instead of returning `None`.

---

### Fixed: DEM tile download endpoint (401 Unauthorized / lossless PNG)

**File:** `scripts/utils/demTilesDownloader.py`

The Mapbox Raster Tiles API v1 endpoint (`/raster/v1/mapbox.mapbox-terrain-dem-v1/`) returned 401 Unauthorized because it requires a paid Mapbox plan beyond the free tier. A previous attempt to switch from `.webp` to `.png` on the same endpoint returned 404 (the tileset does not serve PNG). The hardcoded `sku=101CUGorpzzyK` parameter (a client-side SDK token) also caused server-to-server request rejections.

Switched to the **Maps API v4** endpoint with `.pngraw`:
```
https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token=...
```
This endpoint is available on all Mapbox accounts (including free tier), returns lossless PNG, and uses the identical Terrain-RGB encoding. The `sku` parameter has been removed.

---

### Fixed: Heightmap generation used satellite zoom instead of DEM zoom

**File:** `scripts/utils/gazeboWorldGenerator.py`

`generate_gazebo_world` was calling `generate_rgb_heightmap(self.tile_path, self.boundaries, self.zoom_level)` where `self.zoom_level` is the satellite imagery zoom (e.g. 18). DEM tiles are stored under their own zoom directory (e.g. `/output/dem/15/`), so the heightmap generator looked for `/output/dem/18/` and crashed with `No such file or directory`. Fixed by passing `self.dem_zoom` instead.

---

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

### Fixed: DEM Tiles Downloaded as Lossless PNG (via Maps API v4)

**File:** `scripts/utils/demTilesDownloader.py`

DEM tiles were fetched as `.webp` (lossy compression) from the Raster Tiles API v1 endpoint. The goal was to switch to lossless PNG to eliminate quantization artifacts (~25.6 m noise in the green channel, seam artifacts at tile boundaries). The initial fix used `.png` on the same endpoint, which returned 404. See the 2026-04-07 bug fix section above for the final resolution using the Maps API v4 `.pngraw` endpoint.

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
