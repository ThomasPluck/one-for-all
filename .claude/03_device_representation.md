- [x] Enable canvas on middle click drag as well as Space+Drag

Now that we have the basic canvas underway - we need to be able to start drawing layout-abstracted objects - this can be done in one of two ways, by either calling procedural factories which take arguments or template factories which invoke GDS templates which are stored in memory.

For the purposes of layout-abstracted schematic we will represent devices simply as rectangles, which is a vast over-simplification of the device geometry but for most devices and basic layout holds mostly true.

In general we hold that 1 unit of canvas space corresponds to 1 micrometer on the die, this begins the need to establish a .OFA standard and storing rectangle positions, orientations, canvas sizes, device names and SPICE parameters to invoke late in simulation:

- [x] Use Python to determine for the arguments of our components the width and length of rectangles for default argument pcells to be drawn on the canvas with a single box (we will just have the device name and type on this box).

- [x] For interconnect, define a procedural color key and have this in a legend fixed in the top right, eg. green circle METAL1 - so that we can keep track of abstracted traces as well as 

- [x] Use Python to determine where the ports of the pcells are physically located and list these as ports with a specific material (represent these as squares with color-key'd material)

Additional features implemented:
- [x] Scale bar in bottom-right corner (auto-adapts to zoom level, shows nm/um)
- [x] Default zoom set to 200x so sub-micron devices are visible at startup
- [x] Adaptive grid that scales with zoom level (always ~20-100px apart on screen)
- [x] Zoom range widened to 1x–10000x for IC-scale navigation
- [x] Device labels auto-scaled to fit inside device rectangle (binary search font sizing)
- [x] Devices labelled with both cell name (bold, upper half) and short auto-generated ID (lower half)
- [x] Right-click on device opens parameter editing overlay (styled with VSCode theme vars)
- [x] Parameter overlay: editable inputs for all params, Apply/Cancel/Delete buttons
- [x] Hit-testing for component selection (reverse-order AABB, topmost device wins)
- [x] Overlay auto-repositions to stay within viewport bounds
