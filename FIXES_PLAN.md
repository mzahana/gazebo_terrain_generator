# Fix Plan: Terrain Altitude Origin & GeoTIFF Quality

This document is a brief for two independent agents. Each section is self-contained and describes
exactly what needs to be changed, why, and how.

---

## Agent 1 — Fix: Minimum Terrain Altitude Should Be Zero

### Project Context

This is a Python/Flask tool that generates Gazebo simulation worlds from real-world elevation data.
The generation pipeline downloads DEM tiles from Mapbox, decodes them into a floating-point
elevation map, normalizes it to a grayscale heightmap image (0–255), and writes Gazebo SDF model
files. The end result is a `.sdf` model file that Gazebo loads as a 3D terrain.

The heightmap image encodes terrain as pixel values 0–255:
- Pixel value `0` → lowest terrain point in the region (= `min_height` AMSL)
- Pixel value `255` → highest terrain point in the region (= `max_height` AMSL)

In the Gazebo SDF, the heightmap model has two key parameters set in
`templates/sdf_temp.txt`:
```xml
<size>$SIZEX$ $SIZEY$ $SIZEZ$</size>
<pos>$POSX$ $POSY$ $POSZ$</pos>
```

Gazebo computes the actual world-space z-elevation of any terrain point as:
```
world_z = POSZ + (pixel_value / 255) * SIZEZ
```

So `POSZ` is the **world z of the terrain floor** (the lowest point), and `SIZEZ` is the total
elevation range in meters.

### The Problem

In [`scripts/utils/gazeboWorldGenerator.py`](scripts/utils/gazeboWorldGenerator.py), the method
`get_world_dimensions()` (lines 248–285) computes `pose_z` (`POSZ`) as follows:

```python
# lines 273–283
launch_px, launch_py = self.get_launch_pixelcord(
    true_boundaries["southwest"],
    true_boundaries["northeast"],
    self.heightmap.size[0],
    self.heightmap.size[1],
    launch_location
)

# Calculate launch height and pose offset
launch_height = self.heightmap.getpixel((launch_px, launch_py)) * self.size_z / 255
pose_z = round(-1 * (launch_height + 0.03 * launch_height), 2)
```

The intent was to place the **launch pad** at world z ≈ 0 so that spawning a drone at z=0
puts it at the launch pad elevation. But this makes the terrain **floor** (pixel=0) land at a
negative world z:

```
terrain_floor_z = pose_z = -(launch_height * 1.03)
```

Any terrain point lower than the launch pad gets a negative world z. PX4 autopilot (used with
Gazebo simulations) rejects negative initial altitude values, so a drone spawned in a valley
below the launch pad will be refused or will behave incorrectly.

**Concrete example — the existing `output/gazebo_terrain/taif_map/model.sdf`:**
```xml
<pose>71.26 -70.85 -176.66 0 0 0</pose>
<size>2993.04 2975.35 475.4</size>
<pos>71.26 -70.85  -176.66</pos>
```
- `size_z` = 475.4 m (elevation range)
- `pose_z` = −176.66 m → the **minimum** terrain is at world z = −176.66 m
- Maximum terrain is at world z = −176.66 + 475.4 = 298.74 m
- The launch pad is near z = 0, but any terrain below the launch pad is at negative z

### The Fix

`POSZ` should always be `0.0`. This makes the terrain floor (pixel=0) start at world z=0,
guaranteeing no negative terrain altitudes.

The `launch_px`, `launch_py`, and `launch_height` variables are only used to compute `pose_z`
and serve no other purpose in the method. They can be removed along with the pixel-based
`pose_z` formula.

**File to edit:** [`scripts/utils/gazeboWorldGenerator.py`](scripts/utils/gazeboWorldGenerator.py)

**Current code (lines 273–283) inside `get_world_dimensions()`:**
```python
        launch_px, launch_py = self.get_launch_pixelcord(
            true_boundaries["southwest"], 
            true_boundaries["northeast"], 
            self.heightmap.size[0], 
            self.heightmap.size[1],
            launch_location
        )

        # Calculate launch height and pose offset
        launch_height = self.heightmap.getpixel((launch_px, launch_py)) * self.size_z / 255
        pose_z = round(-1 * (launch_height + 0.03 * launch_height), 2)  
```

**Replace with:**
```python
        pose_z = 0.0
```

The `get_launch_pixelcord()` method itself (lines 187–210) is still called from elsewhere
and must NOT be deleted.

### Cascade Effects to Verify (No Code Changes Required)

After the fix, verify that the following downstream code behaves correctly with `pose_z = 0`:

