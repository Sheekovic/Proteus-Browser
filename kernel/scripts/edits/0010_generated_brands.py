"""Applies the in-place edits of patch 0010 (kernel-generated client hint brands) to a
Chromium checkout that already has patch 0005 applied.
usage: 0010_generated_brands.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
UA = "components/embedder_support/user_agent_utils.cc"


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


# Sec-CH-UA (major versions). Chromium's own generator is seeded with the major
# version, which is what makes the GREASE brand and the order match a real browser
# of that version.
edit(
    UA,
    "  for (const base::proteus::UaBrand& brand : data->brands) {\n"
    "    metadata.brand_version_list.emplace_back(brand.brand, brand.version);\n"
    "  }\n",
    "  const bool generate_brands =\n"
    "      !data->brand.empty() && !data->full_version.empty();\n"
    "  int brand_seed = 0;\n"
    "  if (generate_brands) {\n"
    "    // The generator takes the version text to print as-is, so the major\n"
    "    // list needs just the major number (\"158\"), not the full version.\n"
    "    const std::string major_version =\n"
    "        data->full_version.substr(0, data->full_version.find('.'));\n"
    "    base::StringToInt(major_version, &brand_seed);\n"
    "    if (brand_seed < 0) {\n"
    "      brand_seed = 0;\n"
    "    }\n"
    "    metadata.brand_version_list = GenerateBrandVersionList(\n"
    "        brand_seed, data->brand, major_version,\n"
    "        blink::UserAgentBrandVersionType::kMajorVersion);\n"
    "  } else {\n"
    "    for (const base::proteus::UaBrand& brand : data->brands) {\n"
    "      metadata.brand_version_list.emplace_back(brand.brand, brand.version);\n"
    "    }\n"
    "  }\n",
)

# Sec-CH-UA-Full-Version-List.
edit(
    UA,
    "  for (const base::proteus::UaBrand& brand : data->full_version_list) {\n"
    "    metadata.brand_full_version_list.emplace_back(brand.brand,\n"
    "                                                  brand.version);\n"
    "  }\n",
    "  if (generate_brands) {\n"
    "    metadata.brand_full_version_list = GenerateBrandVersionList(\n"
    "        brand_seed, data->brand, data->full_version,\n"
    "        blink::UserAgentBrandVersionType::kFullVersion);\n"
    "  } else {\n"
    "    for (const base::proteus::UaBrand& brand : data->full_version_list) {\n"
    "      metadata.brand_full_version_list.emplace_back(brand.brand,\n"
    "                                                    brand.version);\n"
    "    }\n"
    "  }\n",
)
