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

### Resetting the camera

Double-tapping the spacebar will move the camera back to the center of the diagram. You will find this useful if you accidentally pan away from the diagram and cannot find it again.

## Resource file formats

This section describes the file format of each type of resource (e.g. symbols, line types) that can be used to draw circuit diagrams. To use these resources within a project, they must be placed in their appropriate places in the project folder, as described earlier.

### Symbols

The circuit symbols you place in your project folder must be valid SVG files. When a symbol is loaded, the editor looks in the file for the following information about it:

-  The view box.
   -  This determines the region that can be interacted with using the mouse.
-  The collision box.
   -  This determines how the symbol should snap to other objects.
-  The location of ports.
   -  Ports are the parts of a symbol that circuit lines are able to connect to.

The view box of a symbol is automatically configured by the CAD app from which the SVG was exported (e.g. Adobe Illustrator). Typically, the view box corresponds to a "canvas" or an "artboard" within the CAD app.

A collision box can be specified by assigning the ID "collisionBox" to any SVG element. Currently, only rectangular collision boxes are supported. If you specify a non-rectangular shape, it will be approximated by a rectangle. If no collision box is specified, the view box will be used instead.

A port can be specified by assigning an ID containing the letters "snap" to any SVG element (e.g. "snap1" or "theSnapPoint"). The center of such an element will be treated as the port's location. If you do not wish for the port to have a visual appearance, you can make it invisible or transparent.

To assign IDs to SVG elements, you do not need to manually edit your SVG files. Instead, in most CAD apps, when you assign a name to a graphical object (e.g. an ellipse), the corresponding element in the exported SVG will inherit that name as its ID. Therefore, specifying a collision box should be as easy as drawing a rectangle in your CAD app and naming it "collisionBox", and specifying a port should be as easy as drawing an ellipse and using the word "snap" in its name.

### Line types

The circuit editor allows you to define and draw lines of (almost) arbitrary appearance. Each line type is defined by a JSON file with a particular format. The root object of the JSON file can contain the following fields:

-  color (mandatory): The color of the line, given as a CSS color, e.g. "blue", "#FFFFFF", or "rgb(180, 0, 90)".
-  thickness (mandatory): The thickness of the line in pixels, given as an integer, e.g. 3.
-  dasharray (optional): The dash pattern of the line, given in [the standard format](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-dasharray) for SVG dash patterns.
-  meeting (optional): A JSON object describing what glyphs (if any) should appear when this line type meets other line types. The format of this object is described in more detail below.

As an example, you may define a JSON file "drain.json" for a drain line, containing the following:

```
{
   "color": "#0000FF",
   "thickness": 3,
   "dasharray": "6 6",
   "meeting": {
      "drain": {
         "crossing": "hopover.svg",
         "T": "node.svg",
         "X": "node.svg"
      },
      "manifold": {
         "crossing": "port.svg",
         "T": "plug.svg",
         "X": "port.svg"
      }
   }
}
```

This file describes a blue line (#0000FF) with a thickness of 3, and a basic dash pattern. The "meeting" field contains two entries. The first describes the glyphs that should be drawn when a drain line meets another drain line, and the second describes the glyphs that should be drawn when a drain line meets a manifold line.

The "meeting" object consists of a set of key-value pairs. The keys ("drain" and "manifold") must match the file names of other line-type JSON files in the project, excluding their file extension. Thus for our example, the files "drain.json" and "manifold.json" must be included in the same directory as our example file (which happens to be "drain.json" itself).

Each key is paired with a JSON object, which may contain the following fields:

-  crossing (optional): The glyph that should be drawn when the main line type crosses over the key's line type without intersecting it. (This field is typically used to specify a "hop-over" glyph.)
-  L (optional): The glyph that should be drawn when the main line type intersects the key's line type at an L-junction, i.e. a corner.
-  T (optional): The glyph that should be drawn when the main line type intersects the key's line type at a T-junction.
   -  Here, the main line type is the stem of the T, and the key's line type is the crossbar of the T. If you wish to specify the opposite kind of T-junction, you must do so in the key type's JSON file.
   -  T-junctions involving three line types are not supported.
-  X (optional): The glyph that should be drawn when the main type intersects the key's line type at an X-junction.
   -  An X-junction is any junction with four lines coming into it. Neither the angle of the lines, nor the multiplicity of each line type is relevant.
   -  X-junctions involving three or more line types are not supported.

The particular glyph to be used at one of these meetings is described by a file name, as illustrated in the example. As described earlier in this guide, crossing glyphs (those associated with the "crossing" key) must be placed in the "crossing glyphs" folder, and vertex glyphs (those associated with the "L/T/X" keys) must be placed in the "vertex glyphs" folder. The format of these files is described in the next section.

Most meeting types can be specified in _either_ file of the line types involved. For example, the X-intersection between a "drain" line and a "manifold" line can be specified in either "drain.json" or "manifold.json". The glyph that will be drawn is determined as follows:

-  If a glyph is only specified in one file, then that glyph will be used.
-  If a glyph is specified in both files, and it is the same glyph, then that glyph will be used.
-  If a glyph is specified in both files, but they are different glyphs, then no glyph will be used.
-  If a glyph is specified in neither file, then no glyph will be used.

### Glyphs

A "glyph" is a small symbol that can be placed (automatically or manually) at the point where two lines meet. As described earlier, a glyph is specified by an SVG file placed in a particular subfolder within the project folder.

There are two kinds of glyph:

-  Crossing glyphs, which appear at the points where two lines cross without intersecting.
-  Vertex glyphs, which appear at L-junctions, T-junctions, and X-junctions.

The file format for glyphs is the same as for symbols (described earlier), with the following caveats:

-  A crossing glyph splices itself into the middle of a line — typically, the line that is "hopping over". Thus it must be a symbol with two ports: one for each side of the cut.
-  A vertex glyph appears at the point where multiple lines intersect. Thus it must be a symbol with one port, corresponding to the part of the glyph that should be placed at the intersection point.
