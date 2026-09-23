"""Print one machine-readable capability line for a local Blender/Cycles runtime."""

import json

import bpy

preferences = bpy.context.preferences.addons["cycles"].preferences
devices = [{"backend": "CPU", "name": "CPU"}]
for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
    try:
        preferences.compute_device_type = backend
        preferences.get_devices()
        devices.extend(
            {"backend": backend, "name": device.name}
            for device in preferences.devices
            if device.type == backend
        )
    except Exception:
        pass
print("MATVISION_CAPABILITIES=" + json.dumps({"version": bpy.app.version_string, "devices": devices}))
