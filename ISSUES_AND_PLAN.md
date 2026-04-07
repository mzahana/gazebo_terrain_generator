# Issues and Engineering Plan
## Gazebo Terrain Generator — TERCOM/PX4 Simulation Readiness

**Context**: This package generates 3D Gazebo simulation worlds from real-world elevation and satellite data.
The target use case is simulating a PX4 drone with a 1D distance sensor (terrain-relative altitude) and a
barometer (barometric AMSL altitude). The difference between these two measurements gives a terrain elevation
estimate, which is fed into a TERCOM-like algorithm for localization. This requires:

1. A Gazebo world that geometrically and physically represents real terrain accurately.
2. A DEM GeoTIFF that can serve as the TERCOM reference map and is consistent with the Gazebo world.

---

## Issues

---

### Issue 1 — UI Forces Square Regions

**File**: `scripts/UI/main.js:174–185`

When the user draws a rectangular region, the UI detects that `height != width` in tile counts and silently
clips the selection to a square using `Math.min(height, width)`, anchored at the northwest corner:

```js
if (height !== width) {
    var squareSize = Math.min(height, width);
    tileBounds = {
        "northwest": [nw_tile_x, nw_tile_y],
        "northeast": [nw_tile_x + squareSize, nw_tile_y],
        ...
    };
}
```

The toast message even says `"Area snapped to a Square"`. The redrawn polygon on the map reflects this
clipped shape. The user has no way to select a rectangular region.

**Why this matters**: TERCOM trajectory matching over a flight corridor (a typical real-world scenario) requires
a rectangular area that covers the full flight path. Clipping to a square discards part of the selected area.

---

### Issue 2 — Backend Also Forces Square Regions

**File**: `scripts/utils/maptileUtils.py:44–55`

The same square-clipping logic is duplicated in the Python backend:

```python
if height != width:
    max_x_tile = nw_tile_x + min(height, width)
    max_y_tile = nw_tile_y + min(height, width)
```

This means even if the UI were fixed, the backend would still silently clip rectangular regions to squares
during DEM tile stitching, heightmap generation, and ortho generation. Both layers must be fixed together.

---

### Issue 3 — DEM Is Always Downloaded at Hardcoded Zoom Level 13

**File**: `scripts/server.py:39`, `scripts/utils/param.py:11`

The UI zoom level correctly flows into the satellite tile downloads and `metadata.json`, but is **not passed**
to the DEM downloader:

```python
# server.py line 39 — zoom_level is available in scope but ignored:
download_dem_data(true_boundaries, globalParam.DEM_PATH)
# ↑ uses default: zoom_range=(globalParam.DEM_RESOLUTION, globalParam.DEM_RESOLUTION) = (13, 13)
```

`globalParam.DEM_RESOLUTION = 13` is hardcoded in `param.py`. Mapbox Terrain DEM v1 supports up to zoom 15.

| Zoom | Tile GSD (approx, mid-lat) | Underlying data |
|------|---------------------------|-----------------|
| 13   | ~9.6 m/px                 | SRTM upsampled  |
| 14   | ~4.8 m/px                 | SRTM upsampled  |
| 15   | ~2.4 m/px                 | SRTM upsampled  |

Consequence: the DEM is always at the coarsest available resolution regardless of what the user selects in
the UI. The heightmap used in Gazebo and the TERCOM elevation TIF are degraded unnecessarily.

Additionally, `heightMapGenerator.py` reads DEM tiles using `globalParam.DEM_RESOLUTION` (the hardcoded 13),
so even if the download were fixed, the tile-reading code would still look in the wrong zoom directory.

---

### Issue 4 — TERCOM Elevation TIF Is Distorted by Gazebo's Square Resize

**File**: `scripts/utils/heightMapGenerator.py:163–187`

Gazebo's OGRE terrain renderer requires heightmap images to be square with dimensions `2^n + 1` pixels
(e.g., 257, 513, 1025). To satisfy this, the code resizes the heightmap to a square. This is correct for
the Gazebo heightmap PNG/TIF. However, the same square resize is applied to the elevation TIF intended for
TERCOM:

```python
# Line 178 — same square size forced on the TERCOM output:
resized_elevation = cv2.resize(height_map, (size, size), interpolation=cv2.INTER_LINEAR)
```

For a non-square region (e.g., 3 km × 5 km), the resulting elevation TIF has equal pixel counts in X and Y,
but the physical dimensions are different. Any TERCOM implementation that treats pixels as a uniform grid
will compute wrong coordinates.

