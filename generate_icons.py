import json, os, glob
from PIL import Image

# Source icon from the repo
SRC = "Resources/images/icon128.png"

# Open and crop to square
img = Image.open(SRC).convert("RGBA")
w, h = img.size
side = min(w, h)
img = img.crop(((w-side)//2, (h-side)//2, (w-side)//2+side, (h-side)//2+side))

# 1. Copy Icon.png for the app wrapper
icon_dest = "build/News-Distiller/Shared (App)/Resources/Icon.png"
img.resize((128, 128), Image.LANCZOS).save(icon_dest)
print(f"Copied Icon.png to {icon_dest}")

# 2. Find and populate the AppIcon.appiconset
catalogs = glob.glob("build/**/*.appiconset", recursive=True)
if not catalogs:
    # Create it
    xcassets = glob.glob("build/**/*.xcassets", recursive=True)
    if xcassets:
        catalog = os.path.join(xcassets[0], "AppIcon.appiconset")
        os.makedirs(catalog, exist_ok=True)
    else:
        print("WARNING: No xcassets found")
        exit(0)
else:
    catalog = catalogs[0]

print(f"Writing icon sizes to: {catalog}")

# Required sizes
sizes = [
    (20, 1, "iphone"), (20, 2, "iphone"), (20, 3, "iphone"),
    (29, 1, "iphone"), (29, 2, "iphone"), (29, 3, "iphone"),
    (40, 1, "iphone"), (40, 2, "iphone"), (40, 3, "iphone"),
    (60, 2, "iphone"), (60, 3, "iphone"),
    (20, 1, "ipad"),   (20, 2, "ipad"),
    (29, 1, "ipad"),   (29, 2, "ipad"),
    (40, 1, "ipad"),   (40, 2, "ipad"),
    (76, 1, "ipad"),   (76, 2, "ipad"),
    (83.5, 2, "ipad"),
    (1024, 1, "ios-marketing"),
]

images_json = []
generated = {}
for pt, scale, idiom in sizes:
    px = int(pt * scale)
    filename = f"icon_{px}x{px}.png"
    if px not in generated:
        resized = img.resize((px, px), Image.LANCZOS)
        resized.save(os.path.join(catalog, filename))
        generated[px] = filename
    images_json.append({
        "idiom": idiom,
        "scale": f"{scale}x",
        "size": f"{int(pt) if pt == int(pt) else pt}x{int(pt) if pt == int(pt) else pt}",
        "filename": generated[px]
    })

contents = {"images": images_json, "info": {"author": "xcode", "version": 1}}
with open(os.path.join(catalog, "Contents.json"), "w") as f:
    json.dump(contents, f, indent=2)

print(f"Generated {len(generated)} icon sizes")
