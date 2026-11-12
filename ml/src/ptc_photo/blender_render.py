"""Renders photo-like chessboards with one CC0 chess set. Runs inside Blender, not project Python.

blender --background --factory-startup --disable-autoexec --python blender_render.py -- <jobs.json>

The jobs file names the set, the output folder and one entry per image: a seed and a placement.
Each image gets a label file in the same format as chesscog's rendered dataset, so the existing
converter can read both: the four playing-grid corners and a box for every piece, in pixels.

Only the piece shapes come from the set. Materials, board, table, light and camera are made up for
each image, so that shape is the only thing the detector can rely on to tell piece types apart.
"""

import colorsys
import json
import math
import random
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

FILES = "abcdefgh"
TYPES = "PNBRQK"
SQUARE = 1.0  # Board units: one square is one unit, so the playing grid spans -4 to 4.


# ---------------------------------------------------------------- materials


def _material(name: str) -> tuple[bpy.types.Material, bpy.types.Node, bpy.types.NodeTree]:
    material = bpy.data.materials.new(name)
    if hasattr(material, "use_nodes"):
        try:
            material.use_nodes = True
        except AttributeError:
            pass
    tree = material.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    return material, bsdf, tree


def _set_input(node, names, value) -> None:
    for name in names:
        if name in node.inputs:
            node.inputs[name].default_value = value
            return


def _grain(tree, bsdf, light, dark, rng: random.Random, scale: float) -> None:
    """Wood-like streaks between two colours, using a wave texture and a colour ramp."""
    wave = tree.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = rng.choice(["X", "Y", "Z"])
    wave.inputs["Scale"].default_value = scale * rng.uniform(0.6, 1.6)
    wave.inputs["Distortion"].default_value = rng.uniform(2, 12)
    wave.inputs["Detail"].default_value = rng.uniform(1, 4)
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*light, 1)
    ramp.color_ramp.elements[1].color = (*dark, 1)
    tree.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])


def _hsv(h: float, s: float, v: float) -> tuple[float, float, float]:
    # Blender colours are linear, so square the values roughly to keep picked tones believable.
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, min(max(s, 0), 1), min(max(v, 0), 1))
    return (r**2.2, g**2.2, b**2.2)


def piece_materials(
    rng: random.Random, glossy: bool = False
) -> tuple[bpy.types.Material, bpy.types.Material]:
    """A matching pair for the two sides, from families seen in real sets."""
    if glossy:
        family = rng.choices(["wood", "plastic"], weights=[70, 30])[0]
    else:
        family = rng.choices(["plastic", "wood", "metal", "colour"], weights=[50, 35, 7, 8])[0]
    pair = []
    for white in (True, False):
        material, bsdf, tree = _material("white" if white else "black")
        if family == "plastic":
            if white:
                colour = _hsv(rng.uniform(0.07, 0.15), rng.uniform(0, 0.35), rng.uniform(0.7, 0.97))
            elif rng.random() < 0.75:
                colour = _hsv(rng.uniform(0, 1), rng.uniform(0, 0.2), rng.uniform(0.02, 0.14))
            else:
                colour = _hsv(
                    rng.uniform(0.0, 0.08), rng.uniform(0.4, 0.8), rng.uniform(0.06, 0.25)
                )
            _set_input(bsdf, ["Base Color"], (*colour, 1))
            if glossy:
                _set_input(bsdf, ["Roughness"], rng.uniform(0.06, 0.2))
                _set_input(bsdf, ["Coat Weight"], rng.uniform(0.4, 0.85))
            else:
                _set_input(bsdf, ["Roughness"], rng.uniform(0.12, 0.6))
                _set_input(bsdf, ["Coat Weight"], rng.uniform(0, 0.4))
        elif family == "wood":
            if white:
                base = (rng.uniform(0.07, 0.12), rng.uniform(0.25, 0.6), rng.uniform(0.6, 0.9))
            else:
                base = (rng.uniform(0.0, 0.08), rng.uniform(0.3, 0.7), rng.uniform(0.05, 0.3))
            light = _hsv(*base)
            dark = _hsv(base[0], base[1] + 0.1, base[2] * rng.uniform(0.6, 0.85))
            _grain(tree, bsdf, light, dark, rng, 8)
            if glossy:
                _set_input(bsdf, ["Roughness"], rng.uniform(0.08, 0.22))
                _set_input(bsdf, ["Coat Weight"], rng.uniform(0.5, 0.95))
            else:
                _set_input(bsdf, ["Roughness"], rng.uniform(0.25, 0.7))
                _set_input(bsdf, ["Coat Weight"], rng.uniform(0, 0.6))
        elif family == "metal":
            hue = rng.uniform(0.1, 0.14) if white else rng.choice([rng.uniform(0.05, 0.1), 0.6])
            colour = _hsv(hue, rng.uniform(0.0, 0.6) if white else 0.3, 0.9 if white else 0.35)
            _set_input(bsdf, ["Base Color"], (*colour, 1))
            _set_input(bsdf, ["Metallic"], 1.0)
            _set_input(bsdf, ["Roughness"], rng.uniform(0.15, 0.45))
        else:
            hue = rng.random()
            colour = _hsv(
                hue + (0 if white else rng.uniform(0.3, 0.7)),
                rng.uniform(0.3, 0.8),
                rng.uniform(0.6, 0.9) if white else rng.uniform(0.1, 0.4),
            )
            _set_input(bsdf, ["Base Color"], (*colour, 1))
            _set_input(bsdf, ["Roughness"], rng.uniform(0.2, 0.6))
        pair.append(material)
    return pair[0], pair[1]