**Clarification on Gazebo**: The square constraint applies only to the **image file** (heightmap PNG/TIF).
The physical world size in the SDF is set via `<size>$SIZEX$ $SIZEY$ $SIZEZ$</size>` independently, and
Gazebo correctly maps the square image onto a physically rectangular world. The Gazebo representation is
accurate; only the TERCOM TIF is wrong.

---

### Issue 5 — TERCOM Elevation TIF Uses Geographic CRS (EPSG:4326), Not Projected

**File**: `scripts/utils/heightMapGenerator.py:161`

```python
geo_crs = RasterioCRS.from_epsg(4326)
```

In EPSG:4326, pixel spacing is in decimal degrees. A 1° longitude step covers ~111 km at the equator but
~55 km at 60°N. TERCOM algorithms compute terrain profile distances assuming uniform pixel spacing in meters.
Using a geographic CRS means the algorithm will calculate wrong cross-track and along-track distances,
introducing localization errors that grow with latitude.

The correct output for TERCOM is a **projected CRS** — specifically the local UTM zone, which provides
uniform meter-based pixel spacing with sub-millimeter distortion across typical region sizes.

---

### Issue 6 — Vertical Datum Is Not Documented

**File**: `scripts/utils/heightMapGenerator.py:177–187`

The elevation TIF is written with no vertical datum metadata. Mapbox Terrain-RGB encodes **EGM96 orthometric
heights** (approximately equivalent to mean sea level). A PX4 barometer also references MSL, so they are
consistent. However:

- A PX4 configured to use GPS-derived altitude uses WGS84 ellipsoidal height, which differs from EGM96 by
  the geoid undulation — up to ±100 m depending on region.
- The elevation TIF has no sidecar metadata describing source zoom level, min/max elevation, bounds, or
  vertical datum, making it difficult to use without re-reading the file.

Without documentation, users cannot know whether a datum correction is needed for their specific setup.

---

### Issue 7 — WebP Lossy Decoding Causes Elevation Seam Artifacts

**File**: `scripts/utils/demTilesDownloader.py:53–57`

DEM tiles are fetched as WebP (a lossy format) and decoded with `cv2.imdecode`. WebP compression introduces
quantization errors in the RGB channel values. Since elevation is encoded as
`(R×65536 + G×256 + B) × 0.1 − 10000`, a 1-LSB error in R produces a 6553.6 m error; in G, 25.6 m; in B,
0.1 m. In practice WebP quality is high enough that errors are mostly in the B channel (~0.1–0.5 m), but
tile boundary discontinuities are visible when adjacent tiles were compressed independently.

**Fix**: Request the PNG variant of the Mapbox Terrain DEM endpoint (lossless), or request `.webp?sku=...`
with explicit quality settings if PNG is not available.

---

## Engineering Plan

The fixes are ordered by dependency: UI → backend coordinate pipeline → DEM download → heightmap generation →
TERCOM output.

---

### Task 1 — Remove Square Clipping from the UI

**File**: `scripts/UI/main.js`
**Lines**: 174–185, 260–262, 268–270

Remove the `if (height !== width)` branch that forces a square. Allow the tile bounds to be rectangular.
Update the toast message to show tile counts without mentioning "square".

**Specific changes**:

1. Delete the `if (height !== width) { ... }` block at lines 174–185. Replace with a single unconditional
   `tileBounds` assignment using the original NW/NE/SW/SE tile coordinates:
   ```js
   var tileBounds = {
       "northwest": [nw_tile_x, nw_tile_y],
       "northeast": [ne_tile_x, nw_tile_y],
       "southwest": [nw_tile_x, sw_tile_y],
       "southeast": [ne_tile_x, sw_tile_y]
   };
   ```
   Note: NE and SW tile Y/X values must be used correctly — `ne_tile_y` should equal `nw_tile_y` (same
   northern row), `sw_tile_y` should equal `se_tile_y` (same southern row).

2. Update the toast message (line 269) to report actual tile count without the word "Square".

3. Update the `squareTileWidth`/`squareTileHeight` display variables (lines 260–262) to use actual
   rectangular dimensions.

---

### Task 2 — Remove Square Clipping from the Backend

**File**: `scripts/utils/maptileUtils.py`
**Lines**: 44–55 (in `get_max_tilenumber`)

Remove the `if height != width` branch. Return the actual rectangular tile bounds using all four corner
coordinates independently.

**Specific changes**:

Replace:
```python
height, width = abs(nw_tile_x - ne_tile_x), abs(sw_tile_y - nw_tile_y)
if height != width:
    max_x_tile = nw_tile_x + min(height, width)
    max_y_tile = nw_tile_y + min(height, width)
    return { ... clipped ... }
return { ... original ... }
```

