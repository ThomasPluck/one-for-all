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

- [x] Create click-on wire for natural circuit design UI, create new junction, split wire, allow manipulation of individual wires..

- [x] Remove the ability to move junctions - wires can only be horizontal or vertical, depending on the choice of orientation ie. vertical wires can only move horizontally etc (with the exception that they are connected to a port or are connected to 4 way junction, in which case they can't move), after the move, we should move terminating junctions and shorten/lengthen the wires either side of them (another important exception to note is a three way junction) this maintains manhattan routing.

- [x] Drawing free hand should create a manhattan S with 2 intermediate junctions, unless the wire snaps to the vertical or horizontal orientation.

- [x] Let's implement 3-way wire manipulation correctly, basically, 3 wires on a four-way connect implies 2 are diametrically opposed - those two have to moved under the assumption that they are the same wire dragging the 3 terminal with them, the remaining one can move and drags the 3-way terminal along the diametrically opposed pair lengthing one and shortening the other.

- [x] Finally for a correct four-way implementation we just repeat the diametrically opposed mechanic but twice in the horizontal and vertical directions to maintain manhattan.

- [x] Fixed saveDocument() infinite recursion — the replace_all from last session accidentally replaced the vscode.postMessage call inside saveDocument() with a recursive saveDocument() call. Restored the correct vscode.postMessage({ type: "edit", data: documentData }) on canvasScript.ts:174.

- [x] Collinear chain propagation — added getCollinearChain() at canvasScript.ts:410 that walks through 2-way pass-through junctions (where both connected wires share the same axis). When dragging a wire:

- [x] Chains are collected from each endpoint before any positions are mutated
All chain junctions move by the same perpendicular delta as the dragged wire
3-way/4-way cascade also runs at chain endpoints (not just direct endpoints)
Junction styles are auto-updated for all affected junctions on mouseup

- [x] Refactor canvasScript.ts monofile.

- [ ] Replace default "S" manhattan routing with "L" manhattan routing

- [ ] Reserve junction orientations - do not allow two wires to connect to the same orientation on a junction.

- [ ] Allow for the deletion of horizontal/vertical junctions, fuse the two wires into one, and choose a material (default if connected to port, port material wins, otherwise, blah, we don't care).

- [ ] If wires are collinear and horizontal all collinear junctions should have the same y coordinate (attached vertical wires must rubber band accordingly) and likewise vertical all collinear must have same x coordinate, etc.

- [ ] Any deviation from verticality or horizontality when joining two terminal junctions/ports must result in an "S" manhattan join.