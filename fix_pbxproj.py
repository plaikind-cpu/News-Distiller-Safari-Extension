import re
import subprocess

PBXPROJ = "build/News-Distiller/News-Distiller.xcodeproj/project.pbxproj"
TEAM_ID = "4FPWPSM7JG"

with open(PBXPROJ, "r") as f:
    content = f.read()

# Print what bundle IDs exist before patching
print("=== Bundle IDs found ===")
for m in re.finditer(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);', content):
    print(f"  {m.group(1)}")

# Step 1: Fix bundle ID case
content = content.replace('com.pklmedialab.News-Distiller.Extension', 'com.pklmedialab.news-distiller.extension')
content = content.replace('com.pklmedialab.News-Distiller', 'com.pklmedialab.news-distiller')
content = content.replace('CODE_SIGN_STYLE = Automatic;', 'CODE_SIGN_STYLE = Manual;')

# Step 2: Remove any existing entries we'll re-add
content = re.sub(r'\s*PROVISIONING_PROFILE_SPECIFIER = [^;]*;', '', content)
content = re.sub(r'\s*DEVELOPMENT_TEAM = [^;]*;', '', content)

print("\n=== After fix, bundle IDs ===")
for m in re.finditer(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);', content):
    print(f"  {m.group(1)}")

# Step 3: Add signing per target - use simpler approach
# Find each XCBuildConfiguration block and inject settings
def patch_config(match):
    block = match.group(0)
    if 'com.pklmedialab.news-distiller.extension' in block:
        insert = (
            f'\n\t\t\t\tDEVELOPMENT_TEAM = {TEAM_ID};'
            f'\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Extension-Distribution";'
        )
        return block.replace(
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";',
            f'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";{insert}'
        )
    elif 'com.pklmedialab.news-distiller"' in block:
        insert = (
            f'\n\t\t\t\tDEVELOPMENT_TEAM = {TEAM_ID};'
            f'\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Distribution";'
        )
        return block.replace(
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";',
            f'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";{insert}'
        )
    return block

# Match XCBuildConfiguration blocks (they have isa = XCBuildConfiguration)
content = re.sub(
    r'\{[^{}]*isa = XCBuildConfiguration[^{}]*\}',
    patch_config, content, flags=re.DOTALL
)

# Step 4: Set deployment target
content = re.sub(r'IPHONEOS_DEPLOYMENT_TARGET = \d+[\d.]*;', 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;', content)

with open(PBXPROJ, "w") as f:
    f.write(content)

print("\n=== Final signing settings ===")
result = subprocess.run(
    ['grep', '-E', 'PRODUCT_BUNDLE_IDENTIFIER|PROVISIONING_PROFILE_SPECIFIER|DEVELOPMENT_TEAM'],
    input=content, capture_output=True, text=True)
print(result.stdout)
print("Done!")
