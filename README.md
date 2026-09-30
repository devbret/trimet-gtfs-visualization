# TriMet GTFS Data Visualization

![Screenshot from the map/app showing thousands of individual dots, each representing a form of mass transit.](https://hosting.photobucket.com/bbcfb0d4-be20-44a0-94dc-65bff8947cf2/75a6a46c-d871-4058-b220-fc590ebd107b.png)

Processes TriMet GTFS data into a JSON file, which a frontend decodes to animate vehicles on a map with interactive controls, trails and statistics.

## Application Overview

This program has two main parts working together; those being a (1) Python script for processing data and (2) JavaScript frontend for visualizing any findings.

The Python script ingests GTFS data and builds a compact, visualization-ready JSON file. It filters trips by route, converts times into seconds and aggregates per-stop hourly activity within a configurable time window.

The JavaScript then loads this `all_trips.json` file and uses Leaflet to animate vehicles on an interactive map. It decodes the packed trip segments, caches trips by hour and lets the user scrub or play through simulation time with controls for speed and trail length.

At each animation frame it figures out which segment of each trip is active, calculates the current vehicle position and updates circle markers on the map. It also computes live stats and displays them in a sidebar, giving an at-a-glance view of network activity for any moment in the chosen time window.

## Basic Setup Instructions

Below are the required software programs and instructions for installing and using this application on a Linux machine.

### Programs Needed

- [Git](https://git-scm.com/downloads)

- [Python](https://www.python.org/downloads/)

### Steps

1. Install the above programs

2. Open a terminal

3. Clone this repository: `git clone git@github.com:devbret/trimet-gtfs-visualization.git`

4. Navigate to the repo: `cd trimet-gtfs-visualization`

5. Create a virtual environment: `python3 -m venv venv`

6. Activate your virtual environment: `source venv/bin/activate`

7. Download the [source data](https://developer.trimet.org/GTFS.shtml) as a CSV file

8. Place the `routes.txt`, `stop_times.txt`, `stops.txt`, `shapes.txt` and `trips.txt` files into the root directory of this repo

9. Process the raw data: `python3 app.py`

10. Launch the application's frontend: `python3 -m http.server`

11. Access the visualization in a browser: `http://localhost:8000`

12. When finished, close the server: `CTRL + c`

13. Exit the virtual environment: `deactivate`

## Other Considerations

Below you will find information not covered in the installation and use sections above. Including the abilities this repo is intended to demonstrate. As well as an overview of the license this code is made available with. And a way to contact the maintainer with questions, suggestions and collaboration opportunities.

### Abilities Demonstrated

This project repo is intended to demonstrate an ability to do the following:

- Source interesting, relevant and publicly available data from an official government source

- Use Python to transform the raw data into a useable structure and format

- Visualize the Python output in an interactive and engaging fashion using modern web development tools

### License Information

This repository is distributed under the MIT License. You are free to use, copy, modify, merge, publish, distribute, sublicense and sell copies of this software, including as part of proprietary or commercial work. The single condition is the copyright and permission notices contained in the LICENSE file must be included with any copy or substantial portion of the software that you redistribute. The software is provided "as is", without warranty of any kind, and the copyright holder is not liable for any claim or damages arising from its use.

If you have any questions or would like to collaborate, please reach out either on GitHub or via [my website](https://bretbernhoft.com/).
