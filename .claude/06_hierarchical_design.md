It's time to finally turn our attention again back to sidebar which includes our design hierarchy.

1. [x] It needs to be possible to "include" other OFA files - where another .ofa file is represented in another file by redrawing the OFA's geometry as an SVG which can be moved as a single coherent block, right clicking exposes an option to view the underlying .ofa and this is how hierarchical design will be handled from the editor perspective.

2. [x] externalized ports need another specialized object, perhaps a rhombus colored the appropriate metallization layer to allow designs which invoke subcells to only be connected to the correct port.

3. [x] The design hierarchy needs to have all .OFA's listed at the top level and then each dependency (that isn't a GDSF primitive) needs to be listed under the other .OFA's so that the inclusion logic is given a clear GUI to allow people to click in and modify.