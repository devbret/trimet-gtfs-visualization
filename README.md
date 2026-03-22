# TriMet GTFS Data Visualization

![Screenshot from the map/app showing thousands of individual dots, each representing a form of mass transit.](https://hosting.photobucket.com/bbcfb0d4-be20-44a0-94dc-65bff8947cf2/d5e82a70-f5fb-4314-89f7-3d169ad45976.png)

Processes TriMet GTFS data into a JSON file, which a frontend decodes to animate vehicles on a map with interactive controls, trails and statistics.

## Overview

This program has two main parts working together; those being a (1) Python script for processing data and (2) JavaScript frontend for visualizing any findings.

The Python script ingests GTFS data and builds a compact, visualization-ready JSON file. It filters trips by route, converts times into seconds and aggregates per-stop hourly activity within a configurable time window.

The JavaScript then loads this `all_trips.json` file and uses Leaflet to animate vehicles on an interactive map. It decodes the packed trip segments, caches trips by hour and lets the user scrub or play through simulation time with controls for speed and trail length.

At each animation frame it figures out which segment of each trip is active, calculates the current vehicle position and updates circle markers on the map. It also computes live stats and displays them in a sidebar, giving an at-a-glance view of network activity for any moment in the chosen time window.

## Set Up Instructions

Below are the required software programs and instructions for installing and using this application.

### Programs Needed

- [Git](https://git-scm.com/downloads)

- [Python](https://www.python.org/downloads/)

### Steps

1. Install the above programs

2. Open a terminal

3. Clone this repository using `git` by running the following command: `git clone git@github.com:devbret/portland-parks-trees.git`

4. Navigate to the repo's directory by running: `cd portland-parks-trees`

5. Create a virtual environment with this command: `python3 -m venv venv`

6. Activate your virtual environment using: `source venv/bin/activate`

7. Download the [source data](https://developer.trimet.org/GTFS.shtml) as a CSV file

8. Place the `routes.txt`, `stop_times.txt`, `stops.txt` and `trips.txt` files into the root directory of this repo

9. Process the raw data using the Python script by running the following command: `python3 app.py`

10. Launch the application's frontend by starting a Python server with the following command: `python3 -m http.server`

11. Access the heatmap visualization in a browser by visiting: `http://localhost:8000`

12. Explore and enjoy

## Other Considerations

This project repo is intended to demonstrate an ability to do the following:

- Source interesting, relevant and publicly available data from an official government source

- Use Python to transform the raw data into a useable structure and format

- Visualize the Python output in an interactive and engaging fashion using modern web development tools

If you have any questions or would like to collaborate, please reach out either on GitHub or via [my website](https://bretbernhoft.com/).
