import re
import subprocess

PBXPROJ = "build/News-Distiller/News-Distiller.xcodeproj/project.pbxproj"

# Step 1: Fix bundle ID case using sed
subprocess.run(['sed', '-i', '',
    's/com\\.pklmedialab\\.News-Distiller\\.Extension/com.pklmedialab.news-distiller.extension/g',
    PBXPROJ], check=True)
subprocess.run(['sed', '-i', '',
    's/com\\.pklmedialab\\.News-Distiller/com.pklmedialab.news-distiller/g',
    PBXPROJ], check=True)
subprocess.run(['sed', '-i', '',
    's/CODE_SIGN_STYLE = Automatic;/CODE_SIGN_STYLE = Manual;/g',
    PBXPROJ], check=True)

# Step 2: Use Python to inject correct PROVISIONING_PROFILE_SPECIFIER per target
with open(PBXPROJ, "r") as f:
    content = f.read()

# Remove any existing PROVISIONING_PROFILE_SPECIFIER entries
content = re.sub(r'\s*PROVISIONING_PROFILE_SPECIFIER = "[^"]*";', '', content)

def add_profile_specifier(match):
    block = match.group(0)
    if 'com.pklmedialab.news-distiller.extension' in block:
        return block.replace(
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";',
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Extension-Distribution";'
        )
    elif 'com.pklmedialab.news-distiller' in block:
        return block.replace(
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";',
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Distribution";'
        )
    return block

content = re.sub(r'\{[^{}]*PRODUCT_BUNDLE_IDENTIFIER[^{}]*\}',
                 add_profile_specifier, content, flags=re.DOTALL)

with open(PBXPROJ, "w") as f:
    f.write(content)

# Print results for debugging
result = subprocess.run(['grep', 'PRODUCT_BUNDLE_IDENTIFIER\|PROVISIONING_PROFILE_SPECIFIER', PBXPROJ],
                       capture_output=True, text=True)
print(result.stdout)
print("Done patching pbxproj")