BOARD_THEMES = [
    # (light, dark) in HSV, with how much each may vary.
    ((0.1, 0.25, 0.85), (0.07, 0.55, 0.45)),  # light and mid wood
    ((0.12, 0.2, 0.9), (0.3, 0.45, 0.45)),  # cream and green, as on tournament vinyl boards
    ((0.0, 0.0, 0.92), (0.0, 0.0, 0.12)),  # white and black
    ((0.1, 0.15, 0.88), (0.06, 0.6, 0.25)),  # maple and walnut
    ((0.58, 0.1, 0.85), (0.6, 0.45, 0.45)),  # light and blue
    ((0.0, 0.0, 0.8), (0.0, 0.0, 0.45)),  # light and mid grey
]


def board_materials(rng: random.Random, style: str = "") -> tuple:
    if style == "wood3d":
        light_hsv = (rng.uniform(0.08, 0.12), rng.uniform(0.2, 0.5), rng.uniform(0.7, 0.9))
        dark_hsv = (rng.uniform(0.05, 0.1), rng.uniform(0.4, 0.7), rng.uniform(0.2, 0.45))
        wood = True
    else:
        light_hsv, dark_hsv = rng.choice(BOARD_THEMES)
        wood = rng.random() < 0.45
    out = []
    for h, s, v in (light_hsv, dark_hsv):
        material, bsdf, tree = _material("square")
        h += rng.uniform(-0.03, 0.03)
        s = s * rng.uniform(0.7, 1.3)
        v = v * rng.uniform(0.85, 1.1)
        colour = _hsv(h, s, v)
        if wood:
            _grain(tree, bsdf, colour, _hsv(h, s + 0.1, v * 0.8), rng, 3)
        else:
            _set_input(bsdf, ["Base Color"], (*colour, 1))
        _set_input(bsdf, ["Roughness"], rng.uniform(0.2, 0.75))
        out.append(material)
    frame, bsdf, tree = _material("frame")
    if style == "wood3d":
        # Always a wood-grain frame for wooden 3D boards.
        h = rng.uniform(0.04, 0.1)
        _grain(tree, bsdf, _hsv(h, 0.6, rng.uniform(0.2, 0.6)), _hsv(h, 0.7, 0.15), rng, 3)
    elif rng.random() < 0.5:
        _set_input(
            bsdf,
            ["Base Color"],
            (*_hsv(rng.uniform(0, 1), rng.uniform(0, 0.3), rng.uniform(0.6, 0.95)), 1),
        )
    else:
        h = rng.uniform(0.04, 0.1)
        _grain(tree, bsdf, _hsv(h, 0.6, rng.uniform(0.2, 0.6)), _hsv(h, 0.7, 0.15), rng, 3)
    _set_input(bsdf, ["Roughness"], rng.uniform(0.3, 0.8))
    return out[0], out[1], frame


