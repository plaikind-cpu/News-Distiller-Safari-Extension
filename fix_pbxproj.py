import re, subprocess, time
PBXPROJ = "build/News-Distiller/News-Distiller.xcodeproj/project.pbxproj"
TEAM_ID = "4FPWPSM7JG"
BUILD_NUM = str(int(time.time()))
f = open(PBXPROJ, "r")
content = f.read()
f.close()
content = re.sub(r'com\.pklmedialab\.news-distiller\.Extension', 'com.pklmedialab.news-distiller.extension', content)
content = re.sub(r'com\.pklmedialab\.News-Distiller\.Extension', 'com.pklmedialab.news-distiller.extension', content)
content = re.sub(r'com\.pklmedialab\.News-Distiller\b', 'com.pklmedialab.news-distiller', content)
content = content.replace('CODE_SIGN_STYLE = Automatic;', 'CODE_SIGN_STYLE = Manual;')
content = re.sub(r'\s*PROVISIONING_PROFILE_SPECIFIER = [^;]*;', '', content)
content = re.sub(r'\s*DEVELOPMENT_TEAM = [^;]*;', '', content)
content = re.sub(r'CURRENT_PROJECT_VERSION = [^;]*;', 'CURRENT_PROJECT_VERSION = ' + BUILD_NUM + ';', content)
content = re.sub(r'MARKETING_VERSION = [^;]*;', 'MARKETING_VERSION = 1.1;', content)
EXT_BUNDLE = 'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller.extension";'
EXT_REPLACE = EXT_BUNDLE + '\n\t\t\t\tDEVELOPMENT_TEAM = ' + TEAM_ID + ';\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Extension-Distribution";'
APP_BUNDLE = 'PRODUCT_BUNDLE_IDENTIFIER = "com.pklmedialab.news-distiller";'
APP_REPLACE = APP_BUNDLE + '\n\t\t\t\tDEVELOPMENT_TEAM = ' + TEAM_ID + ';\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "News-Distiller-Distribution";'
content = content.replace(EXT_BUNDLE, EXT_REPLACE)
content = content.replace(APP_BUNDLE, APP_REPLACE)
content = re.sub(r'IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;', 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;', content)
f = open(PBXPROJ, "w")
f.write(content)
f.close()
print("Build number:", BUILD_NUM)
print("Extension profiles:", content.count('News-Distiller-Extension-Distribution'))
print("Main app profiles:", content.count('News-Distiller-Distribution') - content.count('News-Distiller-Extension-Distribution'))
