# TriMet GTFS Data Visualization

![Screenshot from the map/app showing thousands of individual dots, each representing a form of mass transit.](https://hosting.photobucket.com/bbcfb0d4-be20-44a0-94dc-65bff8947cf2/d5e82a70-f5fb-4314-89f7-3d169ad45976.png)

Processes TriMet GTFS data into a JSON file, which a frontend decodes to animate vehicles on a map with interactive controls, trails and statistics.

## Overview

This program has two main parts working together; those being a (1) Python script for processing data and (2) JavaScript frontend for visualizing any findings.

The Python script ingests GTFS data and builds a compact, visualization-ready JSON file. It filters trips by route, converts times into seconds and aggregates per-stop hourly activity within a configurable time window.

The JavaScript then loads this `all_trips.json` file and uses Leaflet to animate vehicles on an interactive map. It decodes the packed trip segments, caches trips by hour and lets the user scrub or play through simulation time with controls for speed and trail length.

At each animation frame it figures out which segment of each trip is active, calculates the current vehicle position and updates circle markers on the map. It also computes live stats and displays them in a sidebar, giving an at-a-glance view of network activity for any moment in the chosen time window.
