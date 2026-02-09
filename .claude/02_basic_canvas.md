With the basic sidebar for editor mode created, let's now create a basic canvas object using native TS with a background grid for manipulating .ofa files (which are just .JSONs which cache important values to export to GDSF/Simulators), that can Space+Click to pan and scroll to zoom.

- [x] Implement canvas that be panned and zoomed
- [x] Implement rules to open .ofa files with OFA

At the top of the canvas we expect to have a tool bar, with a drop down menu of components that are made available in the GDSFactory PDK that we have just downloaded to let users start placing devices on the canvas (these are typically exposed via components):

- [x] To get available PDK devices use, from [pdk name] import cells, from gdsfactory.get_factories import get_cells, get_cells(cells)

The second thing that we want to allow users to create are what I will call "junctions", junctions are effectively represent *intended* metal intersections and vias. We won't elaborate on just how junctions will work just, yet - but somewhere in the canvas state, the connectivity similarly can be found with:

- [x] To get available list of PDK connection objects use, from [pdk name] import connectivity

Note: both of these are also expose via the top-level [pdk name].PDK() class object.