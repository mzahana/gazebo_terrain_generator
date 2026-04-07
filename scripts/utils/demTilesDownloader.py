from urllib import request
import numpy as np
import cv2
import os
from utils.maptileUtils import maptile_utiles
from multiprocessing import Pool, cpu_count
from utils.param import globalParam

def fetch_image_from_url(url : str):
    """
    Fetch an image from a URL and decode it into a NumPy array.
    Args:
        url (str): The URL of the image to fetch.
    Returns:
        np.ndarray: The decoded image as a NumPy array, or None if the download fails
    """
    try:
        resp = request.urlopen(url)
        img = np.asarray(bytearray(resp.read()), dtype="uint8")
        img = cv2.imdecode(img, cv2.IMREAD_ANYCOLOR)
        if img is None:
            raise ValueError("Failed to decode image from URL.")
        return img
    except Exception as e:
        print(f"Failed to download or decode image from {url}: {e}")
        return None

def check_dem_file(image_file : str) -> bool:
    """
    Check if the DEM tile image file exists.
    Args:
        image_file : str
    Returns:
        bool: True if the file exists, False otherwise.
    """
    if os.path.isfile(image_file) == True:
        return True
    return False


def download_tile_image(args : tuple)-> None:
    """
    Download a single DEM tile image and save it to the specified directory.
    Args:
        args (tuple): A tuple containing zoom level, x tile number, y tile number,
    Retuns:
        None
    """
    zoom, x, y, output_dir = args
    tile_url = (
        f"https://api.mapbox.com/v4/mapbox.terrain-rgb/"
        f"{zoom}/{x}/{y}.pngraw?access_token={globalParam.MAPBOX_API_KEY}"
    )
    img = fetch_image_from_url(tile_url)
    if img is not None:
        file_path = os.path.join(output_dir, f"{y}.png")
        cv2.imwrite(file_path, img)
    else:
        print(f"[WARN] Skipped tile ({x}, {y}) due to download error.")

def _download_zoom(bound_array, output_directory, zoom) -> int:
    """
    Download DEM tiles for a single zoom level. Returns the number of tiles successfully downloaded.
    """
    nw_lat, nw_lon = map(float, bound_array["northwest"])
    se_lat, se_lon = map(float, bound_array["southeast"])

    nw_tilex, nw_tiley = maptile_utiles.lat_lon_to_tile(nw_lat, nw_lon, zoom)
    se_tilex, se_tiley = maptile_utiles.lat_lon_to_tile(se_lat, se_lon, zoom)

    tilex_start, tilex_end = sorted((nw_tilex, se_tilex))
    tiley_start, tiley_end = sorted((nw_tiley, se_tiley))

    zoom_dir = os.path.join(output_directory, str(zoom))
    maptile_utiles.dir_check(zoom_dir)

    tasks = []
    for x in range(tilex_start, tilex_end + 1):
        x_dir = os.path.join(zoom_dir, str(x))
        maptile_utiles.dir_check(x_dir)
        for y in range(tiley_start, tiley_end + 1):
            dem_file = os.path.join(x_dir, f"{y}.png")
            if not check_dem_file(dem_file):
                tasks.append((zoom, x, y, x_dir))

    if not tasks:
        # All tiles already cached — count existing files as successes
        return sum(
            len([f for f in os.listdir(os.path.join(zoom_dir, str(x))) if f.endswith('.png')])
            for x in range(tilex_start, tilex_end + 1)
            if os.path.isdir(os.path.join(zoom_dir, str(x)))
        )

    with Pool(processes=cpu_count()) as pool:
        pool.map(download_tile_image, tasks)

    # Count files actually written
    return sum(
        len([f for f in os.listdir(os.path.join(zoom_dir, str(x))) if f.endswith('.png')])
        for x in range(tilex_start, tilex_end + 1)
        if os.path.isdir(os.path.join(zoom_dir, str(x)))
    )


def download_dem_data(bound_array, output_directory, zoom_range: tuple = (globalParam.DEM_RESOLUTION,globalParam.DEM_RESOLUTION)) -> int:
    """
    Download DEM data for a specified bounding box and zoom range.
    Falls back to zoom 13 if the requested zoom yields no tiles (e.g. tileset has no coverage).
    Args:
        bound_array: Bounding box dict with 'northwest' and 'southeast' keys.
        output_directory: Directory where downloaded DEM tiles will be saved.
        zoom_range: Tuple of (min_zoom, max_zoom) to download.
    Returns:
        int: The zoom level that was actually used.
    """
    FALLBACK_ZOOM = globalParam.DEM_RESOLUTION  # 13
    try:
        maptile_utiles.dir_check(output_directory)

        for zoom in range(zoom_range[0], zoom_range[1] + 1):
            count = _download_zoom(bound_array, output_directory, zoom)
            if count > 0:
                return zoom
            print(f"[WARN] No DEM tiles downloaded at zoom {zoom}. Falling back to zoom {FALLBACK_ZOOM}.")

        # Requested zoom(s) yielded nothing — fall back to zoom 13
        if zoom_range[0] != FALLBACK_ZOOM:
            count = _download_zoom(bound_array, output_directory, FALLBACK_ZOOM)
            if count > 0:
                return FALLBACK_ZOOM
            print(f"[ERROR] No DEM tiles downloaded at fallback zoom {FALLBACK_ZOOM} either.")

        return zoom_range[0]  # Return requested zoom even if empty; caller will handle error

    except Exception as e:
        print(f"Download failed: {e}")
        return zoom_range[0]
