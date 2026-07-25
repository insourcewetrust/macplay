#!/usr/bin/env python3
"""
Assemble l'APK non signé.

resources.arsc doit être stocké non compressé et aligné sur 4 octets : depuis
Android 11 le système le lit en mmap directement depuis l'archive.

    pack.py <dossier build> <dossier assets> <sortie.apk>
"""

import os
import sys
import zipfile

ALIGN = 4
# stockés sans compression (donc à aligner)
STORED = {'resources.arsc'}


def add(zf, arcname, data):
    store = arcname in STORED
    info = zipfile.ZipInfo(arcname, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    if store:
        offset = zf.fp.tell()
        header = 30 + len(arcname.encode('utf-8'))
        padding = -(offset + header) % ALIGN
        if padding:
            info.extra = b'\x00' * padding
    zf.writestr(info, data)


def main():
    build_dir, assets_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
    with zipfile.ZipFile(out, 'w') as zf:
        for name in ('AndroidManifest.xml', 'classes.dex', 'resources.arsc'):
            with open(os.path.join(build_dir, name), 'rb') as fh:
                add(zf, name, fh.read())

        icon = os.path.join(build_dir, 'ic_launcher.png')
        with open(icon, 'rb') as fh:
            add(zf, 'res/mipmap/ic_launcher.png', fh.read())

        count = 0
        for root, _dirs, files in os.walk(assets_dir):
            for name in sorted(files):
                path = os.path.join(root, name)
                rel = os.path.relpath(path, assets_dir).replace(os.sep, '/')
                with open(path, 'rb') as fh:
                    add(zf, f'assets/{rel}', fh.read())
                count += 1

    size = os.path.getsize(out) // 1024
    print(f'APK non signé : {out} ({size} Ko, {count} fichiers dans assets/)')


if __name__ == '__main__':
    main()
