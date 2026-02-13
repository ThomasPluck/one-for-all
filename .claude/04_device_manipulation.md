Now that we're able to place devices correctly and we have corrected the canvas to accomodate some of our other wishes - it is time to bring the canvas to life with an intuitive transformation interface.

- [x] To keep things simple, we'll say that the position (x,y) is the top-left hand corner of each rectangle - from there, the width and length parameters are quite literally the width and length of the rectangle.

- [x] Manipulation of devices can be done by selecting the device, and clicking and dragging it to update x,y, pressing *r* to rotate, *v* to flip vertically (this will require new state in OFA), *h* to flip horizontally and corner pips should allow width and length to be resized as though it were a rectangle in a word processor (but this should alter the underlying width/length parameters under in the .ofa)

- [x] When we have a device selected, we wish for the tool bar to be extended with icons representing, rotate, flip vert, flip horiz to appear, so the user can either trigger the same logic by pressing them or hover to see a message like (rotate (r))

- [x] on second thought, remove scaling manipulation throughout the entire stack

- [x] rely instead on c.xsize and c.ysize exposed by GDSFactory components for the size of objects, we should still be able to select move, rotate and flip components

- [x] there should be a pop-up menu where I can edit the function arguments of the pcells to get new cells and continue to move them around.