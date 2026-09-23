"""MatVision Ultimate prototype for Blender 4.5.14/Cycles.

Run: blender -b --factory-startup --python-exit-code 1 --python render.py -- package.json output.png status.json
Only the flat, unstitched mat subset in package schema v1 is supported.
"""

import json
import math
import os
import re
import sys
import traceback

import bpy
from mathutils import Vector


def args():
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 3:
        raise ValueError("Expected scene package, output PNG, status JSON")
    return values


PACKAGE, OUTPUT, STATUS = map(os.path.abspath, args())


def report(stage, progress, detail=""):
    next_path = STATUS + ".next"
    with open(next_path, "w", encoding="utf-8") as handle:
        json.dump({"stage": stage, "progress": progress, "detail": detail}, handle)
    os.replace(next_path, STATUS)


def color(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (1,)


def material(name, base, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color(base)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color(base)
    shader.inputs["Roughness"].default_value = roughness
    return mat, shader


def rounded_outline(width, depth, radius, steps=8):
    r = max(0.0001, min(radius, width / 2, depth / 2))
    points = []
    corners = [
        (width / 2 - r, depth / 2 - r, 0),
        (-width / 2 + r, depth / 2 - r, 90),
        (-width / 2 + r, -depth / 2 + r, 180),
        (width / 2 - r, -depth / 2 + r, 270),
    ]
    for cx, cy, start in corners:
        for step in range(steps + 1):
            angle = math.radians(start + step * 90 / steps)
            points.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    # The corner order above is counterclockwise starting at the upper-right.
    return points


def build_mat(package, root):
    product = package["product"]
    width = product["widthMm"] / 1000
    depth = product["heightMm"] / 1000
    thick = product["thicknessMm"] / 1000
    outline = rounded_outline(width, depth, product["cornerRadiusMm"] / 1000)
    count = len(outline)
    vertices = [(x, y, 0) for x, y in outline] + [(x, y, thick) for x, y in outline]
    bottom_center = len(vertices)
    vertices.append((0, 0, 0))
    top_center = len(vertices)
    vertices.append((0, 0, thick))
    faces = []
    material_indices = []
    for i in range(count):
        j = (i + 1) % count
        faces.append((top_center, count + i, count + j))
        material_indices.append(0)
        faces.append((bottom_center, j, i))
        material_indices.append(2)
        faces.append((i, j, count + j, count + i))
        material_indices.append(1)
    mesh = bpy.data.meshes.new("MatVision rounded mat")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("MatVision mat", mesh)
    bpy.context.collection.objects.link(obj)
    cloth, cloth_shader = material("Fabric and print", "#e7e4df", package["materials"]["fabricRoughness"])
    if package.get("printPath"):
        image = bpy.data.images.load(os.path.join(root, package["printPath"]), check_existing=False)
        image.colorspace_settings.name = "sRGB"
        nodes = cloth.node_tree.nodes
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.extension = "CLIP"
        mixer = nodes.new("ShaderNodeMixRGB")
        mixer.blend_type = "MIX"
        mixer.inputs[1].default_value = color("#e7e4df")
        cloth.node_tree.links.new(tex.outputs["Alpha"], mixer.inputs[0])
        cloth.node_tree.links.new(tex.outputs["Color"], mixer.inputs[2])
        cloth.node_tree.links.new(mixer.outputs[0], cloth_shader.inputs["Base Color"])
    side, _ = material("Fabric edge prototype", "#494c4a", 0.82)
    rubber, _ = material("Matte rubber", "#171a1a", 0.93)
    for mat in (cloth, side, rubber):
        mesh.materials.append(mat)
    for polygon, index in zip(mesh.polygons, material_indices):
        polygon.material_index = index
    uv = mesh.uv_layers.new(name="MatVision print")
    area = package["printableArea"]
    inv = package["printInverse"]
    for polygon in mesh.polygons:
        if polygon.material_index != 0:
            continue
        for loop_index in polygon.loop_indices:
            x, y, _ = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            pu = (x * 1000 + product["widthMm"] / 2 - area["xMm"]) / area["widthMm"]
            pv = 1 - (product["heightMm"] / 2 - y * 1000 - area["yMm"]) / area["heightMm"]
            uv.data[loop_index].uv = (inv[0] * pu + inv[1] * pv + inv[2], inv[3] * pu + inv[4] * pv + inv[5])
    return obj


def create_world(package):
    # Float image data is a genuine HDR environment; this provisional gradient
    # is local and does not claim to match the Studio PMREM or Poly Haven HDRI.
    image = bpy.data.images.new("MatVision prototype HDR", width=64, height=32, float_buffer=True)
    pixels = []
    for y in range(32):
        for x in range(64):
            glow = max(0, 1 - ((x / 64 - 0.28) / 0.12) ** 2 - ((y / 32 - 0.28) / 0.20) ** 2)
            level = 0.22 + 1.8 * glow
            pixels.extend((level, level * 0.98, level * 0.94, 1))
    image.pixels[:] = pixels
    world = bpy.data.worlds.new("MatVision HDR studio")
    world.use_nodes = True
    nodes = world.node_tree.nodes
    env = nodes.new("ShaderNodeTexEnvironment")
    env.image = image
    background = nodes.get("Background")
    background.inputs["Strength"].default_value = package["environment"]["intensity"]
    world.node_tree.links.new(env.outputs["Color"], background.inputs["Color"])
    bpy.context.scene.world = world


def configure_device(requested):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    preferences = bpy.context.preferences.addons["cycles"].preferences
    found = []
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            preferences.compute_device_type = backend
            preferences.get_devices()
            devices = [device for device in preferences.devices if device.type == backend]
            if devices:
                found.append((backend, devices))
        except Exception:
            continue
    choice = None
    if requested != "CPU":
        choice = next(((kind, devices) for kind, devices in found if requested in ("AUTO", kind)), None)
    if choice:
        backend, devices = choice
        preferences.compute_device_type = backend
        preferences.get_devices()
        for device in preferences.devices:
            device.use = device.type == backend
        scene.cycles.device = "GPU"
        return backend + ": " + ", ".join(device.name for device in devices)
    scene.cycles.device = "CPU"
    return "CPU" + (" fallback" if requested != "CPU" else "")


def build_scene(package):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    root = os.path.dirname(PACKAGE)
    build_mat(package, root)
    floor, _ = material("Studio floor", package["environment"]["floorColor"], 0.8)
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, -0.0002))
    bpy.context.object.name = "Studio floor"
    bpy.context.object.data.materials.append(floor)
    lamp_data = bpy.data.lights.new("Large key", type="AREA")
    lamp_data.energy = 160
    lamp_data.shape = "RECTANGLE"
    lamp_data.size = 1.0
    lamp_data.size_y = 0.65
    lamp = bpy.data.objects.new("Large key", lamp_data)
    bpy.context.collection.objects.link(lamp)
    lamp.location = (-0.8, -0.6, 1.2)
    lamp.rotation_euler = (-lamp.location).to_track_quat("-Z", "Y").to_euler()
    camera = package["camera"]
    data = bpy.data.cameras.new("MatVision camera")
    data.type = "PERSP"
    data.sensor_fit = "VERTICAL"
    data.angle_y = math.radians(camera["fovDeg"])
    obj = bpy.data.objects.new("MatVision camera", data)
    bpy.context.collection.objects.link(obj)
    x, y, z = camera["positionMm"]
    obj.location = (x / 1000, -z / 1000, y / 1000)
    tx, ty, tz = camera["targetMm"]
    target = Vector((tx / 1000, -tz / 1000, ty / 1000))
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = obj
    create_world(package)
    settings = package["render"]
    device = configure_device(settings["device"])
    scene = bpy.context.scene
    scene.cycles.samples = settings["samples"]
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 10
    scene.render.resolution_x = settings["widthPx"]
    scene.render.resolution_y = settings["heightPx"]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.render.filepath = OUTPUT
    return device


def on_stats(_scene, stats):
    match = re.search(r"Sample\s+(\d+)\s*/\s*(\d+)", str(stats))
    if match:
        report("rendering", int(match.group(1)) / max(1, int(match.group(2))), "Cycles samples")


try:
    with open(PACKAGE, encoding="utf-8") as handle:
        package = json.load(handle)
    if package.get("schemaVersion") != 1:
        raise ValueError("Unsupported Cycles package version")
    report("preparing", 0)
    chosen_device = build_scene(package)
    report("rendering", 0, chosen_device)
    bpy.app.handlers.render_stats.append(on_stats)
    bpy.ops.render.render(write_still=True)
    if not os.path.isfile(OUTPUT):
        raise RuntimeError("Cycles did not write a PNG")
    report("done", 1, chosen_device)
except Exception as error:
    report("error", 0, str(error))
    traceback.print_exc()
    raise
