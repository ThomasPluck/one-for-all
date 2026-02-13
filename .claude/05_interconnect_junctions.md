- [x] We wish to introduce grid-aligned junctions, these are circles with the same dimensions as ports with a slightly unusual coloring scheme, they effectively fall into one of 4 types:

- [x] horizontal two tones, left half is colored with one material from the interconnect legend and right half with a different tone, which basically represents a wire jumping to a different metallization layer.

- [x] vertical two tones, same idea as horizontal but now vertical

- [x] diagonal two tones, same idea, but now for corners.

- [x] a 4 tone with a cross seperating north-east-south-west each colorable to provide simple intuition of complicated metallization junction.

Please note: junctions are abstracted and the choice of metal is actually made by the wire, so the "select junction" menu is actually totally redundant.

- [x] There must be a wire mode button in the toolbar, this should set the editor into a wire ready state and allow the user to draw a straight (snapped either vertical or horizontal), to turn a corner, you need a junction, to make a via, you need a junction, to join a wire T or 4-way node, you guessed it - junction.

- [x] Wires must be editable, mostly just a wire width parameter is required - we'll say that minimum width is default width and it just gets juicier from there.

- [x] Add junction ports for situations where designers want to go *straight to via*, this only requires horizontal and vertical variants, and we expect the port to be square with two colors, etc.

- [x] Please ensure that the metalization layers are being determined from the GDSFactory PDK directly instead of being hardcoded into the editor :)

- [ ] we need to start thinking about how the editor will think about junction editing since we need Manhattan routing regardless but it really should be that wires are ONLY horizontal and vertical straight lines with the only possible bend being at a junction (so, the wire breaks into multiple junctions and each wire segment needs to be editable) and we also want the intuitive ui of "drawing onto a wire" to create a new junction. This is further complicated when 4 way junctions become editable but we really should try to make this robust.