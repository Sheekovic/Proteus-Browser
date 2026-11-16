"""Applies the in-place edits of patch 0015 to a Chromium checkout: the profile's
position for navigator.geolocation.
usage: 0015_geolocation.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
PROVIDER = "services/device/geolocation/geolocation_provider_impl.cc"


def edit(rel, old, new):
    path = SRC / rel
    text = path.read_text(encoding="utf-8")
    if new in text:
        print("already applied:", rel)
        return
    if text.count(old) != 1:
        sys.exit("anchor not found exactly once in %s: %r" % (rel, old))
    path.write_text(text.replace(old, new), encoding="utf-8", newline="\n")
    print("edited:", rel)


# Everything that asks for the location goes through this provider. With a profile
# position, answer with it and never register the caller: the location providers
# (system services, the network lookup) are then never started, so the machine's
# real surroundings are not even gathered.
edit(
    PROVIDER,
    "    const LocationUpdateCallback& callback,\n"
    "    bool enable_high_accuracy) {\n"
    "  DCHECK(main_task_runner_->BelongsToCurrentThread());\n",
    "    const LocationUpdateCallback& callback,\n"
    "    bool enable_high_accuracy) {\n"
    "  DCHECK(main_task_runner_->BelongsToCurrentThread());\n"
    "  if (mojom::GeopositionResultPtr forced = ProteusForcedPosition()) {\n"
    "    callback.Run(*forced);\n"
    "    return base::CallbackListSubscription();\n"
    "  }\n",
)
edit(
    PROVIDER,
    "mojom::GeopositionResultPtr GeolocationProviderImpl::GetCachedPosition() {\n"
    "  DCHECK(main_task_runner_->BelongsToCurrentThread());\n",
    "mojom::GeopositionResultPtr GeolocationProviderImpl::GetCachedPosition() {\n"
    "  DCHECK(main_task_runner_->BelongsToCurrentThread());\n"
    "  if (mojom::GeopositionResultPtr forced = ProteusForcedPosition()) {\n"
    "    return forced;\n"
    "  }\n",
)
edit(
    PROVIDER,
    "namespace device {\n\nnamespace {\n",
    "namespace device {\n\nnamespace {\n\n"
    "// The profile's position as a fresh fix, or null without one.\n"
    "mojom::GeopositionResultPtr ProteusForcedPosition() {\n"
    "  const base::proteus::Config& config = base::proteus::GetConfig();\n"
    "  if (!config.has_geolocation) {\n"
    "    return nullptr;\n"
    "  }\n"
    "  auto position = mojom::Geoposition::New();\n"
    "  position->latitude = config.geolocation_latitude;\n"
    "  position->longitude = config.geolocation_longitude;\n"
    "  position->accuracy = config.geolocation_accuracy;\n"
    "  position->timestamp = base::Time::Now();\n"
    "  return mojom::GeopositionResult::NewPosition(std::move(position));\n"
    "}\n",
)
edit(
    PROVIDER,
    '#include "base/notreached.h"\n',
    '#include "base/notreached.h"\n#include "base/proteus/proteus_config.h"\n',
)

# The operating system's own location switch (Windows, macOS) decides whether the
# browser may use the system's location services. A profile position does not come
# from those, so it must work with the switch off; otherwise a site the user allowed
# would be refused, and would learn how this machine is set up.
PERMISSION = "services/device/public/cpp/geolocation/geolocation_system_permission_manager.cc"
edit(
    PERMISSION,
    "  CHECK(features::IsOsLevelGeolocationPermissionSupportEnabled());\n"
    "  return permission_cache_;\n",
    "  CHECK(features::IsOsLevelGeolocationPermissionSupportEnabled());\n"
    "  if (base::proteus::GetConfig().has_geolocation) {\n"
    "    return LocationSystemPermissionStatus::kAllowed;\n"
    "  }\n"
    "  return permission_cache_;\n",
)
edit(
    PERMISSION,
    '#include "base/no_destructor.h"\n',
    '#include "base/no_destructor.h"\n#include "base/proteus/proteus_config.h"\n',
)