def table_material(rng: random.Random) -> bpy.types.Material:
    material, bsdf, tree = _material("table")
    h = rng.uniform(0.0, 1.0) if rng.random() < 0.3 else rng.uniform(0.05, 0.11)
    s, v = rng.uniform(0.1, 0.7), rng.uniform(0.1, 0.8)
    if rng.random() < 0.6:
        _grain(tree, bsdf, _hsv(h, s, v), _hsv(h, s + 0.1, v * 0.7), rng, 0.4)
    else:
        noise = tree.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = rng.uniform(5, 60)
        ramp = tree.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*_hsv(h, s, v), 1)
        ramp.color_ramp.elements[1].color = (*_hsv(h, s, v * 0.85), 1)
        tree.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    _set_input(bsdf, ["Roughness"], rng.uniform(0.3, 0.9))
    return material


# ---------------------------------------------------------------- set loading


def _vertices(mesh: bpy.types.Mesh) -> np.ndarray:
    points = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", points)
    return points.reshape(-1, 3)


def _base_and_top_width(points: np.ndarray) -> tuple[float, float]:
    z = points[:, 2]
    low, high = z.min(), z.max()
    span = high - low
    bottom = points[z < low + 0.12 * span]
    top = points[z > high - 0.12 * span]
    return float(np.ptp(bottom[:, 0]) + np.ptp(bottom[:, 1])), float(
        np.ptp(top[:, 0]) + np.ptp(top[:, 1])
    )


def _load_piece(path: Path, spec: str) -> bpy.types.Mesh:
    """One piece's mesh, in world position. The spec names an object in the set's file, or
    "other.blend#Object" for an object in another file beside it, or a .stl or .obj file."""
    scene = bpy.context.scene
    if spec.lower().endswith((".stl", ".obj")):
        before = set(bpy.data.objects)
        target = str(path.parent / spec)
        if spec.lower().endswith(".stl"):
            bpy.ops.wm.stl_import(filepath=target)
        else:
            bpy.ops.wm.obj_import(filepath=target)
        objects = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        if len(objects) != 1:
            raise SystemExit(f"{target}: expected one mesh, found {len(objects)}")
        obj = objects[0]
    else:
        file, _, name = spec.rpartition("#")
        source_path = path.parent / file if file else path
        with bpy.data.libraries.load(str(source_path), link=False) as (source, loaded):
            if name not in source.objects:
                raise SystemExit(f"{source_path}: missing object {name}")
            loaded.objects = [name]
        obj = loaded.objects[0]
        scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    mesh = obj.data.copy()
    mesh.transform(obj.matrix_world)
    bpy.data.objects.remove(obj)
    return mesh


def load_set(path: Path, names: dict[str, str]) -> dict[str, bpy.types.Mesh]:
    """Copies the six piece meshes, standing upright with the base centred at the origin."""
    meshes = {code: _load_piece(path, spec) for code, spec in names.items()}

    # The upright axis is the king's longest one. Applied to every piece of the set.
    extents = np.ptp(_vertices(meshes["K"]), axis=0)
    up = int(np.argmax(extents))
    turn = {
        0: Matrix.Rotation(math.radians(90), 4, "Y"),
        1: Matrix.Rotation(math.radians(-90), 4, "X"),
        2: Matrix(),
    }[up]
    for code, mesh in meshes.items():
        mesh.transform(turn)
        points = _vertices(mesh)
        base, top = _base_and_top_width(points)
        # Bases are wider than tops, so a piece the other way up is turned over.
        if code != "N" and base < top:
            mesh.transform(Matrix.Rotation(math.pi, 4, "X"))
        elif code == "N":
            king_base, king_top = _base_and_top_width(_vertices(meshes["K"]))
            if king_base < king_top:
                mesh.transform(Matrix.Rotation(math.pi, 4, "X"))
        points = _vertices(mesh)
        z = points[:, 2]
        bottom = points[z < z.min() + 0.08 * np.ptp(z)]
        centre = (bottom[:, :2].min(axis=0) + bottom[:, :2].max(axis=0)) / 2
        mesh.transform(Matrix.Translation(Vector((-centre[0], -centre[1], -z.min()))))
        mesh.materials.clear()
        mesh.materials.append(None)
        indices = np.zeros(len(mesh.polygons), dtype=np.int32)
        mesh.polygons.foreach_set("material_index", indices)
        mesh.update()
        # Kept between images, when no object uses it.
        mesh.use_fake_user = True
    return meshes


# ---------------------------------------------------------------- scene


def clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)
    for light in list(bpy.data.lights):
        bpy.data.lights.remove(light)
    for camera in list(bpy.data.cameras):
        bpy.data.cameras.remove(camera)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for curve in list(bpy.data.curves):
        if curve.users == 0:
            bpy.data.curves.remove(curve)


def _box_object(
    name: str, size_x: float, size_y: float, z_top: float, thickness: float, material
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    x, y = size_x / 2, size_y / 2
    z0, z1 = z_top - thickness, z_top
    verts = [
        (-x, -y, z0),
        (x, -y, z0),
        (x, y, z0),
        (-x, y, z0),
        (-x, -y, z1),
        (x, -y, z1),
        (x, y, z1),
        (-x, y, z1),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_board(rng: random.Random, style: str = "") -> tuple[float, float]:
    """Squares, a frame around them and a table. Returns (surface height, border width)."""
    light, dark, frame_material = board_materials(rng, style=style)
    mesh = bpy.data.meshes.new("squares")
    verts, faces, materials = [], [], []
    for rank in range(8):
        for file in range(8):
            x0, y0 = -4 + file, -4 + rank
            start = len(verts)
            verts += [(x0, y0, 0), (x0 + 1, y0, 0), (x0 + 1, y0 + 1, 0), (x0, y0 + 1, 0)]
            faces.append((start, start + 1, start + 2, start + 3))
            # a1 is a dark square.
            materials.append(1 if (file + rank) % 2 == 0 else 0)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(light)
    mesh.materials.append(dark)
    mesh.polygons.foreach_set("material_index", materials)
    mesh.update()
    squares = bpy.data.objects.new("squares", mesh)
    bpy.context.scene.collection.objects.link(squares)

    if style == "wood3d":
        border = rng.uniform(0.5, 1.2)
    else:
        border = rng.choice([0.0, rng.uniform(0.1, 0.5), rng.uniform(0.5, 1.4)])
    thickness = rng.uniform(0.05, 0.6)
    _box_object(
        "frame", 8 + 2 * border + 0.01, 8 + 2 * border + 0.01, -0.002, thickness, frame_material
    )
    _box_object("table", 400, 400, -thickness, 1, table_material(rng))
    return -thickness, border


# ---------------------------------------------------------------- overlays (wood3d style)


HIGHLIGHT_COLOURS = {
    "green": (0.08, 0.45, 0.12),
    "red": (0.55, 0.08, 0.05),
    "yellow": (0.65, 0.55, 0.08),
    "blue": (0.1, 0.3, 0.65),
}

ARROW_COLOURS = {
    "green": (0.05, 0.4, 0.1),
    "red": (0.5, 0.08, 0.05),
    "blue": (0.05, 0.2, 0.55),
    "orange": (0.7, 0.35, 0.02),
}


def _overlay_material(name: str, colour: tuple, fac: float) -> bpy.types.Material:
    """A transparent-plus-colour mix material for highlights and arrows."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    tree.nodes.remove(bsdf)
    output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    diffuse = tree.nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (*colour, 1)
    mix = tree.nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = fac
    tree.links.new(transparent.outputs[0], mix.inputs[1])
    tree.links.new(diffuse.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], output.inputs["Surface"])
    return mat


def build_highlights(highlights: list) -> None:
    """Coloured translucent planes on specific squares, like last-move or selection highlights."""
    for square, colour_name in highlights:
        file_idx = FILES.index(square[0])
        rank_idx = int(square[1]) - 1
        x, y = -3.5 + file_idx, -3.5 + rank_idx
        colour = HIGHLIGHT_COLOURS.get(colour_name, HIGHLIGHT_COLOURS["green"])
        mat = _overlay_material(f"hl_{square}", colour, 0.45)
        mesh = bpy.data.meshes.new(f"hl_{square}")
        verts = [
            (x - 0.5, y - 0.5, 0.003),
            (x + 0.5, y - 0.5, 0.003),
            (x + 0.5, y + 0.5, 0.003),
            (x - 0.5, y + 0.5, 0.003),
        ]
        mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(f"hl_{square}", mesh)
        bpy.context.scene.collection.objects.link(obj)


def build_arrows(arrows: list) -> None:
    """Semi-transparent arrows between square centres, like analysis arrows."""
    for start_sq, end_sq, colour_name in arrows:
        sf, sr = FILES.index(start_sq[0]), int(start_sq[1]) - 1
        ef, er = FILES.index(end_sq[0]), int(end_sq[1]) - 1
        sx, sy = -3.5 + sf, -3.5 + sr
        ex, ey = -3.5 + ef, -3.5 + er
        dx, dy = ex - sx, ey - sy
        length = math.sqrt(dx * dx + dy * dy)
        if length < 0.1:
            continue
        angle = math.atan2(dy, dx)
        colour = ARROW_COLOURS.get(colour_name, ARROW_COLOURS["green"])
        mat = _overlay_material(f"arr_{start_sq}{end_sq}", colour, 0.7)
        w = 0.15
        head_w = 0.3
        head_len = min(0.4, length * 0.35)
        shaft_len = max(0.1, length - head_len)
        verts = [
            (0, -w, 0.005),
            (shaft_len, -w, 0.005),
            (shaft_len, w, 0.005),
            (0, w, 0.005),
            (shaft_len, -head_w, 0.005),
            (length, 0, 0.005),
            (shaft_len, head_w, 0.005),
        ]
        mesh = bpy.data.meshes.new(f"arr_{start_sq}{end_sq}")
        mesh.from_pydata(verts, [], [(0, 1, 2, 3), (4, 5, 6)])
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(f"arr_{start_sq}{end_sq}", mesh)
        obj.location = (sx, sy, 0)
        obj.rotation_euler = (0, 0, angle)
        bpy.context.scene.collection.objects.link(obj)


def build_coordinates(border: float, rng: random.Random) -> None:
    """Prints a-h and 1-8 on the frame border, as on wooden tournament boards."""
    if border < 0.3:
        return
    # Contrast with the dark wood frame: cream or gold letters.
    mat, bsdf, tree = _material("label")
    label_colour = _hsv(rng.uniform(0.08, 0.14), rng.uniform(0.25, 0.55), rng.uniform(0.7, 0.95))
    _set_input(bsdf, ["Base Color"], (*label_colour, 1))
    _set_input(bsdf, ["Roughness"], 0.5)

    font_size = min(border * 0.55, 0.45)
    for i, letter in enumerate("abcdefgh"):
        for y_pos in (-4 - border * 0.45, 4 + border * 0.2):
            name = f"f{letter}_{y_pos:.0f}"
            curve = bpy.data.curves.new(name, "FONT")
            curve.body = letter
            curve.size = font_size
            curve.align_x = "CENTER"
            curve.align_y = "CENTER"
            curve.materials.append(mat)
            obj = bpy.data.objects.new(name, curve)
            obj.location = (-3.5 + i, y_pos, 0.001)
            bpy.context.scene.collection.objects.link(obj)
    for i, digit in enumerate("12345678"):
        for x_pos in (-4 - border * 0.45, 4 + border * 0.2):
            name = f"r{digit}_{x_pos:.0f}"
            curve = bpy.data.curves.new(name, "FONT")
            curve.body = digit
            curve.size = font_size
            curve.align_x = "CENTER"
            curve.align_y = "CENTER"
            curve.materials.append(mat)
            obj = bpy.data.objects.new(name, curve)
            obj.location = (x_pos, -3.5 + i, 0.001)
            bpy.context.scene.collection.objects.link(obj)


def light_scene(rng: random.Random) -> None:
    world = bpy.data.worlds.new("world") if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    if hasattr(world, "use_nodes"):
        try:
            world.use_nodes = True
        except AttributeError:
            pass
    background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    background.inputs["Color"].default_value = (
        *_hsv(rng.uniform(0.05, 0.6), rng.uniform(0, 0.3), rng.uniform(0.3, 0.9)),
        1,
    )
    background.inputs["Strength"].default_value = rng.uniform(0.2, 1.2)

    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = rng.uniform(0.5, 4)
    sun.angle = math.radians(rng.uniform(1, 30))
    sun.color = _hsv(rng.uniform(0.05, 0.15), rng.uniform(0, 0.25), 1)
    sun_obj = bpy.data.objects.new("sun", sun)
    sun_obj.rotation_euler = (
        math.radians(rng.uniform(5, 60)),
        0,
        math.radians(rng.uniform(0, 360)),
    )
    bpy.context.scene.collection.objects.link(sun_obj)

    for index in range(rng.randint(0, 2)):
        area = bpy.data.lights.new(f"area{index}", "AREA")
        area.energy = rng.uniform(200, 2500)
        area.size = rng.uniform(2, 12)
        area_obj = bpy.data.objects.new(f"area{index}", area)
        angle = rng.uniform(0, 2 * math.pi)
        area_obj.location = (14 * math.cos(angle), 14 * math.sin(angle), rng.uniform(6, 20))
        direction = -Vector(area_obj.location)
        area_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.collection.objects.link(area_obj)


def place_pieces(
    rng, placement, meshes, white, black, surface, scale
) -> list[tuple[str, str | None, bpy.types.Object]]:
    placed = []
    for square, code in placement.items():
        file, rank = FILES.index(square[0]), int(square[1]) - 1
        # People rarely centre pieces exactly.
        x = -3.5 + file + rng.gauss(0, 0.07)
        y = -3.5 + rank + rng.gauss(0, 0.07)
        placed.append((code, square, _piece(code, meshes, white, black, (x, y, 0), rng, scale)))
    if rng.random() < 0.3:
        # Captured pieces beside the board. They're labelled as pieces, but belong to no square.
        for _ in range(rng.randint(1, 6)):
            side = rng.choice([-1, 1])
            along = rng.uniform(-4, 4)
            out = rng.uniform(4.9, 6.5)
            x, y = (side * out, along) if rng.random() < 0.5 else (along, side * out)
            code = rng.choice("PPPPNBRQpppnbrq")
            placed.append(
                (code, None, _piece(code, meshes, white, black, (x, y, surface), rng, scale))
            )
    return placed


def _piece(code, meshes, white, black, location, rng, scale) -> bpy.types.Object:
    obj = bpy.data.objects.new(code, meshes[code.upper()])
    obj.location = location
    # Scale is a width and a height for each piece type, so each image varies the set's proportions.
    across, up = scale[code.upper()]
    obj.scale = (across, across, up)
    obj.rotation_euler = (0, 0, rng.uniform(0, 2 * math.pi))
    bpy.context.scene.collection.objects.link(obj)
    obj.material_slots[0].link = "OBJECT"
    obj.material_slots[0].material = white if code.isupper() else black
    return obj


# ---------------------------------------------------------------- camera and labels


def project(points: np.ndarray, camera: bpy.types.Object, width: int, height: int) -> np.ndarray:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    projection = np.array(camera.calc_matrix_camera(depsgraph, x=width, y=height))
    view = np.array(camera.matrix_world.inverted())
    homogeneous = np.c_[points, np.ones(len(points))]
    clip = homogeneous @ (projection @ view).T
    w = clip[:, 3:4]
    ndc = clip[:, :3] / np.where(np.abs(w) < 1e-9, 1e-9, w)
    pixels = np.c_[(ndc[:, 0] + 1) / 2 * width, (1 - ndc[:, 1]) / 2 * height]
    pixels[w[:, 0] <= 0] = np.nan
    return pixels


def place_camera(rng, width, height, tallest, top_down: bool = False) -> bpy.types.Object:
    data = bpy.data.cameras.new("camera")
    data.lens = rng.uniform(24, 60)
    data.sensor_width = 36
    camera = bpy.data.objects.new("camera", data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    azimuth = rng.uniform(0, 2 * math.pi)
    if top_down:
        elevation = math.radians(rng.uniform(70, 88))
    else:
        elevation = math.radians(rng.choice([rng.uniform(30, 60), rng.uniform(45, 88)]))
    target = Vector((rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), 0))
    roll = math.radians(rng.gauss(0, 4))
    fill = rng.uniform(0.75, 1.0)
    # Needed in view: the grid corners and the tops of pieces on the outer squares.
    check = np.array([[x, y, z] for x in (-4.6, 4.6) for y in (-4.6, 4.6) for z in (0, tallest)])
    # Start close and back away until everything fits, so the board fills the frame as photos do.
    distance = 2.0
    for _ in range(150):
        direction = Vector(
            (
                math.cos(azimuth) * math.cos(elevation),
                math.sin(azimuth) * math.cos(elevation),
                math.sin(elevation),
            )
        )
        camera.location = target + direction * distance
        rotation = (-direction).to_track_quat("-Z", "Y").to_matrix().to_4x4() @ Matrix.Rotation(
            roll, 4, "Z"
        )
        camera.rotation_euler = rotation.to_euler()
        bpy.context.view_layer.update()
        pixels = project(check, camera, width, height)
        margin = (1 - fill) / 2
        inside = (
            not np.isnan(pixels).any()
            and pixels[:, 0].min() > margin * width
            and pixels[:, 0].max() < (1 - margin) * width
            and pixels[:, 1].min() > margin * height
            and pixels[:, 1].max() < (1 - margin) * height
        )
        if inside:
            break
        distance *= 1.03
    return camera


def piece_box(obj, points, camera, width, height) -> list[float] | None:
    world = np.array(obj.matrix_world)
    moved = np.c_[points, np.ones(len(points))] @ world.T
    pixels = project(moved[:, :3], camera, width, height)
    if np.isnan(pixels).any():
        return None
    x0, y0 = np.clip(pixels.min(axis=0), 0, [width, height])
    x1, y1 = np.clip(pixels.max(axis=0), 0, [width, height])
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return [float(x0), float(y0), float(x1 - x0), float(y1 - y0)]


# ---------------------------------------------------------------- main


def configure_render(rng, width, height, samples) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 2
    scene.cycles.transmission_bounces = 2
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = rng.randint(80, 95)
    scene.view_settings.exposure = rng.uniform(-0.6, 0.6)


def main() -> None:
    jobs = json.loads(Path(sys.argv[sys.argv.index("--") + 1]).read_text(encoding="utf-8"))
    out = Path(jobs["out"])
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    meshes = load_set(Path(jobs["set_file"]), jobs["pieces"])
    sample_points = {}
    for code, mesh in meshes.items():
        points = _vertices(mesh)
        if len(points) > 3000:
            points = points[np.random.default_rng(0).choice(len(points), 3000, replace=False)]
        sample_points[code] = points
    king_height = float(np.ptp(_vertices(meshes["K"])[:, 2]))
    widest_base = max(_base_and_top_width(_vertices(m))[0] / 2 for m in meshes.values())

    for job in jobs["images"]:
        image_path = out / f"{job['id']}.jpg"
        if image_path.exists():
            continue
        started = time.perf_counter()
        rng = random.Random(job["seed"])
        clear_scene()
        width, height = rng.choice([(960, 720), (720, 960), (960, 960), (1024, 576)])
        style = jobs.get("style", "")
        if style == "wood3d":
            width, height = rng.choice([(960, 960), (960, 720), (720, 960), (800, 800)])
        configure_render(rng, width, height, jobs.get("samples", 24))

        # Kings stand about 1.5 to 2.1 squares tall, and no base may overflow its square.
        scale = rng.uniform(1.5, 2.1) / king_height
        scale = min(scale, 0.85 / max(widest_base, 1e-6))
        # Each type is stretched a little on its own, for more shapes than the sets alone give.
        # Pawns stay the shortest, as in real sets.
        stretch = {}
        for kind in TYPES:
            across = min(scale * rng.uniform(0.9, 1.1), 0.85 / max(widest_base, 1e-6))
            up = scale * (rng.uniform(0.9, 1.05) if kind == "P" else rng.uniform(0.9, 1.15))
            stretch[kind] = (across, up)

        surface, border = build_board(rng, style=style)
        if style == "wood3d":
            build_coordinates(border, rng)
        if job.get("highlights"):
            build_highlights(job["highlights"])
        if job.get("arrows"):
            build_arrows(job["arrows"])
        light_scene(rng)
        white, black = piece_materials(rng, glossy=(style == "wood3d"))
        placed = place_pieces(rng, job["placement"], meshes, white, black, surface, stretch)
        camera = place_camera(
            rng, width, height, king_height * max(up for _, up in stretch.values()),
            top_down=(style == "wood3d"),
        )

        corners = project(
            np.array([[-4, -4, 0], [4, -4, 0], [4, 4, 0], [-4, 4, 0]], dtype=float),
            camera,
            width,
            height,
        )
        pieces = []
        for code, square, obj in placed:
            box = piece_box(obj, sample_points[code.upper()], camera, width, height)
            if box is not None:
                pieces.append({"piece": code, "square": square, "box": box})

        bpy.context.scene.render.filepath = str(image_path)
        bpy.ops.render.render(write_still=True)
        label = {
            "set": jobs["set_id"],
            "seed": job["seed"],
            "corners": corners.round(2).tolist(),
            "pieces": pieces,
            "size": [width, height],
        }
        (out / f"{job['id']}.json").write_text(json.dumps(label), encoding="utf-8")
        print(f"rendered {job['id']} in {time.perf_counter() - started:.1f}s", flush=True)


main()
