import json, os, glob, shutil

# 1. Copy Icon.png for the app wrapper
icon_dest = "build/News-Distiller/Shared (App)/Resources/Icon.png"
if os.path.exists("Resources/icons/Icon.png"):
    shutil.copy("Resources/icons/Icon.png", icon_dest)
    print(f"Copied Icon.png")
else:
    shutil.copy("Resources/images/icon128.png", icon_dest)
    print(f"Copied icon128.png as Icon.png (fallback)")

# 2. Populate the AppIcon.appiconset
catalogs = glob.glob("build/**/*.appiconset", recursive=True)
if not catalogs:
    xcassets = glob.glob("build/**/*.xcassets", recursive=True)
    if xcassets:
        catalog = os.path.join(xcassets[0], "AppIcon.appiconset")
        os.makedirs(catalog, exist_ok=True)
    else:
        catalog = None
else:
    catalog = catalogs[0]

if catalog and os.path.exists("Resources/icons"):
    for f in os.listdir("Resources/icons"):
        if f.endswith(".png") or f == "Contents.json":
            shutil.copy(f"Resources/icons/{f}", os.path.join(catalog, f))
    print(f"Icons copied to {catalog}")

# 3. Copy manifest.json into every possible extension location
print("\nSearching for extension bundle locations...")
print("All build dirs:")
for root, dirs, files in os.walk("build"):
    for d in dirs:
        print(f"  {os.path.join(root, d)}")

# Find all .appex directories
appex_dirs = glob.glob("build/**/*.appex", recursive=True)
print(f"\nFound .appex dirs: {appex_dirs}")
for appex in appex_dirs:
    dst = os.path.join(appex, "manifest.json")
    if os.path.exists("manifest.json"):
        shutil.copy("manifest.json", dst)
        print(f"Copied manifest.json to {dst}")

# Also try Resources subfolder inside .appex
for appex in appex_dirs:
    res_dir = os.path.join(appex, "Resources")
    if os.path.exists(res_dir):
        dst = os.path.join(res_dir, "manifest.json")
        shutil.copy("manifest.json", dst)
        print(f"Copied manifest.json to {dst}")

# Copy to all Extension resource folders in build tree
for root, dirs, files in os.walk("build"):
    if "Extension" in root and os.path.isdir(root):
        if "manifest.json" not in files:
            dst = os.path.join(root, "manifest.json")
            if os.path.exists("manifest.json"):
                shutil.copy("manifest.json", dst)
                print(f"Copied manifest.json to {dst}")

print("\nDone!")