**1. Buildings SDF link pose — [`scripts/utils/fileWriter.py:233`](scripts/utils/fileWriter.py#L233)**

```python
<pose>0 0 {-origin_height:.2f} 0 0 0</pose>
```

`origin_height` is the `pose_z` value passed in. With `pose_z = 0`, the buildings link pose
becomes `<pose>0 0 0 0 0 0</pose>`. This is correct — buildings and terrain share the same
z-origin.

**2. Building footprint terrain lookup — [`scripts/utils/buildingsGenerator.py:120–124`](scripts/utils/buildingsGenerator.py#L120-L124)**

```python
local_z = (pixel_val / 255.0) * self.size_z
return local_z + self.pose_z
```

With `self.pose_z = 0`, this returns `local_z` (always ≥ 0). Buildings sit correctly on
terrain.

**3. World file GPS elevation — [`scripts/utils/gazeboWorldGenerator.py:184`](scripts/utils/gazeboWorldGenerator.py#L184)**

```python
FileWriter.write_world_file(..., launch_cord["altitude"], ...)
```

`launch_cord["altitude"]` is the AMSL GPS altitude of the launch pad fetched from DEM tiles.
This populates `<elevation>` inside `<spherical_coordinates>` in the world file and is
independent of `pose_z`. It must not change.

### Expected Output After Fix

Regenerated `model.sdf` for taif_map should contain:
```xml
<pose>71.26 -70.85 0.0 0 0 0</pose>
<size>2993.04 2975.35 475.4</size>
<pos>71.26 -70.85 0.0</pos>
```

- Minimum terrain in Gazebo: z = 0.0 m
- Maximum terrain in Gazebo: z = 475.4 m
- Launch pad: z = some positive value within [0, 475.4]

---

## Agent 2 — Fix: Proper GeoTIFF with Georeferencing and 16-bit Encoding

### Project Context

This is a Python/Flask tool that generates Gazebo simulation worlds from real-world elevation data.
One key output is a heightmap TIFF file that Gazebo uses to render 3D terrain. The generation
pipeline downloads DEM tiles from Mapbox, decodes RGB pixel values into floating-point elevation
(meters AMSL), normalizes that to a grayscale image, and saves it as a TIFF.

The heightmap file is saved to:
```
{GAZEBO_MODEL_PATH}/{model_name}/textures/{model_name}_height_map.tif
```

This file serves two purposes:
1. **Gazebo simulation** — Gazebo reads it as a grayscale heightmap and scales pixel values by
   `size_z` (the elevation range in meters) to reconstruct terrain heights.
2. **GIS / external tools** — ideally it should be inspectable in QGIS, GDAL, or similar tools
   with proper geographic metadata.

### The Problem

In [`scripts/utils/heightMapGenerator.py`](scripts/utils/heightMapGenerator.py), the method
`generate_rgb_heightmap()` (lines 80–158) ends with:

```python
# lines 151–153
self.heightmap = Image.fromarray(resized_map, mode='L')  # 'L' for 8-bit grayscale
self.heightmap.save(os.path.join(globalParam.GAZEBO_MODEL_PATH, model, 'textures', model+'_height_map.tif'), format="TIFF")
```

Where `resized_map` is a `uint8` numpy array (values 0–255).

There are two problems:

**Problem A — 8-bit encoding is low precision.**
With 256 discrete levels, over a 475 m elevation range (like taif_map), each level represents
~1.9 m. For hilly or mountainous terrain this introduces visible stairstepping. Gazebo supports
16-bit grayscale TIFFs, which would give ~0.007 m precision over the same range.

**Problem B — No georeferencing.**
PIL's `Image.save()` writes a plain TIFF with no embedded CRS or affine transform. The file
has no information about where on Earth it is located or how pixels map to geographic coordinates.
Tools like QGIS, GDAL, or rasterio cannot interpret the file geographically.

`rasterio` is already listed in `requirements.txt` and is even imported at
[`scripts/utils/gazeboWorldGenerator.py:16`](scripts/utils/gazeboWorldGenerator.py#L16), but
it is never used for writing.

### The Fix

In `generate_rgb_heightmap()`, replace the PIL TIFF save (lines 151–153) with two rasterio
writes. The geographic bounding box needed for the affine transform is already computed earlier
in the same method as `true_boundaries` (line 84).

**Two output files:**

1. **`{model}_height_map.tif`** — replaces the existing file.
   - 16-bit unsigned int, values normalized 0–65535 (upgraded from 8-bit 0–255).
   - Embedded CRS: EPSG:4326 (WGS84 geographic).
   - Embedded affine transform mapping pixels to lat/lon coordinates.
   - This is the file Gazebo reads. Gazebo handles 16-bit TIFFs natively; no SDF changes needed.

2. **`{model}_elevation.tif`** — new additional file.
   - float32, values are actual AMSL elevation in meters (not normalized).
   - Same CRS and affine transform as above.
   - For use in GIS tools; not referenced by Gazebo.

**The `self.heightmap` in-memory PIL image must remain 8-bit.** It is used downstream for
pixel-value lookups in two places:
- [`scripts/utils/gazeboWorldGenerator.py:282`](scripts/utils/gazeboWorldGenerator.py#L282):
  `self.heightmap.getpixel((launch_px, launch_py)) * self.size_z / 255`
- [`scripts/utils/buildingsGenerator.py:116`](scripts/utils/buildingsGenerator.py#L116):
  `pixel_val = self.heightmap.getpixel((px, py))`
  then `local_z = (pixel_val / 255.0) * self.size_z`

Both scale by `size_z / 255` assuming 8-bit. The in-memory image must stay 8-bit to avoid
breaking these calculations.

### Full Current Code of `generate_rgb_heightmap()` (for reference)

```python
def generate_rgb_heightmap(self, model_path, boundaries, zoomlevel) -> list:

    bound_array = boundaries.split(',')
    true_boundaries = maptile_utiles.get_true_boundaries(bound_array, zoomlevel)      # line 84
    true_bound_array = [true_boundaries["southwest"][1], true_boundaries["southwest"][0],
                        true_boundaries["northeast"][1], true_boundaries["northeast"][0]]

    tile_number_boundaries = maptile_utiles.get_max_tilenumber(true_bound_array, globalParam.DEM_RESOLUTION)
    image_dir = os.path.join(globalParam.DEM_PATH, str(globalParam.DEM_RESOLUTION))
    image_dir_list = self.get_x_tile_directories(image_dir, tile_number_boundaries)

    temp_output_dir = os.path.join(globalParam.TEMP_PATH, 'heightmap')
    maptile_utiles.dir_check(temp_output_dir, remove_existing=True)

    args_list = [(self, dir_name, image_dir, tile_number_boundaries, temp_output_dir)
                 for dir_name in image_dir_list]
    with Pool(processes=cpu_count()) as pool:
        pool.map(ConcatImage._run_instance_method, args_list)

    image_list = sorted([os.path.join(temp_output_dir, img)
                         for img in os.listdir(temp_output_dir) if img.endswith('.png')])
    images = [cv2.imread(path) for path in image_list]
    filtered_images = [images[0]]
    for img in images[1:]:
        if ConcatImage.are_dimensions_equal(filtered_images[-1], img):
            filtered_images.append(img)
    stitched_image = cv2.hconcat(filtered_images)
    cv2.imwrite(os.path.join(temp_output_dir, 'height_map.png'), stitched_image)

    tile_boundaries = maptile_utiles.get_true_boundaries(true_bound_array, globalParam.DEM_RESOLUTION)
    height, width = stitched_image.shape[:2]
    crop_px_cord = self.get_dem_px_bounds(true_boundaries, tile_boundaries, height, width)
    cropped_image = self.crop_dem_image(crop_px_cord, stitched_image)
    height, width = cropped_image.shape[:2]
    cv2.imwrite(os.path.join(temp_output_dir, 'cropped_image.png'), cropped_image)

    # Decode Mapbox RGB DEM to actual elevation in meters
    cropped_image_float = cropped_image.astype(np.float32)
    height_map = ((cropped_image_float[:, :, 2] * 256 * 256 +
                   cropped_image_float[:, :, 1] * 256 +
                   cropped_image_float[:, :, 0]) * 0.1) - 10000      # float32, AMSL meters
    self.max_height = np.max(height_map)
    self.min_height = np.min(height_map)

    # Normalize to 8-bit (0-255)
    height_img_normalized = ((height_map - np.min(height_map)) /
                             (np.max(height_map) - np.min(height_map)) * 255).astype(np.uint8)   # line 134

    def get_nearest_map_size(height, width):
        value = max(height, width)
        n = math.log2(value - 1)
        n_ceil = int(math.ceil(n))
        size_upper = (2 ** n_ceil) + 1
        return size_upper

    size = get_nearest_map_size(height, width)
    resized_map = cv2.resize(height_img_normalized, (size, size), interpolation=cv2.INTER_LINEAR)   # uint8

    model = os.path.basename(model_path)

    # ← THIS IS WHAT NEEDS TO CHANGE (lines 151-153):
    self.heightmap = Image.fromarray(resized_map, mode='L')  # 8-bit grayscale, no georef
    self.heightmap.save(os.path.join(globalParam.GAZEBO_MODEL_PATH, model, 'textures',
                                     model + '_height_map.tif'), format="TIFF")
```

### Exact Code Change Required

**File:** [`scripts/utils/heightMapGenerator.py`](scripts/utils/heightMapGenerator.py)

**Step 1 — Add imports** at the top of the file (after existing imports):

```python
import rasterio
from rasterio.transform import from_bounds
from rasterio.crs import CRS as RasterioCRS
```

**Step 2 — Replace lines 151–153** with the following block.
Everything before line 151 (the `resized_map` uint8 variable, `size`, `model`) remains unchanged.

```python
    model = os.path.basename(model_path)
    textures_dir = os.path.join(globalParam.GAZEBO_MODEL_PATH, model, 'textures')

    # Geographic bounds from the true boundaries of this region
    west  = true_boundaries['southwest'][1]   # min longitude
    south = true_boundaries['southwest'][0]   # min latitude
    east  = true_boundaries['northeast'][1]   # max longitude
    north = true_boundaries['northeast'][0]   # max latitude
    geo_transform = from_bounds(west, south, east, north, size, size)
    geo_crs = RasterioCRS.from_epsg(4326)

    # --- Output 1: Gazebo heightmap TIF (16-bit normalized, georeferenced) ---
    height_img_16bit = ((height_map - np.min(height_map)) /
                        (np.max(height_map) - np.min(height_map)) * 65535).astype(np.uint16)
    resized_16bit = cv2.resize(height_img_16bit, (size, size), interpolation=cv2.INTER_LINEAR)

    gazebo_tif_path = os.path.join(textures_dir, model + '_height_map.tif')
    with rasterio.open(
        gazebo_tif_path, 'w',
        driver='GTiff', height=size, width=size,
        count=1, dtype='uint16',
        crs=geo_crs, transform=geo_transform
    ) as dst:
        dst.write(resized_16bit, 1)

    # --- Output 2: Elevation GeoTIFF (float32 actual AMSL values, georeferenced) ---
    resized_elevation = cv2.resize(height_map, (size, size), interpolation=cv2.INTER_LINEAR)
    elevation_tif_path = os.path.join(textures_dir, model + '_elevation.tif')
    with rasterio.open(
        elevation_tif_path, 'w',
        driver='GTiff', height=size, width=size,
        count=1, dtype='float32',
        crs=geo_crs, transform=geo_transform,
        nodata=-9999.0
    ) as dst:
        dst.write(resized_elevation.astype(np.float32), 1)

    # --- In-memory PIL image stays 8-bit for downstream pixel lookups ---
    # buildingsGenerator.py and get_world_dimensions() use getpixel() scaled by size_z/255
    self.heightmap = Image.fromarray(resized_map, mode='L')
```

### What Does NOT Need to Change

- **`templates/sdf_temp.txt`** — the `<size>` tag uses `size_z = max_height - min_height` in
  meters. Gazebo normalizes the image pixel values (whether 8 or 16-bit) to `[0, size_z]`
  internally. Switching to 16-bit is transparent to the SDF.
- **`scripts/utils/buildingsGenerator.py`** — still uses `self.heightmap.getpixel()` which
  reads from the 8-bit in-memory PIL image. No change needed.
- **`scripts/utils/gazeboWorldGenerator.py`** — still uses `self.heightmap.getpixel()` for
  launch height. No change needed.
- **`requirements.txt`** — `rasterio` is already listed.

### Expected Output After Fix

Running `gdalinfo` on the generated files should show:

```
$ gdalinfo textures/taif_map_height_map.tif
Driver: GTiff/GeoTIFF
Size is 513, 513
Coordinate System: GEOGCS["WGS 84", ...]
Origin = (lon_west, lat_north)
Pixel Size = (...)
Image Structure Metadata: INTERLEAVE=BAND
Band 1 Block=... Type=UInt16, ...

$ gdalinfo textures/taif_map_elevation.tif
Driver: GTiff/GeoTIFF
...
Band 1 Block=... Type=Float32, ...
  NoData Value=-9999
  Min=<min_amsl>  Max=<max_amsl>
```

---

## Summary Table

| Agent | File | Lines | Change |
|-------|------|-------|--------|
| Agent 1 | [`scripts/utils/gazeboWorldGenerator.py`](scripts/utils/gazeboWorldGenerator.py) | 273–283 | Remove `launch_height` / pixel-coord block; set `pose_z = 0.0` |
| Agent 2 | [`scripts/utils/heightMapGenerator.py`](scripts/utils/heightMapGenerator.py) | top | Add `rasterio`, `from_bounds`, `RasterioCRS` imports |
| Agent 2 | [`scripts/utils/heightMapGenerator.py`](scripts/utils/heightMapGenerator.py) | 149–153 | Replace PIL 8-bit TIFF save with rasterio 16-bit GeoTIFF + float32 elevation TIF |

The two fixes are **independent** and can be applied in any order or in parallel.
