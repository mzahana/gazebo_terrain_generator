import cv2
import os
import json
import numpy as np
import math
from PIL import Image
from multiprocessing import Pool, cpu_count
import rasterio
from rasterio.transform import from_bounds
from rasterio.crs import CRS as RasterioCRS
from rasterio.warp import reproject, Resampling, calculate_default_transform

from utils.maptileUtils import maptile_utiles
from utils.utils import ConcatImage
from utils.param import globalParam


class HeightmapGenerator(ConcatImage):
    def __init__(self,**kwargs):
        super().__init__(**kwargs)
        self.heightmap = None
        self.max_height = self.min_height = 0
        self.size_x=self.size_y=self.size_z=0


    def get_dem_px_bounds(self,true_boundaries,tile_boundaries,height,width):
        crop_px_cord = {}
        # check if tile exist
        lat_max = tile_boundaries["northeast"][0]
        lat_min = tile_boundaries["southwest"][0]
        lon_max = tile_boundaries["northeast"][1]
        lon_min = tile_boundaries["southwest"][1]

        for coord_name in true_boundaries.keys():
            lat, lon = true_boundaries[coord_name]
            # from boundaries and the desiderd lat long get the pixel coordinates
            px = int((lon - lon_min) / (lon_max - lon_min) * width)
            py = int((lat_max - lat) / (lat_max - lat_min) * height)
            crop_px_cord[coord_name] = (px, py)
        return crop_px_cord
        

    @staticmethod
    def get_amsl(lat: float, lon: float, zoom: int = None):
        """
        Get the height above mean sea level (AMSL) for a given latitude and longitude.
        Args:
            lat (float): Latitude in degrees.
            lon (float): Longitude in degrees.
            zoom (int): DEM tile zoom level. Defaults to globalParam.DEM_RESOLUTION.
        Returns:
            float: Height above mean sea level in meters.
        """
        if zoom is None:
            zoom = globalParam.DEM_RESOLUTION
        tile_x,tile_y = maptile_utiles.lat_lon_to_tile(lat, lon, zoom)
        boundaries = maptile_utiles.get_tile_bounds(tile_x, tile_y, zoom)
        # check if tile exist
        lat_max = boundaries["northeast"][0]
        lat_min = boundaries["southwest"][0]
        lon_max = boundaries["northeast"][1]
        lon_min = boundaries["southwest"][1]
        dem_tile_path = os.path.join(globalParam.DEM_PATH, str(zoom), str(tile_x), str(tile_y)+'.png')
        if os.path.isfile(dem_tile_path) == True:
            # read the image from the tile its a gbr image format
            dem_img = cv2.imread(dem_tile_path)
            #get the size of the image
            height,width = dem_img.shape[:2]
            # from boundaries and the desiderd lat long get the pixel coordinates
            px = int((lon - lon_min) / (lon_max - lon_min) * width)
            py = int((lat_max - lat) / (lat_max - lat_min) * height)
            # from pixel read the image and get the height
            b,g,r = dem_img[py,px]
            b,g,r = float(b), float(g), float(r)
            # convert the pixel value to height
            # reference : https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/
            height = ((r * 256 * 256 + g * 256 + b) * 0.1) - 10000
            return height

        else :
            # raise an error and kill the program
            print("Tile not found",tile_x,tile_y,zoom,lat,lon)
            return None

    

    def generate_rgb_heightmap(self,model_path,boundaries,zoomlevel) -> list:

        #get the true boundaries as there is a padding non uniform padding added 
        bound_array = boundaries.split(',')
        true_boundaries = maptile_utiles.get_true_boundaries(bound_array,zoomlevel)
        true_bound_array = [true_boundaries["southwest"][1], true_boundaries["southwest"][0],
                            true_boundaries["northeast"][1], true_boundaries["northeast"][0]]
        
        tile_number_boundaries = maptile_utiles.get_max_tilenumber(true_bound_array, zoomlevel)
        image_dir = os.path.join(globalParam.DEM_PATH, str(zoomlevel))
        image_dir_list = self.get_x_tile_directories(image_dir,tile_number_boundaries)

        temp_output_dir = os.path.join(globalParam.TEMP_PATH, 'heightmap')

        maptile_utiles.dir_check(temp_output_dir,remove_existing=True)

        args_list = [
            (self, dir_name, image_dir, tile_number_boundaries, temp_output_dir)
            for dir_name in image_dir_list
        ]
        #  Multiprocessing call
        with Pool(processes=cpu_count()) as pool:
            pool.map(ConcatImage._run_instance_method, args_list)

        image_list = sorted([
            os.path.join(temp_output_dir, img)
            for img in os.listdir(temp_output_dir) if img.endswith('.png')
        ])            
        images = [cv2.imread(path) for path in image_list]
        filtered_images = [images[0]]

        for img in images[1:]:
            if ConcatImage.are_dimensions_equal(filtered_images[-1], img):
                filtered_images.append(img)
        stitched_image = cv2.hconcat(filtered_images)
        
        cv2.imwrite(os.path.join(temp_output_dir, 'height_map.png'),stitched_image)

        tile_boundaries = maptile_utiles.get_true_boundaries(true_bound_array, zoomlevel)

        height,width = stitched_image.shape[:2]
        crop_px_cord = self.get_dem_px_bounds(true_boundaries,tile_boundaries,height,width)
        # Crop the image based on the true boundaries needed
        cropped_image = self.crop_dem_image(crop_px_cord,stitched_image) 
        height,width = cropped_image.shape[:2]
        cv2.imwrite(os.path.join(temp_output_dir, 'cropped_image.png'),cropped_image)

        # Convert to float to avoid overflow during calculation
        cropped_image_float = cropped_image.astype(np.float32)
        # Calculate height map - changed to use float operations
        height_map = ((cropped_image_float[:, :, 2] * 256 * 256 + cropped_image_float[:, :, 1] * 256 + cropped_image_float[:, :, 0]) * 0.1) - 10000
        self.max_height = np.max(height_map)
        self.min_height = np.min(height_map)

        height_img_normalized = ((height_map - np.min(height_map)) / (np.max(height_map) - np.min(height_map)) * 255).astype(np.uint8)

        def get_nearest_map_size(height,width):
            value = max(height, width)
            n = math.log2(value - 1)
            # Get floor and ceil values of n
            n_ceil = int(math.ceil(n))

            size_upper = (2 ** n_ceil) + 1

            return size_upper
        
        size = get_nearest_map_size(height,width)
        resized_map  = cv2.resize(height_img_normalized, (size,size), interpolation=cv2.INTER_LINEAR)

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

        # --- Output 2: TERCOM elevation GeoTIFF (float32 AMSL, UTM projected, native resolution) ---
        # Reproject height_map to the local UTM zone BEFORE any Gazebo square resize,
        # so pixel spacing is uniform in meters and coordinates are undistorted.
        nat_h, nat_w = height_map.shape
        src_crs = RasterioCRS.from_epsg(4326)
        src_transform = from_bounds(west, south, east, north, nat_w, nat_h)

        center_lon = (west + east) / 2.0
        center_lat = (south + north) / 2.0
        utm_zone = int((center_lon + 180.0) / 6.0) + 1
        epsg_utm = 32600 + utm_zone if center_lat >= 0 else 32700 + utm_zone
        utm_crs = RasterioCRS.from_epsg(epsg_utm)

        utm_transform, utm_w, utm_h = calculate_default_transform(
            src_crs, utm_crs, nat_w, nat_h, left=west, bottom=south, right=east, top=north
        )
        utm_elevation = np.full((utm_h, utm_w), -9999.0, dtype=np.float32)
        reproject(
            source=height_map.astype(np.float32),
            destination=utm_elevation,
            src_transform=src_transform,
            src_crs=src_crs,
            dst_transform=utm_transform,
            dst_crs=utm_crs,
            resampling=Resampling.bilinear,
            src_nodata=-9999.0,
            dst_nodata=-9999.0,
        )

        tercom_tif_path = os.path.join(textures_dir, model + '_tercom_dem.tif')
        with rasterio.open(
            tercom_tif_path, 'w',
            driver='GTiff', height=utm_h, width=utm_w,
            count=1, dtype='float32',
            crs=utm_crs, transform=utm_transform,
            nodata=-9999.0,
        ) as dst:
            dst.write(utm_elevation, 1)

        valid_elevations = utm_elevation[utm_elevation != -9999.0]
        pixel_size_m = utm_transform.a  # cell width in metres (square pixels)
        tercom_meta = {
            "vertical_datum": "EGM96 (orthometric / MSL)",
            "horizontal_crs": f"EPSG:{epsg_utm}",
            "source": "Mapbox Terrain DEM v1",
            "source_zoom": zoomlevel,
            "geographic_bounds": {
                "west": west, "south": south, "east": east, "north": north
            },
            "elevation_range_m": {
                "min": float(np.min(valid_elevations)) if valid_elevations.size else None,
                "max": float(np.max(valid_elevations)) if valid_elevations.size else None,
            },
            "pixel_size_m": pixel_size_m,
            "note": (
                "PX4 barometer references MSL (consistent with EGM96). "
                "GPS altitude uses WGS84 ellipsoidal height — apply geoid correction "
                "if using GPS altitude directly."
            ),
        }
        tercom_meta_path = os.path.join(textures_dir, model + '_tercom_dem.json')
        with open(tercom_meta_path, 'w') as f:
            json.dump(tercom_meta, f, indent=2)

        # --- In-memory PIL image stays 8-bit for downstream pixel lookups ---
        # buildingsGenerator.py and get_world_dimensions() use getpixel() scaled by size_z/255
        self.heightmap = Image.fromarray(resized_map, mode='L')

    def crop_dem_image(self,px_bound,height_map):
        cropped_image = height_map[px_bound["northwest"][1]:px_bound["southeast"][1], 
                                       px_bound["southwest"][0]:px_bound["northeast"][0]]
        return cropped_image
