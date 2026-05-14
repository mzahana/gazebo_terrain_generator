import json
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.enums import MergeAlg
from rasterio.crs import CRS as RasterioCRS
from rasterio.warp import transform_geom


class DSMGenerator:
    """
    Produces a Digital Surface Model (DSM) by burning OSM building heights
    onto the TERCOM bare-earth DEM.

    DSM(pixel) = terrain_AMSL(pixel) + building_height_above_ground(pixel)

    The output CRS, transform, and resolution exactly match the input TERCOM
    DEM — no PX4 vertical shift is applied.  This file is intended for offline
    satellite-tile orthorectification only; it is never loaded by Gazebo.
    """

    DEFAULT_BUILDING_HEIGHT_M = 10.0  # fallback when OSM carries no height

    def generate(
        self,
        tercom_tif_path: str,
        buildings_geojson_path: str,
        output_dsm_path: str,
    ) -> dict:
        """
        Args:
            tercom_tif_path:       Path to *_tercom_dem.tif (float32 AMSL, UTM).
            buildings_geojson_path: Path to buildings.geojson (WGS84 footprints).
            output_dsm_path:       Where to write the DSM GeoTIFF.

        Returns:
            Metadata dict (also written as a .json sidecar next to the output).
        """
        with rasterio.open(tercom_tif_path) as src:
            dem = src.read(1).astype(np.float32)
            profile = src.profile.copy()
            dst_crs = src.crs
            dst_transform = src.transform
            nodata = float(src.nodata) if src.nodata is not None else -9999.0

        shapes_heights = self._load_building_shapes(
            buildings_geojson_path, dst_crs
        )

        building_heights = np.zeros(dem.shape, dtype=np.float32)
        if shapes_heights:
            building_heights = rasterize(
                shapes_heights,
                out_shape=dem.shape,
                transform=dst_transform,
                fill=0.0,
                dtype=np.float32,
                merge_alg=MergeAlg.replace,
            )

        dsm = dem.copy()
        valid = dem != nodata
        dsm[valid] += building_heights[valid]

        out_profile = profile.copy()
        out_profile.update(dtype="float32", nodata=nodata)
        with rasterio.open(output_dsm_path, "w", **out_profile) as dst:
            dst.write(dsm, 1)

        valid_dsm = dsm[valid]
        meta = {
            "type": "DSM",
            "description": "Digital Surface Model = TERCOM DEM + OSM building heights",
            "vertical_datum": "EGM96 (orthometric / MSL)",
            "horizontal_crs": str(dst_crs),
            "building_source": "OpenStreetMap via Mapbox Vector Tiles",
            "building_count": len(shapes_heights),
            "default_building_height_m": self.DEFAULT_BUILDING_HEIGHT_M,
            "elevation_range_m": {
                "min": float(np.min(valid_dsm)) if valid_dsm.size else None,
                "max": float(np.max(valid_dsm)) if valid_dsm.size else None,
            },
            "px4_shift_applied": False,
            "note": (
                "Use this file for offline satellite-tile orthorectification. "
                "Do not load into Gazebo — use _height_map.tif for that."
            ),
        }

        sidecar_path = output_dsm_path.replace(".tif", ".json")
        with open(sidecar_path, "w") as f:
            json.dump(meta, f, indent=2)

        return meta

    def _load_building_shapes(self, geojson_path: str, dst_crs) -> list:
        """
        Read buildings.geojson, reproject each footprint to dst_crs, and
        return a list of (geojson_geometry, height_m) pairs ready for
        rasterio.features.rasterize.

        Height priority: 'height' → 'render_height' → DEFAULT_BUILDING_HEIGHT_M.
        Buildings with height <= 0 are skipped.
        """
        try:
            with open(geojson_path) as f:
                geojson = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[DSM] Cannot read {geojson_path}: {exc}")
            return []

        src_crs = RasterioCRS.from_epsg(4326)
        shapes = []

        for feature in geojson.get("features", []):
            geom = feature.get("geometry")
            if geom is None:
                continue

            props = feature.get("properties", {})
            raw = props.get("height") or props.get("render_height")
            try:
                height_m = float(raw) if raw is not None else self.DEFAULT_BUILDING_HEIGHT_M
            except (ValueError, TypeError):
                height_m = self.DEFAULT_BUILDING_HEIGHT_M

            if height_m <= 0:
                continue

            try:
                reprojected = transform_geom(src_crs, dst_crs, geom)
                shapes.append((reprojected, height_m))
            except Exception as exc:
                print(f"[DSM] Skipping building (reprojection failed): {exc}")

        return shapes
