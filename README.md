# Gazebo Terrain Generator  [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/saiaravind19/gazebo_terrain_generator) 



A super easy-to-use tool for generate 3D Gazebo terrain using real-world elevation and satellite data.


<p align="center">
  <a href="https://www.youtube.com/embed/TsV34XBntnY?si=zK0TL7pK_RhsNW05">
    <img src="gif/thumnail.png" alt="Project Demo" width="1050"/>
  </a>
</p>

<p align="center">
  <a href="https://youtu.be/-RYXWoHUZNU?si=jEtrnxKcaVLolqhM">
    <img src="gif/building.png" alt="Project Demo" width="1050"/>
  </a>
</p>

## Features

- **Real-World Terrain Generation**: Generate 3D Gazebo worlds using actual elevation data and satellite images of any location on Earth.
- **Rectangular Region Support**: Select any rectangular (non-square) region — the full area is preserved end-to-end.
- **3D Buildings**: Add or remove buildings to the Gazebo world with a toggle button.
- **Configurable Spawn Location**: Change the spawn location using an interactive UI marker within the region of interest.
- **Configurable Output**: Flexible output paths via environment variables for different deployment scenarios.
- **Customizable Resolution**: Adjustable tile zoom level (up to zoom 15, ~2.4 m/px DEM resolution).
- **Complete World Generation**: Generates the entire model with no hassle out of the box.
- **High-Precision Terrain**: 16-bit GeoTIFF heightmaps with lossless DEM tiles for smoother terrain and reduced stairstepping.
- **TERCOM/PX4 Ready**: Exports a UTM-projected `_tercom_dem.tif` and sidecar JSON for use as a TERCOM reference map with PX4 simulation.
- **PX4 World SDF**: Generates a `_px4.sdf` world file with all required PX4 SITL plugins, ODE physics at 250 Hz, and a proper isometric camera view — ready to use with PX4 Gazebo simulation out of the box.

## 🌟 Recent Improvements

- **Rectangular Region Support**: The tool now correctly handles non-square regions. Previously, any rectangular selection was silently clipped to a square. Rectangular flight corridors are fully supported end-to-end.
- **TERCOM-Ready Elevation Export**: A `_tercom_dem.tif` in the local UTM projection (metre-based pixel spacing, undistorted) is generated alongside the Gazebo heightmap — ready for use as a TERCOM reference map with PX4.
- **DEM Resolution Follows UI Zoom**: The terrain DEM is now downloaded and processed at the zoom level selected in the UI (up to zoom 15, ~2.4 m/px), instead of always using the hardcoded zoom 13.
- **Lossless DEM Tiles**: DEM tiles are now fetched as PNG (lossless) instead of WebP (lossy), eliminating quantization noise and tile boundary seam artifacts in the heightmap.
- **PX4 World SDF**: A dedicated `_px4.sdf` world file is generated with all PX4 SITL system plugins (IMU, NavSat, AirPressure, etc.), ODE physics at 250 Hz, and a dynamically computed isometric camera view for a clear initial perspective of the terrain.
- **Zero-Altitude Terrain Base**: The terrain's lowest point is always grounded at world $z=0$, ensuring compatibility with PX4 and other autopilots that require non-negative altitude.
- **16-bit GeoTIFF Support**: Upgraded from 8-bit to 16-bit encoding for heightmaps, improving elevation precision from $\sim$1.9m to $\sim$0.007m.
- **Georeferenced Metadata**: Generated TIFFs include proper CRS and affine transform metadata for direct use in GIS tools like QGIS and GDAL.

## Supported and Tested Stack

- **[Gazebo Harmonic](https://gazebosim.org/docs/harmonic/install_ubuntu/)**
## 🛠️ Setup Instructions

### Create and Activate Virtual Environment (Recommended)

It's recommended to use a virtual environment to avoid dependency conflicts:

```bash
python3 -m venv terrain_generator
source terrain_generator/bin/activate
```


### Install Requirements

Make sure your virtual environment is active, then install all required Python packages using:
  ```bash
  pip install -r requirements.txt
  ```

## ⚙️ Configuration



### File Structure

Generated model follow this structure:
```
<GAZEBO_MODEL_PATH>/
├── model_name/
│   ├── model.sdf                          # Gazebo model definition
│   ├── model.config                       # Model configuration
│   ├── model_name.sdf                     # Gazebo world file
│   ├── model_name_px4.sdf                 # PX4-compatible world file (ready for PX4 SITL)
│   └── textures/
│       ├── model_name_height_map.tif      # 16-bit heightmap (square 2^n+1, EPSG:4326) — used by Gazebo
│       ├── model_name_tercom_dem.tif      # float32 elevation GeoTIFF (UTM CRS, native resolution) — for TERCOM
│       ├── model_name_tercom_dem.json     # Sidecar: vertical datum, CRS, zoom, bounds, elevation range
│       └── model_name_aerial.png          # Satellite imagery texture
<GAZEBO_WORLD_PATH>/
├── model_name.sdf
├── model_name_px4.sdf
├── model_name_1.sdf
└── model_name_2.sdf
```

## 🚀 Run Gazebo World Generator

1. Navigate to **gazebo_terrian_generator** and start the applciation.
    ```bash
    source terrain_generator/bin/activate
    python scripts/server.py
    ```

2. Access the Web Interface: 
   Open your web browser and navigate to `http://localhost:8080`

3. Generate Your World:
   - Search for any location on Earth
   - Draw a rectangular region of interest
   - Place launch pad marker at desired spawn location.
   - Enable/Dissable buildings based on usecase.
   - Configure settings (zoom level, map source)
   - Click "Generate Terrain" to create your world

4. Output Location: 
   Generated worlds are saved to the configured path (see Environment Variables section above)

## 🏁 Spawning Gazebo Worlds

1. **Export the gazebo model path**:
    ```bash
    export GZ_SIM_RESOURCE_PATH=$GZ_SIM_RESOURCE_PATH:<path_to_your_gazebo_worlds>
    ```

2. **Run Gazebo with your world**:
    ```bash
    gz sim your_world_name/your_world_name.sdf
    ```

**Note**: Replace `<path_to_your_gazebo_worlds>` with the actual path where your worlds are saved.


## 📋 Sample Worlds Example

Test the installation with provided sample worlds:

1. **Export the sample gazebo model path**:
    ```bash
    export GZ_SIM_RESOURCE_PATH=$GZ_SIM_RESOURCE_PATH:~/gazebo_terrian_generator/sample_worlds
    ```

2. **Launch sample world**:
    ```bash
    gz sim prayag/prayag.sdf
    ```

## 🔑 MapBox API Key
A free api key is being used in the repo if it gets limited then please feel free to create your own API key from official [MapBox's website](https://www.mapbox.com/) and replace it in the [`configuration file`](scripts/utils/param.py)

## Important Disclaimer

Downloading map tiles is subject to the terms and conditions of the tile provider. Some providers such as Google Maps have restrictions in place to avoid abuse, therefore before downloading any tiles make sure you understand their TOCs. I recommend not using Google, Bing, and ESRI tiles in any commercial application without their consent.

## License

This project is licensed under the **BSD 3-Clause License**.  
See the [LICENSE](LICENSE) file for full details.  

Portions of this project are derived from **MapTilesDownloader** by [Ali Ashraf](https://github.com/AliFlux/MapTilesDownloader),  
which is licensed under the **MIT License**. The MIT-licensed components remain under their original terms.

## Reference
- [Gazebo Heightmap](https://github.com/AS4SR/general_info/wiki/Creating-Heightmaps-for-Gazebo
)
- [Mapbox Dem](https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/)
