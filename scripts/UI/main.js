var mapView;

$(function() {

	var map = null;
	var draw = null;
	var geocoder = null;
	var bar = null;

	var cancellationToken = null;
	var requests = [];

	
	var sources = {

		"Bing Maps": "http://ecn.t0.tiles.virtualearth.net/tiles/r{quad}.jpeg?g=129&mkt=en&stl=H",
		"Bing Maps Satellite": "http://ecn.t0.tiles.virtualearth.net/tiles/a{quad}.jpeg?g=129&mkt=en&stl=H",
		"Bing Maps Hybrid": "http://ecn.t0.tiles.virtualearth.net/tiles/h{quad}.jpeg?g=129&mkt=en&stl=H",

		"div-1B": "",

		"Google Maps": "https://mt0.google.com/vt?lyrs=m&x={x}&s=&y={y}&z={z}",
		"Google Maps Satellite": "https://mt0.google.com/vt?lyrs=s&x={x}&s=&y={y}&z={z}",
		"Google Maps Hybrid": "https://mt0.google.com/vt?lyrs=h&x={x}&s=&y={y}&z={z}",
		"Google Maps Terrain": "https://mt0.google.com/vt?lyrs=p&x={x}&s=&y={y}&z={z}",

		"div-2": "",

		"Open Street Maps": "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
		"Open Cycle Maps": "http://a.tile.opencyclemap.org/cycle/{z}/{x}/{y}.png",
		"Open PT Transport": "http://openptmap.org/tiles/{z}/{x}/{y}.png",

		"div-3": "",

		"ESRI World Imagery": "http://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		"Wikimedia Maps": "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png",
		"NASA GIBS": "https://map1.vis.earthdata.nasa.gov/wmts-webmerc/MODIS_Terra_CorrectedReflectance_TrueColor/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",

		"div-4": "",

		"Carto Light": "http://cartodb-basemaps-c.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png",
		"Stamen Toner B&W": "http://a.tile.stamen.com/toner/{z}/{x}/{y}.png",

	};

	function initializeMap() {

		mapboxgl.accessToken = 'pk.eyJ1IjoicmcyOCIsImEiOiJjbGRsaXk3cXQwMjZuM3VvaGhya3N4dXN6In0.Ust9rPKtGmAMuTDCKaYIrA';

		map = new mapboxgl.Map({
			container: 'map-view',
			style: 'mapbox://styles/aliashraf/ck6lw9nr80lvo1ipj8zovttdx',
			center: [-73.983652, 40.755024], 
			zoom: 12
		});

		geocoder = new MapboxGeocoder({ accessToken: mapboxgl.accessToken });
		var control = map.addControl(geocoder);
	}

	function initializeMaterialize() {
		$('select').formSelect();
		$('.dropdown-trigger').dropdown({
			constrainWidth: false,
		});
	}

	function initializeSources() {

		var dropdown = $("#sources");

		for(var key in sources) {
			var url = sources[key];

			if(url == "") {
				dropdown.append("<hr/>");
				continue;
			}

			var item = $("<li><a></a></li>");
			item.attr("data-url", url);
			item.find("a").text(key);

			item.click(function() {
				var url = $(this).attr("data-url");
				$("#source-box").val(url);
			})

			dropdown.append(item);
		}
	}

	function initializeSearch() {
		$("#search-form").submit(function(e) {
			var location = $("#location-box").val();
			geocoder.query(location);

			e.preventDefault();
		})
	}

	function initializeMoreOptions() {

		$("#more-options-toggle").click(function() {
			$("#more-options").toggle();
		})
		var outputFileBox = $("#output-file-box");

		$("#output-type").change(function() {
			outputFileBox.val("{z}/{x}/{y}.png");
		});

	}

	function initializeRectangleTool() {
		
		var modes = MapboxDraw.modes;
		modes.draw_rectangle = DrawRectangle.default;

		draw = new MapboxDraw({
			modes: modes
		});
		map.addControl(draw);

		map.on('draw.create', function (e) {
			M.Toast.dismissAll();
			if (e.features[0].geometry.type === 'Polygon') {
				var coordinates = e.features[0].geometry.coordinates[0];
				var originalBounds = coordinates.reduce(function(bounds, coord) {
					return [
						Math.min(bounds[0], coord[0]), // west
						Math.min(bounds[1], coord[1]), // south
						Math.max(bounds[2], coord[0]), // east
						Math.max(bounds[3], coord[1])  // north
					];
				}, [Infinity, Infinity, -Infinity, -Infinity]);

				// Calculate center
				var centerLon = (originalBounds[0] + originalBounds[2]) / 2;
				var centerLat = (originalBounds[1] + originalBounds[3]) / 2;
				var centerPt = turf.point([centerLon, centerLat]);

				// Calculate physical width and height
				var ptWest = turf.point([originalBounds[0], centerLat]);
				var ptEast = turf.point([originalBounds[2], centerLat]);
				var widthMeters = turf.distance(ptWest, ptEast, {units: 'meters'});

				var ptSouth = turf.point([centerLon, originalBounds[1]]);
				var ptNorth = turf.point([centerLon, originalBounds[3]]);
				var heightMeters = turf.distance(ptSouth, ptNorth, {units: 'meters'});

				// Enforce perfect square
				var targetSize = Math.max(widthMeters, heightMeters);

				// Calculate new square bounds
				var newNorth = turf.destination(centerPt, targetSize / 2, 0, {units: 'meters'}).geometry.coordinates[1];
				var newEast = turf.destination(centerPt, targetSize / 2, 90, {units: 'meters'}).geometry.coordinates[0];
				var newSouth = turf.destination(centerPt, targetSize / 2, 180, {units: 'meters'}).geometry.coordinates[1];
				var newWest = turf.destination(centerPt, targetSize / 2, -90, {units: 'meters'}).geometry.coordinates[0];

				var squareBounds = [newWest, newSouth, newEast, newNorth];

				// Create perfectly square coordinates for the polygon
				var squareCoordinates = [[
					[squareBounds[0], squareBounds[1]], // SW
					[squareBounds[2], squareBounds[1]], // SE
					[squareBounds[2], squareBounds[3]], // NE
					[squareBounds[0], squareBounds[3]], // NW
					[squareBounds[0], squareBounds[1]]  // SW
				]];
				
				// Use a timeout to ensure the feature is fully created before updating
				setTimeout(function() {
					var featureId = e.features[0].id;
					var updatedFeature = {
						id: featureId,
						type: 'Feature',
						geometry: {
							type: 'Polygon',
							coordinates: squareCoordinates
						},
						properties: e.features[0].properties
					};
					
					// Update the feature
					draw.delete(featureId);
					draw.add(updatedFeature);
				}, 50);
				
				window.launchBounds = squareBounds;
				var center = [
					(squareBounds[0] + squareBounds[2]) / 2,
					(squareBounds[1] + squareBounds[3]) / 2
				];
				window.launchLocation = center;

				// Store the selected region for later restoration
				window.selectedRegion = {
					type: 'Feature',
					geometry: {
						type: 'Polygon',
						coordinates: squareCoordinates
					},
					properties: e.features[0].properties
				};

				// Remove existing markers if they exist and create new one
				removeLaunchPadMarker();
				createLaunchPadMarker();

				var zoomLevel = getMaxZoom();
				var sw_tile_x = long2tile(squareBounds[0], zoomLevel);
				var sw_tile_y = lat2tile(squareBounds[1], zoomLevel);
				var ne_tile_x = long2tile(squareBounds[2], zoomLevel);
				var ne_tile_y = lat2tile(squareBounds[3], zoomLevel);
				
				var tileWidth = Math.abs(ne_tile_x - sw_tile_x) + 1;
				var tileHeight = Math.abs(sw_tile_y - ne_tile_y) + 1;
				var totalTiles = tileWidth * tileHeight;

				// Clear any pending messages first
				M.Toast.dismissAll();

				// Show success message with details
				M.toast({
					html: `Area selected: ${tileWidth} × ${tileHeight} tiles (${totalTiles} total)`,
					displayLength: 4000
				});
			}
		});

		$("#rectangle-draw-button").click(function() {
			startDrawing();
		})

	}

	function startDrawing() {
		removeGrid();
		draw.deleteAll();
		draw.changeMode('draw_rectangle');

		// Remove markers if they exist
		removeLaunchPadMarker();

		M.Toast.dismissAll();
		M.toast({html: 'Click two points on the map to draw a region', displayLength: 3000})
	}

	function initializeGridPreview() {
		$("#grid-preview-button").click(previewGrid);

		map.on('click', showTilePopup);
	}

	function showTilePopup(e) {

		if(!e.originalEvent.ctrlKey) {
			return;
		}

		var maxZoom = getMaxZoom();

		var x = lat2tile(e.lngLat.lat, maxZoom);
		var y = long2tile(e.lngLat.lng, maxZoom);

		var content = "X, Y, Z<br/><b>" + x + ", " + y + ", " + maxZoom + "</b><hr/>";
		content += "Lat, Lng<br/><b>" + e.lngLat.lat + ", " + e.lngLat.lng + "</b>";

        new mapboxgl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(content)
            .addTo(map);

        console.log(e.lngLat)

	}

	function long2tile(lon,zoom) {
		return (Math.floor((lon+180)/360*Math.pow(2,zoom)));
	}

	function lat2tile(lat,zoom)  {
		return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom)));
	}

	function tile2long(x,z) {
		return (x/Math.pow(2,z)*360-180);
	}

	function tile2lat(y,z) {
		var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
		return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))));
	}

	function getTileRect(x, y, zoom) {

		var c1 = new mapboxgl.LngLat(tile2long(x, zoom), tile2lat(y, zoom));
		var c2 = new mapboxgl.LngLat(tile2long(x + 1, zoom), tile2lat(y + 1, zoom));

		return new mapboxgl.LngLatBounds(c1, c2);
	}


	function getMaxZoom() {
		return parseInt($("#zoom-from-box").val());
	}

	function area(){
		var bounds = getBounds(); // Assuming you have a function to get bounds
		var polygon = getPolygonByBounds(bounds); // Assuming getPolygonByBounds returns a Turf.js polygon

		// Calculate the area of the polygon using Turf.js
		var area = turf.area(polygon);
		return area
	}

	function getArrayByBounds(bounds) {

		var tileArray = [
			[ bounds.getSouthWest().lng, bounds.getNorthEast().lat ],
			[ bounds.getNorthEast().lng, bounds.getNorthEast().lat ],
			[ bounds.getNorthEast().lng, bounds.getSouthWest().lat ],
			[ bounds.getSouthWest().lng, bounds.getSouthWest().lat ],
			[ bounds.getSouthWest().lng, bounds.getNorthEast().lat ],
		];

		return tileArray;
	}

	function getPolygonByBounds(bounds) {

		var tilePolygonData = getArrayByBounds(bounds);

		var polygon = turf.polygon([tilePolygonData]);

		return polygon;
	}

	function isTileInSelection(tileRect) {

		var polygon = getPolygonByBounds(tileRect);

		var areaPolygon = draw.getAll().features[0];

		if(turf.booleanDisjoint(polygon, areaPolygon) == false) {
			return true;
		}

		return false;
	}

	function getBounds() {

		var coordinates = draw.getAll().features[0].geometry.coordinates[0];

		var bounds = coordinates.reduce(function(bounds, coord) {
			return bounds.extend(coord);
		}, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));

		return bounds;
	}

	function getGrid(zoomLevel) {

		var bounds = getBounds();

		var rects = [];

		var outputScale = $("#output-scale").val();
		//var thisZoom = zoomLevel - (outputScale-1)
		var thisZoom = zoomLevel

		var TY    = lat2tile(bounds.getNorthEast().lat, thisZoom);
		var LX   = long2tile(bounds.getSouthWest().lng, thisZoom);
		var BY = lat2tile(bounds.getSouthWest().lat, thisZoom);
		var RX  = long2tile(bounds.getNorthEast().lng, thisZoom);
		for(var y = TY; y <= BY; y++) {
			for(var x = LX; x <= RX; x++) {

				var rect = getTileRect(x, y, thisZoom);

				if(isTileInSelection(rect)) {
					rects.push({
						x: x,
						y: y,
						z: thisZoom,
						rect: rect,
					});
				}

			}
		}

		return rects
	}

	function getAllGridTiles() {
		var allTiles = [];
		var grid = getGrid(getMaxZoom());
		// TODO shuffle grid via a heuristic (hamlet curve? :/)
		allTiles = allTiles.concat(grid);

		return allTiles;
	}

	function removeGrid() {
		removeLayer("grid-preview");
	}

	function previewGrid() {

		var maxZoom = getMaxZoom();
		var grid = getGrid(maxZoom);

		var pointsCollection = []

		for(var i in grid) {
			var feature = grid[i];
			var array = getArrayByBounds(feature.rect);
			pointsCollection.push(array);
		}

		removeGrid();

		map.addLayer({
			'id': "grid-preview",
			'type': 'line',
			'source': {
				'type': 'geojson',
				'data': turf.polygon(pointsCollection),
			},
			'layout': {},
			'paint': {
				"line-color": "#fa8231",
				"line-width": 3,
			}
		});

		var totalTiles = getAllGridTiles().length;
		M.toast({html: 'Total ' + totalTiles.toLocaleString() + ' tiles in the region.', displayLength: 5000})

	}

	function previewRect(rectInfo) {

		var array = getArrayByBounds(rectInfo.rect);

		var id = "temp-" + rectInfo.x + '-' + rectInfo.y + '-' + rectInfo.z;

		map.addLayer({
			'id': id,
			'type': 'line',
			'source': {
				'type': 'geojson',
				'data': turf.polygon([array]),
			},
			'layout': {},
			'paint': {
				"line-color": "#ff9f1a",
				"line-width": 3,
			}
		});

		return id;
	}

	function removeLayer(id) {
		if(map.getSource(id) != null) {
			map.removeLayer(id);
			map.removeSource(id);
		}
	}

	function generateQuadKey(x, y, z) {
	    var quadKey = [];
	    for (var i = z; i > 0; i--) {
	        var digit = '0';
	        var mask = 1 << (i - 1);
	        if ((x & mask) != 0) {
	            digit++;
	        }
	        if ((y & mask) != 0) {
	            digit++;
	            digit++;
	        }
	        quadKey.push(digit);
	    }
	    return quadKey.join('');
	}

	function initializeDownloader() {

		bar = new ProgressBar.Circle($('#progress-radial').get(0), {
			strokeWidth: 12,
			easing: 'easeOut',
			duration: 200,
			trailColor: '#eee',
			trailWidth: 1,
			from: {color: '#0fb9b1', a:0},
			to: {color: '#20bf6b', a:1},
			svgStyle: null,
			step: function(state, circle) {
				circle.path.setAttribute('stroke', state.color);
			}
		});

		$("#download-button").click(startDownloading)
		$("#stop-button").click(stopDownloading)

		var timestamp = Date.now().toString();
		//$("#output-directory-box").val(timestamp)
	}

	function showTinyTile(base64) {
		var currentImages = $(".tile-strip img");

		for(var i = 4; i < currentImages.length; i++) {
			$(currentImages[i]).remove();
		}

		var image = $("<img/>").attr('src', "data:image/png;base64, " + base64)

		var strip = $(".tile-strip");
		strip.prepend(image)
	}
	// Function to poll the task status
	async function pollTaskStatus() {
	    try {
	        // Call the /task-status endpoint
	        var response = await $.ajax({
	            url: "/task-status",
	            async: true,
	            timeout: 30 * 1000,
	            type: "get",
	            dataType: 'json',
	        });
			
			if (response.code === 200) {
				var status = response.message.status; // Extract the status field
				console.log("Task status:", status); // Debugging log
	
				// Check the task status
				if (status === "completed") {
					logItemRaw("Gazebo world generated successfully.");
					$("#stop-button").html("FINISH");
					
					// Add the launch pad marker when generation is complete
					createLaunchPadMarker();
				} else if (status === "in_progress") {
					logItemRaw("World Generation Inprogress..");
					setTimeout(() => pollTaskStatus(), 5000); // Poll every 5 seconds
				} else if (status === "failed") {
					logItemRaw("Gazebo world generation FAILED. Check server logs.");
					$("#stop-button").html("RETRY");
				} else {
					logItemRaw("Unexpected status: " + status);
				}
			} else {
				logItemRaw("Unexpected response code: " + response.code);
			}
	    } catch (error) {
	        logItemRaw("Error while checking task status: " + error.statusText);
	        setTimeout(() => pollTaskStatus(taskId), 5000); // Retry after 5 seconds
	    }
	}
	async function startDownloading() {

		if(draw.getAll().features.length == 0) {
			M.toast({html: 'You need to select a region first.', displayLength: 3000})
			return;
		}

		cancellationToken = false; 
		requests = [];

		$("#main-sidebar").hide();
		$("#download-sidebar").show();
		$(".tile-strip").html("");
		$("#stop-button").html("STOP");
		removeGrid();
		clearLogs();
		M.Toast.dismissAll();

		// Remove the launch pad marker when download starts
		removeLaunchPadMarker();

		var timestamp = Date.now().toString();

		var allTiles = getAllGridTiles();
		updateProgress(0, allTiles.length);

		var numThreads = parseInt($("#parallel-threads-box").val()) || 4;
		var outputDirectory = $("#output-directory-box").val();
		var outputFile = "{z}/{x}/{y}.png"; 
		var outputType = "png"; 
		var outputScale = "1"; 
		var source = $("#source-box").val()

		var bounds = getBounds();
		var area_rect = area();
		var boundsArray = [[bounds.getSouthWest().lng,bounds.getSouthWest().lat],[bounds.getNorthEast().lng,bounds.getNorthEast().lat]];
		var centerArray = [bounds.getCenter().lng,bounds.getCenter().lat];
		var launchLocation = window.launchLocation ? window.launchLocation : centerArray;
		var includeBuildlings = $("#buildings-toggle").is(":checked");
		var px4_compatible = $("#px4-compatible-toggle").is(":checked");
		var export_dsm = $("#export-dsm-toggle").is(":checked");
		var data = new FormData();
		data.append('maxZoom', getMaxZoom());
		data.append('outputDirectory', outputDirectory);
		data.append('outputFile', outputFile);
		data.append('outputType', outputType);
		data.append('outputScale', outputScale);
		data.append('source', source);
		data.append('timestamp', timestamp);
		data.append('bounds', boundsArray.join(","));
		data.append('center', centerArray.join(","));
		data.append('launchLocation', launchLocation.join(","));
		data.append('area', area_rect);
		data.append('includeBuildlings', includeBuildlings);
		data.append('px4_compatible', px4_compatible);
		data.append('export_dsm', export_dsm);

		var request = await $.ajax({
			url: "/start-download",
			async: true,
			timeout: 30 * 1000,
			type: "post",
			contentType: false,
			processData: false,
			data: data,
			dataType: 'json',
		})

		let i = 0;
		var iterator = async.eachLimit(allTiles, numThreads, function(item, done) {

			if(cancellationToken) {
				return;
			}

			var boxLayer = previewRect(item);

			var url = "/download-tile";

			var data = new FormData();
			data.append('x', item.x)
			data.append('y', item.y)
			data.append('z', item.z)
			data.append('quad', generateQuadKey(item.x, item.y, item.z))
			data.append('outputDirectory', outputDirectory)
			data.append('outputFile', outputFile)
			data.append('outputType', outputType)
			data.append('outputScale', outputScale)
			data.append('timestamp', timestamp)
			data.append('source', source)
			data.append('bounds', boundsArray.join(","))
			data.append('center', centerArray.join(","))
			data.append('launchLocation', launchLocation.join(","))
			data.append('area', area_rect)
			data.append('includeBuildlings', includeBuildlings)

			var request = $.ajax({
				"url": url,
				async: true,
				timeout: 30 * 1000,
				type: "post",
			    contentType: false,
			    processData: false,
				data: data,
				dataType: 'json',
			}).done(function(data) {

				if(cancellationToken) {
					return;
				}

				if(data.code == 200) {
					showTinyTile(data.image)
					logItem(item.x, item.y, item.z, data.message);
				} else {
					logItem(item.x, item.y, item.z, data.code + " Error downloading tile");
				}

			}).fail(function(data, textStatus, errorThrown) {

				if(cancellationToken) {
					return;
				}

				logItem(item.x, item.y, item.z, "Error while relaying tile");
				//allTiles.push(item);

			}).always(function(data) {
				i++;

				removeLayer(boxLayer);
				updateProgress(i, allTiles.length);

				done();
				
				if(cancellationToken) {
					return;
				}
			});

			requests.push(request);

		}, async function(err) {

			var request = await $.ajax({
				url: "/end-download",
				async: true,
				timeout: 30 * 1000,
				type: "post",
				contentType: false,
				processData: false,
				data: data,
				dataType: 'json',
			})

			updateProgress(allTiles.length, allTiles.length);
			logItemRaw("Starting World Generation");
			pollTaskStatus(); // Start polling with the task ID

		},


	);


	}

	function updateProgress(value, total) {
		var progress = value / total;

		bar.animate(progress);
		bar.setText(Math.round(progress * 100) + '<span>%</span>');

		$("#progress-subtitle").html(value.toLocaleString() + " <span>out of</span> " + total.toLocaleString())
	}

	function logItem(x, y, z, text) {
		logItemRaw(x + ',' + y + ',' + z + ' : ' + text)
	}

	function logItemRaw(text) {

		var logger = $('#log-view');
		logger.val(logger.val() + '\n' + text);

		logger.scrollTop(logger[0].scrollHeight);
	}

	function clearLogs() {
		var logger = $('#log-view');
		logger.val('');
	}

	function stopDownloading() {
		// Check if the process is finished (button shows "FINISH")
		if ($("#stop-button").html() === "FINISH") {
			// Process is complete, restore the main view
			$("#main-sidebar").show();
			$("#download-sidebar").hide();
			
			// Ensure the region selection is visible (if it was removed)
			if (window.selectedRegion && draw.getAll().features.length === 0) {
				draw.add(window.selectedRegion);
			}
			
			// Ensure the launch pad marker is visible
			
			removeGrid();
			clearLogs();
			createLaunchPadMarker();

			// Show completion message
			M.toast({
				html: 'Region and launch pad are now visible. Ready for next operation.', 
				displayLength: 3000
			});
			
			return;
		}
		
		// Otherwise, it's a regular stop operation during download
		cancellationToken = true;

		for(var i =0 ; i < requests.length; i++) {
			var request = requests[i];
			try {
				request.abort();
			} catch(e) {

			}
		}


		$("#main-sidebar").show();
		$("#download-sidebar").hide();

		removeGrid();
		clearLogs();

	}

	function createLaunchPadMarker() {
		// Only create if launch location exists and marker doesn't already exist
		if (window.launchLocation && !window.centerMarker) {
			// Add a helipad icon at the center
			var helipadIcon = document.createElement('div');
			helipadIcon.className = 'helipad-icon';
			helipadIcon.style.width = '50px';
			helipadIcon.style.height = '50px';
			helipadIcon.style.backgroundImage = 'url(launchpad.svg)';
			helipadIcon.style.backgroundSize = 'contain';
			helipadIcon.style.backgroundRepeat = 'no-repeat';
			helipadIcon.style.backgroundPosition = 'center';

			window.centerMarker = new mapboxgl.Marker({
				element: helipadIcon,
				draggable: true
			})
			.setLngLat(window.launchLocation)
			.addTo(map);

			// Constrain the helipad icon within the bounds
			window.centerMarker.on('dragend', function() {
				var lngLat = window.centerMarker.getLngLat();
				var bounds = window.launchBounds;
				var newLng = Math.min(Math.max(lngLat.lng, bounds[0]), bounds[2]);
				var newLat = Math.min(Math.max(lngLat.lat, bounds[1]), bounds[3]);
				window.centerMarker.setLngLat([newLng, newLat]);
				window.launchLocation = [newLng, newLat];
			});
		}
	}

	function removeLaunchPadMarker() {
		if (window.centerMarker) {
			window.centerMarker.remove();
			window.centerMarker = null;
		}
	}

	initializeMaterialize();
	initializeSources();
	initializeMap();
	initializeSearch();
	initializeRectangleTool();
	initializeGridPreview();
	initializeMoreOptions();
	initializeDownloader();
});