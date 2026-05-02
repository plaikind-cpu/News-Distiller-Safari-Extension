import json, os, subprocess
from PIL import Image

# Source icon from the repo
SRC = "Resources/images/icon128.png"

# Open and crop to square
img = Image.open(SRC).convert("RGBA")
w, h = img.size
side = min(w, h)
img = img.crop(((w-side)//2, (h-side)//2, (w-side)//2+side, (h-side)//2+side))

# Find the Xcode asset catalog for app icons
import glob
catalogs = glob.glob("build/**/AppIcon.appiconset", recursive=True)
if not catalogs:
    print("No AppIcon.appiconset found - searching...")
    catalogs = glob.glob("build/**/*.xcassets", recursive=True)
    print(f"Found xcassets: {catalogs}")
    for c in catalogs:
        os.makedirs(os.path.join(c, "AppIcon.appiconset"), exist_ok=True)
        catalogs = [os.path.join(c, "AppIcon.appiconset")]
        break

if not catalogs:
    print("ERROR: Could not find AppIcon.appiconset")
    exit(1)

catalog = catalogs[0]
print(f"Writing icons to: {catalog}")

# Required sizes: (points, scale, idiom)
sizes = [
    (20, 1, "iphone"), (20, 2, "iphone"), (20, 3, "iphone"),
    (29, 1, "iphone"), (29, 2, "iphone"), (29, 3, "iphone"),
    (40, 1, "iphone"), (40, 2, "iphone"), (40, 3, "iphone"),
    (60, 2, "iphone"), (60, 3, "iphone"),
    (20, 1, "ipad"),  (20, 2, "ipad"),
    (29, 1, "ipad"),  (29, 2, "ipad"),
    (40, 1, "ipad"),  (40, 2, "ipad"),
    (76, 1, "ipad"),  (76, 2, "ipad"),
    (83.5, 2, "ipad"),
    (1024, 1, "ios-marketing"),
]

images_json = []
seen = set()
for pt, scale, idiom in sizes:
    px = int(pt * scale)
    filename = f"icon_{px}x{px}@{scale}x_{idiom}.png"
    if px not in seen:
        resized = img.resize((px, px), Image.LANCZOS)
        resized.save(os.path.join(catalog, filename))
        seen.add(px)
    images_json.append({
        "idiom": idiom,
        "scale": f"{scale}x",
        "size": f"{pt}x{pt}",
        "filename": filename
    })

contents = {"images": images_json, "info": {"author": "xcode", "version": 1}}
with open(os.path.join(catalog, "Contents.json"), "w") as f:
    json.dump(contents, f, indent=2)

print(f"Generated {len(seen)} icon sizes in {catalog}")
