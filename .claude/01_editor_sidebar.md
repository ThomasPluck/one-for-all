We have now successfully completed OFA's initialization screen - this installs uv without permission and correctly configures the .venv and ihp-gdsfactory library so that our hackers can begin to hack - I've added a button on the initialization screen with the ID "startEditing" - this will load users into the primary editing tool bar which from now on should always be loaded into if environment in the directory is ready (we mostly put this button in for the "ignition start" feeling).

We now want to begin creating the main layout-abstracted schematic editing platform, we will need the following items in the extension sidebar for editor mode:

- [x] A top submenu called "design hierarchy" which keeps track of our various schematics and will later also explain hierarchical design.
- [x] A middle submenu called "verification" that contains user defined test-cases per schematic that engineers will use to verify their designs
- [x] A bottom submenu called "validation" that will be filled with tick box list to enable/disable DRCs, collision checks, PEX back-annotations etc.