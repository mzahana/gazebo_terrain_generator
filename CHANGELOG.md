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

## Remaining Tasks

### Proper GeoTIFF with Georeferencing and 16-bit Encoding

**File:** `scripts/utils/heightMapGenerator.py`

The heightmap TIFF is currently saved as 8-bit grayscale via PIL with no georeferencing. Two changes are needed:

1. **Upgrade to 16-bit** — Replace the 8-bit (0-255) TIFF with a 16-bit (0-65535) georeferenced GeoTIFF using `rasterio`, reducing elevation stairstepping from ~1.9m to ~0.007m precision.
2. **Add a float32 elevation GeoTIFF** — Write a second `{model}_elevation.tif` with actual AMSL elevation values for use in GIS tools (QGIS, GDAL).
3. **Embed CRS and affine transform** — Both output TIFFs should include EPSG:4326 and a pixel-to-coordinate mapping.

The in-memory `self.heightmap` PIL image must remain 8-bit since downstream code (`buildingsGenerator.py`, `gazeboWorldGenerator.py`) relies on `getpixel()` scaled by `size_z / 255`.

Full implementation details are in `FIXES_PLAN.md` under "Agent 2".
