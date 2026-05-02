import re
import subprocess

PBXPROJ = "build/News-Distiller/News-Distiller.xcodeproj/project.pbxproj"
TEAM_ID = "4FPWPSM7JG"

with open(PBXPROJ, "r") as f:
    content = f.read()

print("=== Before fix ===")
for m in re.finditer(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);', content):
    print(f"  {m.group(1)}")

# Step 1: Fix ALL variants of the bundle ID - case insensitive for Extension part
content = re.sub(
    r'com\.pklmedialab\.news-distiller\.Extension',
    'com.pklmedialab.news-distiller.extension',
    content
)
content = re.sub(
    r'com\.pklmedialab\.News-Distiller\.Extension',
    'com.pklmedialab.news-distiller.extension',
    content
)
content = re.sub(
    r'com\.pklmedialab\.News-Distiller\b',
    'com.pklmedialab.news-distiller',
    content
)
content = content.replace('CODE_SIGN_STYLE = Automatic;', 'CODE_SIGN_STYLE = Manual;')

print("\n=== After fix ===")
for m in re.finditer(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);', content):
    print(f"  {m.group(1)}")

# Step 2: Remove existing signing entries
content = re.sub(r'\s*PROVISIONING_PROFILE_SPECIFIER = [^;]*;', '', content)
content = re.sub(r'\s*DEVELOPMENT_TEAM = [^;]*;', '', content)

# Step 3: Add signing per XCBuildConfiguration block
def patch_config(match):
    block = match.group(0)
    if 'com.pklmedialab.news-distiller.extension' in block:
        return block.replace(
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";',
            f'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";\n\t\t\t\tDEVELOPMENT_TEAM = {TEAM_ID};\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Extension-Distribution";'
        )
    elif 'com.pklmedialab.news-distiller"' in block:
        return block.replace(
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";',
            f'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";\n\t\t\t\tDEVELOPMENT_TEAM = {TEAM_ID};\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Distribution";'
        )
    return block

content = re.sub(
    r'\{[^{}]*isa = XCBuildConfiguration[^{}]*\}',
    patch_config, content, flags=re.DOTALL
)

# Step 4: Deployment target
content = re.sub(r'IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;', 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;', content)

with open(PBXPROJ, "w") as f:
    f.write(content)

print("\n=== Final signing settings ===")
for m in re.finditer(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);', content):
    print(f"  Bundle: {m.group(1)}")
for m in re.finditer(r'PROVISIONING_PROFILE_SPECIFIER = ([^;]+);', content):
    print(f"  Profile: {m.group(1)}")
print("Done!")
