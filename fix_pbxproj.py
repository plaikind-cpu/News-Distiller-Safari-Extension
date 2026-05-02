import re
import subprocess

PBXPROJ = "build/News-Distiller/News-Distiller.xcodeproj/project.pbxproj"
TEAM_ID = "4FPWPSM7JG"

# Step 1: Fix bundle ID case
subprocess.run(['sed', '-i', '',
    's/com\\.pklmedialab\\.News-Distiller\\.Extension/com.pklmedialab.news-distiller.extension/g',
    PBXPROJ], check=True)
subprocess.run(['sed', '-i', '',
    's/com\\.pklmedialab\\.News-Distiller/com.pklmedialab.news-distiller/g',
    PBXPROJ], check=True)
subprocess.run(['sed', '-i', '',
    's/CODE_SIGN_STYLE = Automatic;/CODE_SIGN_STYLE = Manual;/g',
    PBXPROJ], check=True)

# Step 2: Inject PROVISIONING_PROFILE_SPECIFIER, DEVELOPMENT_TEAM, CODE_SIGN_IDENTITY per target
with open(PBXPROJ, "r") as f:
    content = f.read()

# Remove existing entries we'll re-add
content = re.sub(r'\s*PROVISIONING_PROFILE_SPECIFIER = "[^"]*";', '', content)
content = re.sub(r'\s*DEVELOPMENT_TEAM = [^;]*;', '', content)

def add_signing_settings(match):
    block = match.group(0)
    if 'com.pklmedialab.news-distiller.extension' in block:
        return block.replace(
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";',
            f'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";\n\t\t\t\tDEVELOPMENT_TEAM = {TEAM_ID};\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Extension-Distribution";'
        )
    elif 'com.pklmedialab.news-distiller' in block:
        return block.replace(
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";',
            f'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";\n\t\t\t\tDEVELOPMENT_TEAM = {TEAM_ID};\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Distribution";'
        )
    return block

content = re.sub(r'\{[^{}]*PRODUCT_BUNDLE_IDENTIFIER[^{}]*\}',
                 add_signing_settings, content, flags=re.DOTALL)

# Step 3: Set minimum deployment target
content = content.replace('IPHONEOS_DEPLOYMENT_TARGET = 15.0;', 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;')
content = content.replace('IPHONEOS_DEPLOYMENT_TARGET = 15;', 'IPHONEOS_DEPLOYMENT_TARGET = 16;')

with open(PBXPROJ, "w") as f:
    f.write(content)

print("Done patching pbxproj")
result = subprocess.run(
    ['grep', '-E', 'PRODUCT_BUNDLE_IDENTIFIER|PROVISIONING_PROFILE_SPECIFIER|DEVELOPMENT_TEAM', PBXPROJ],
    capture_output=True, text=True)
print(result.stdout)
