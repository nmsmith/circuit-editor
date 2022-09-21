# What is this?

This app is an editor for electrical & hydraulic circuit diagrams.

It is currently in-development. Some basic features are still missing (such as save and load), so it is not yet "production ready".

# User guide

This user guide may not be up-to-date. However, it is/was accurate at the time of writing.

## Opening a project

The app facilitates the drawing of circuit diagrams that contain arbitrary symbols and line segments. Therefore, these resources must be provided to the app before drawing can begin. The app is currently centered around a "project folder", which must contain a subfolder for each kind of resource:

-  The "symbols" folder holds the SVG files for each kind of circuit symbol that the user wishes to place. For example, the user may wish to place electrical resistors or hydraulic valves.
-  The "lines" folder holds the JSON files for each kind of line that the user wishes to draw with. For example, the user may wish to draw electrical wires or hydraulic lines.
-  The "vertex glyphs" folder holds the SVG files for each kind of glyph that can appear at the endpoints of lines, or at the ports of symbols. For example, perhaps a circular "node" should appear at a T-intersection of fluid lines.
-  The "crossing glyphs" folder holds the SVG files for each kind of glyph that can appear at the point where two lines cross without intersecting. For example, perhaps a "hop-over" should appear at the point where two hydraulic lines cross.

To prepare the app for drawing, click on the "choose a project folder" button in the sidebar, and select a folder containing each of the subfolders listed above. The resources within those subfolders will be loaded into the app.

The symbols that have been loaded will appear in the sidebar. To place a symbol on the canvas, drag it out of the sidebar.

## Using the tools

There are currently four tools implemented: draw, erase, warp, and slide.

A tool can be equipped by pressing its button in the GUI, or by using a keyboard shortcut.

The keyboard shortcuts are:

-  D: draw
-  E: erase
-  W: warp
-  S: slide

It is also possible to switch to another tool _temporarily_. To do so, hold down the key of the desired tool and perform the operations you desire. When the key is released, the editor will automatically switch back to the previous tool.

### The draw tool

The draw tool allows you to draw line segments, and attach them to symbols. To draw a line segment, first select the line type in the sidebar that you would like to draw. Then, click and drag upon the canvas in the direction you would like to draw.

By default, only horizontal and vertical lines can be drawn. To draw in a different direction, hold the Shift key. Once you have chosen a new draw direction, the Shift key can be released.

Whilst drawing, the endpoint of the line being drawn will snap towards other line segments, and to the ports of nearby symbols. If the mouse is released whilst this is happening, the line will attach itself to the target. To _detach_ a line from a target, click at the attachment point and drag backward along the line, as if you were "unplugging" it.

To draw multiple line segments in quick succession, you can tap the draw key ("D") to finalize the current line segment and begin the next.

### The erase tool

The erase tool allows you to erase objects, as you would expect. To erase a single object, click on it. To erase many objects at once, click and drag. All objects within the rectangular drag region will be deleted.

### The warp tool

The warp tool allows you to move and rotate an object (or a selection of objects) "freely", meaning the object will not collide with surrounding objects.

If the Shift key is held, the object will be rotated. Otherwise, it will be translated.

By default, rotation will snap towards "nice" orientations for the object, e.g. horizontal and vertical. In addition, if the object being warped has line segments attached to it, then the movement will snap toward "nice" orientations for those line segments. This snapping behaviour can be disabled, as explained later in this guide.

### The slide tool

The slide tool allows you to move an object (or a selection of objects) whilst ensuring it remains a "standard distance" apart from other objects on the canvas. Roughly, the slide tool "pushes" objects, without letting them touch or pass one another.

By default, the moved object(s) will push all objects in their path. However, if the Shift key is held, only objects that are connected via a line segment will be pushed.

A slide operation occurs along a particular axis. For the most part, an object can only be slid along an axes shared by one or more line segment(s) it is attached to. As the object is slid, those line segments will then stretch and/or shrink.

## Configuring snapping behaviour

To aid you in creating clean and precise diagrams, many operations will snap the objects being manipulated toward a standard angle and/or distance apart. This behaviour can be customized or disabled by toggling the respective icons in the sidebar.

## Navigating the canvas

### Using a mouse

To pan the canvas using a mouse, hold down the right mouse button and then move the mouse in the direction you want to pan.

To zoom the canvas using a mouse, place the mouse cursor at the location you wish to zoom toward, and then rotate the scroll wheel.

### Using a trackpad

If you are using a trackpad, you can pan the canvas by performing a panning gesture (e.g. two-finger swipe), and zoom the canvas by performing a zooming gesture (e.g. pinch-to-zoom).

### Using the keyboard

Panning can also be performed by holding the spacebar and then moving the mouse cursor in the direction you want to pan.

## Resource file formats

### Symbols

TODO.

### Line types

TODO.
