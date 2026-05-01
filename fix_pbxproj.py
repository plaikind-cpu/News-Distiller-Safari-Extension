import re
import subprocess
import os

PBXPROJ = "build/News-Distiller/News-Distiller.xcodeproj/project.pbxproj"

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

# Step 2: Inject correct PROVISIONING_PROFILE_SPECIFIER per target
with open(PBXPROJ, "r") as f:
    content = f.read()

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

# Step 3: Add SKIP_INSTALL = NO and set signing for extension resources
# The key fix: add CODE_SIGNING_ALLOWED = YES for all web content
content = content.replace(
    'PROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Extension-Distribution";',
    'PROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Extension-Distribution";\n\t\t\t\tCODE_SIGNING_ALLOWED = YES;\n\t\t\t\tCODE_SIGNING_REQUIRED = YES;\n\t\t\t\tSKIP_INSTALL = NO;'
)

with open(PBXPROJ, "w") as f:
    f.write(content)

print("Done patching pbxproj")
result = subprocess.run(['grep', '-E', 'PRODUCT_BUNDLE_IDENTIFIER|PROVISIONING_PROFILE_SPECIFIER', PBXPROJ],
                       capture_output=True, text=True)
print(result.stdout)
