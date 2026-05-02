import re, subprocess

PBXPROJ = "build/News-Distiller/News-Distiller.xcodeproj/project.pbxproj"
TEAM_ID = "4FPWPSM7JG"

with open(PBXPROJ, "r") as f:
    content = f.read()

# Fix all bundle ID case variants
content = re.sub(r'com\.pklmedialab\.news-distiller\.Extension', 'com.pklmedialab.news-distiller.extension', content)
content = re.sub(r'com\.pklmedialab\.News-Distiller\.Extension', 'com.pklmedialab.news-distiller.extension', content)
content = re.sub(r'com\.pklmedialab\.News-Distiller\b', 'com.pklmedialab.news-distiller', content)
content = content.replace('CODE_SIGN_STYLE = Automatic;', 'CODE_SIGN_STYLE = Manual;')

# Remove existing signing entries
content = re.sub(r'\s*PROVISIONING_PROFILE_SPECIFIER = [^;]*;', '', content)
content = re.sub(r'\s*DEVELOPMENT_TEAM = [^;]*;', '', content)

# Add signing per XCBuildConfiguration block
def patch_config(match):
    block = match.group(0)
    if 'com.pklmedialab.news-distiller.extension' in block:
        return block.replace(
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";',
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";\n\t\t\t\tDEVELOPMENT_TEAM = ' + TEAM_ID + ';\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Extension-Distribution";'
        )
    elif '"com.pklmedialab.news-distiller"' in block:
        return block.replace(
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";',
            'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";\n\t\t\t\tDEVELOPMENT_TEAM = ' + TEAM_ID + ';\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Distribution";'
        )
    return block

content = re.sub(r'\{[^{}]*isa = XCBuildConfiguration[^{}]*\}', patch_config, content, flags=re.DOTALL)
content = re.sub(r'IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;', 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;', content)

with open(PBXPROJ, "w") as f:
    f.write(content)

result = subprocess.run(['grep', '-c', 'News-Distiller-Extension-Distribution', PBXPROJ], capture_output=True, text=True)
print("Extension profile injections:", result.stdout.strip())
result2 = subprocess.run(['grep', '-c', 'News-Distiller-Distribution', PBXPROJ], capture_output=True, text=True)
print("Main app profile injections:", result2.stdout.strip())
