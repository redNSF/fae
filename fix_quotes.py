#!/usr/bin/env python3
"""Fix FAE.jsx - repair line 603 broken string."""

path = r'c:\Users\riyad\OneDrive\Documents\GitHub\fae\FAE.jsx'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Line 603 (index 602) is currently broken:
# log("Done! " + result.layerCount + " layer(s) in "" + result.compName + "".");
# Two consecutive "" pairs break the string parsing in ExtendScript.
# Fix: use single quotes around the comp name so no escaping is needed.
broken  = '        log("Done! " + result.layerCount + " layer(s) in "" + result.compName + "".");\n'
fixed_l = '        log("Done! " + result.layerCount + " layer(s) in \'" + result.compName + "\'.");\n'

if lines[602] == broken:
    lines[602] = fixed_l
    print("Fixed line 603.")
else:
    print("Line 603 did not match expected broken content.")
    print("Actual:", repr(lines[602]))

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

# Verify
with open(path, 'r', encoding='utf-8') as f:
    verify = f.readlines()
print("Line 603 now:", repr(verify[602].rstrip()))
