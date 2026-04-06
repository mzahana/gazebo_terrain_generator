# Changelog

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