With:
```python
return {
    "southwest": (sw_tile_x, sw_tile_y),
    "southeast": (se_tile_x, se_tile_y),
    "northwest": (nw_tile_x, nw_tile_y),
    "northeast": (ne_tile_x, ne_tile_y)
}
```

Verify that `ConcatImage` stitching logic in `heightMapGenerator.py` and `gazeboWorldGenerator.py` handles
non-square tile grids. The `cv2.hconcat` and column-by-column processing do not assume square grids, so
no changes are expected there.

---

### Task 3 — Fix DEM Zoom Level to Use UI Value

**Files**:
- `scripts/server.py` (line 39)
- `scripts/utils/heightMapGenerator.py` (line 92, reading DEM tiles)
- `scripts/utils/param.py` (remove hardcoded `DEM_RESOLUTION` dependency on the read path)

**Specific changes**:

1. In `server.py`, pass `zoom_level` to `download_dem_data`, capped at 15 (Mapbox maximum):
   ```python
   dem_zoom = min(zoom_level, 15)
   download_dem_data(true_boundaries, globalParam.DEM_PATH, zoom_range=(dem_zoom, dem_zoom))
   ```

2. In `GazeboTerrianGenerator.__init__` (`gazeboWorldGenerator.py`), `self.zoom_level` is already read from
   `metadata.json` and already used for ortho and coordinate math. Use this same value for DEM reading.

3. In `heightMapGenerator.generate_rgb_heightmap`, the DEM tile directory is built as:
   ```python
   image_dir = os.path.join(globalParam.DEM_PATH, str(globalParam.DEM_RESOLUTION))
   ```
   Replace `globalParam.DEM_RESOLUTION` with the `zoomlevel` parameter that is already passed to the method:
   ```python
   image_dir = os.path.join(globalParam.DEM_PATH, str(zoomlevel))
   ```

4. Similarly, in `get_amsl` (used for origin/launch altitude lookups), the tile path uses
   `globalParam.DEM_RESOLUTION`. This static method has no access to the instance zoom level. Either:
   - Add a `zoom` parameter to `get_amsl`, or
   - Store the downloaded DEM zoom in `metadata.json` and read it at init time.
   The second option is cleaner and more explicit.

5. Keep `globalParam.DEM_RESOLUTION = 13` as a fallback default only, not as the runtime value.

---

### Task 4 — Generate a Separate, Correct TERCOM Elevation GeoTIFF

**File**: `scripts/utils/heightMapGenerator.py`
**Lines**: 177–187

The TERCOM elevation TIF must be produced from `height_map` **before** any Gazebo-specific resize.
It must use a **projected UTM CRS** with uniform meter-based pixel spacing.

**Specific changes**:

1. After computing `height_map` (line 133) and before the `get_nearest_map_size` resize block, compute and
   save the TERCOM GeoTIFF:

   ```python
   import math as _math
   from rasterio.warp import reproject, Resampling

   # Determine UTM zone from center longitude
   center_lon = (west + east) / 2
   center_lat = (south + north) / 2
   utm_zone = int((center_lon + 180) / 6) + 1
   epsg_utm = 32600 + utm_zone if center_lat >= 0 else 32700 + utm_zone
   utm_crs = RasterioCRS.from_epsg(epsg_utm)

   # Source: float32 height_map in EPSG:4326
   nat_h, nat_w = height_map.shape
   src_transform = from_bounds(west, south, east, north, nat_w, nat_h)
   src_crs = RasterioCRS.from_epsg(4326)

   # Reproject to UTM
   from rasterio.warp import calculate_default_transform
   utm_transform, utm_w, utm_h = calculate_default_transform(
       src_crs, utm_crs, nat_w, nat_h, left=west, bottom=south, right=east, top=north
   )
   utm_elevation = np.empty((utm_h, utm_w), dtype=np.float32)
   reproject(
       source=height_map.astype(np.float32),
       destination=utm_elevation,
       src_transform=src_transform,
       src_crs=src_crs,
       dst_transform=utm_transform,
       dst_crs=utm_crs,
       resampling=Resampling.bilinear,
       src_nodata=-9999.0,
       dst_nodata=-9999.0
   )

   tercom_tif_path = os.path.join(textures_dir, model + '_tercom_dem.tif')
   with rasterio.open(
       tercom_tif_path, 'w',
       driver='GTiff', height=utm_h, width=utm_w,
       count=1, dtype='float32',
       crs=utm_crs, transform=utm_transform,
       nodata=-9999.0
   ) as dst:
       dst.write(utm_elevation, 1)
   ```

2. Remove the current `_elevation.tif` output (lines 177–187) — it is superseded by `_tercom_dem.tif`.
   The `_height_map.tif` (16-bit normalized, square, EPSG:4326) remains unchanged for Gazebo.

3. Write a sidecar JSON file alongside the TERCOM TIF:
   ```json
   {
     "vertical_datum": "EGM96 (orthometric / MSL)",
     "horizontal_crs": "EPSG:<utm_zone>",
     "source": "Mapbox Terrain DEM v1",
     "source_zoom": <zoom_level>,
     "geographic_bounds": {
       "west": <west>, "south": <south>, "east": <east>, "north": <north>
     },
     "elevation_range_m": { "min": <min_height>, "max": <max_height> },
     "pixel_size_m": <utm_pixel_size>,
     "note": "PX4 barometer references MSL (consistent). GPS altitude uses WGS84 ellipsoidal height — apply geoid correction if using GPS altitude directly."
   }
   ```

---

### Task 5 — Fix DEM Tile Download to Use Lossless Format

**File**: `scripts/utils/demTilesDownloader.py`
**Lines**: 51–53`

The current URL requests `.webp` (lossy). Request PNG instead:

```python
tile_url = (
    f"https://api.mapbox.com/raster/v1/mapbox.mapbox-terrain-dem-v1/"
    f"{zoom}/{x}/{y}.png?sku=101CUGorpzzyK&access_token={globalParam.MAPBOX_API_KEY}"
)
```

Verify this endpoint returns a valid PNG for the Mapbox Terrain DEM v1 tileset. If Mapbox does not serve
PNG for this tileset, use `@2x.webp` for higher resolution and accept the small quantization error.

---

### Task 6 — Store DEM Zoom Level in metadata.json

**Files**:
- `scripts/utils/fileWriter.py` (`addMetadata`)
- `scripts/server.py` (`process_end_download`)
- `scripts/utils/gazeboWorldGenerator.py` (`__init__`)
- `scripts/utils/heightMapGenerator.py` (`get_amsl`)

This is required so that `get_amsl` (a static method used for origin/launch altitude lookups) can read DEM
tiles from the correct zoom directory without depending on the global hardcoded constant.

**Specific changes**:

1. In `fileWriter.py:addMetadata`, add `dem_zoom` to the metadata dict and write it to `metadata.json`.

2. In `server.py:process_end_download`, pass `dem_zoom = min(zoom_level, 15)` to `FileWriter.addMetadata`.

3. In `GazeboTerrianGenerator.__init__`, read `dem_zoom` from `metadata.json` and store as `self.dem_zoom`.

4. Change `get_amsl` signature to accept `zoom` as a parameter (or read it from a module-level variable set
   at init time). Update all call sites: `get_true_origin` and `get_launch_location`.

---

## Summary Table

| Task | Files Changed | Fixes Issues |
|------|---------------|--------------|
| 1 — Remove UI square clipping | `main.js` | Issue 1 |
| 2 — Remove backend square clipping | `maptileUtils.py` | Issue 2 |
| 3 — Fix DEM zoom level | `server.py`, `heightMapGenerator.py`, `param.py` | Issue 3 |
| 4 — Correct TERCOM GeoTIFF | `heightMapGenerator.py` | Issues 4, 5, 6 |
| 5 — Lossless DEM tile download | `demTilesDownloader.py` | Issue 7 |
| 6 — Store DEM zoom in metadata | `fileWriter.py`, `server.py`, `gazeboWorldGenerator.py`, `heightMapGenerator.py` | Issue 3 (completeness) |

**Recommended implementation order**: Task 6 → Task 3 → Task 5 → Task 2 → Task 1 → Task 4.
Tasks 2 and 1 must be done together (backend before UI is safer). Task 4 depends on Tasks 3 and 6 being
complete so the correct zoom is used end-to-end before the TERCOM TIF is generated.

---

## Notes on Gazebo Accuracy for PX4 Simulation

- The Gazebo heightmap image must remain square (`2^n + 1`). The physical world size in the SDF
  (`<size>X Y Z</size>`) is independent and can be rectangular. This is already handled correctly.
- The distance sensor in Gazebo measures range to the heightmap mesh, which is derived from the normalized
  8-bit PIL image (`self.heightmap`) scaled by `size_z`. The `size_z = max_height - min_height` is correct.
- The barometer in Gazebo should be initialized with the `ORIGIN_ELEVATION` written into the world SDF,
  which comes from `get_amsl` at the map center. This value must come from the correct DEM zoom level
  (fixed by Task 6).
- After all fixes, the `_tercom_dem.tif` and the Gazebo terrain are derived from the same source tile data
  at the same zoom level, guaranteeing consistency between the simulation environment and the TERCOM
  reference map.
