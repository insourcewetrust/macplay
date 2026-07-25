#!/usr/bin/env python3
"""
Contrôle l'APK produit sans passer par le SDK Android.

Vérifie ce qu'Android vérifie au moment de l'installation : structure du zip,
resources.arsc non compressé et aligné, présence du bloc de signature v2,
et cohérence du manifeste (paquet, activité lançable, exported, SDK cibles).

    verify.py <apk>
"""

import struct
import sys
import zipfile

APK_SIG_BLOCK_MAGIC = b'APK Sig Block 42'
V2_SIGNATURE_ID = 0x7109871a


def fail(msg):
    print(f'  ✗ {msg}')
    return 1


def ok(msg):
    print(f'  ✓ {msg}')
    return 0


def local_data_offset(raw, header_offset):
    """Décale l'offset de l'en-tête local jusqu'au début des données."""
    name_len, extra_len = struct.unpack_from('<HH', raw, header_offset + 26)
    return header_offset + 30 + name_len + extra_len


def check_zip(path, raw):
    errors = 0
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        if zf.testzip() is not None:
            errors += fail('archive corrompue')
        for required in ('AndroidManifest.xml', 'classes.dex', 'resources.arsc'):
            if required not in names:
                errors += fail(f'{required} manquant')
        assets = [n for n in names if n.startswith('assets/')]
        errors += ok(f'{len(names)} entrées, dont {len(assets)} dans assets/')

        info = zf.getinfo('resources.arsc')
        if info.compress_type != zipfile.ZIP_STORED:
            errors += fail('resources.arsc est compressé (refusé dès targetSdk 30)')
        else:
            offset = local_data_offset(raw, info.header_offset)
            if offset % 4:
                errors += fail(f'resources.arsc mal aligné (offset {offset})')
            else:
                errors += ok(f'resources.arsc non compressé et aligné (offset {offset})')

        for entry in ('index.html', 'app.js', 'style.css',
                      'lib/darts.js', 'lib/match.js', 'lib/actions.js'):
            if f'assets/{entry}' not in names:
                errors += fail(f'assets/{entry} manquant')
        errors += ok('application web complète dans assets/')
    return errors


def check_signature(raw):
    """Cherche le bloc de signature APK v2 juste avant le central directory."""
    eocd = raw.rfind(b'PK\x05\x06')
    if eocd < 0:
        return fail('fin d’archive introuvable')
    cd_offset = struct.unpack_from('<I', raw, eocd + 16)[0]
    if raw[cd_offset - 16:cd_offset] != APK_SIG_BLOCK_MAGIC:
        return fail('aucun bloc de signature APK (v2) avant le central directory')

    size = struct.unpack_from('<Q', raw, cd_offset - 24)[0]
    start = cd_offset - size - 8
    pos = start + 8
    found = []
    while pos < cd_offset - 24:
        pair_len = struct.unpack_from('<Q', raw, pos)[0]
        if pair_len < 4 or pos + 8 + pair_len > cd_offset:
            break
        found.append(struct.unpack_from('<I', raw, pos + 8)[0])
        pos += 8 + pair_len
    if V2_SIGNATURE_ID not in found:
        return fail(f'bloc présent mais pas de signature v2 (ids {[hex(i) for i in found]})')
    return ok('signature APK v2 présente')


def check_manifest(path):
    try:
        from loguru import logger
        logger.remove()  # androguard est très bavard
        from androguard.core.apk import APK
    except ImportError:
        print('  · androguard absent : contrôle du manifeste et du dex ignoré')
        return 0
    apk = APK(path)
    errors = 0
    checks = [
        ('paquet', apk.get_package(), 'fr.macplay.darts301'),
        ('activité principale', apk.get_main_activity(), 'fr.macplay.darts301.MainActivity'),
        ('minSdk', apk.get_min_sdk_version(), '24'),
        ('targetSdk', apk.get_target_sdk_version(), '34'),
    ]
    for label, actual, expected in checks:
        if str(actual) != expected:
            errors += fail(f'{label} = {actual} (attendu {expected})')
        else:
            errors += ok(f'{label} = {actual}')

    axml = apk.get_android_manifest_axml().get_xml_obj()
    activity = axml.find('.//activity')
    ns = '{http://schemas.android.com/apk/res/android}'
    exported = activity.get(ns + 'exported') if activity is not None else None
    if exported not in ('true', '0xffffffff', '-1'):
        errors += fail(f'android:exported = {exported} (Android 12+ refuse l’installation sinon)')
    else:
        errors += ok('android:exported déclaré sur l’activité lançable')

    if not apk.get_app_icon():
        errors += fail('aucune icône déclarée')
    else:
        errors += ok(f'icône : {apk.get_app_icon()}')
    errors += ok(f'nom affiché : {apk.get_app_name()}')

    if apk.get_permissions():
        errors += fail(f'permissions demandées : {apk.get_permissions()}')
    else:
        errors += ok('aucune permission demandée')

    errors += check_dex(apk)
    return errors


def check_dex(apk):
    """L'activité doit exister dans classes.dex et piloter une WebView."""
    from androguard.core.dex import DEX
    errors = 0
    dex = DEX(apk.get_dex())
    classes = {c.get_name() for c in dex.get_classes()}
    expected = 'Lfr/macplay/darts301/MainActivity;'
    if expected not in classes:
        return fail(f'{expected} absent de classes.dex ({len(classes)} classes)')
    errors += ok(f'{expected} présent dans classes.dex')

    strings = set(dex.get_strings())
    if 'file:///android_asset/index.html' not in strings:
        errors += fail('l’URL de la page embarquée est absente du dex')
    else:
        errors += ok('l’activité charge file:///android_asset/index.html')
    return errors


def main():
    path = sys.argv[1]
    with open(path, 'rb') as fh:
        raw = fh.read()
    print(f'Vérification de {path} ({len(raw) // 1024} Ko)')
    errors = check_zip(path, raw) + check_signature(raw) + check_manifest(path)
    print()
    if errors:
        print(f'❌ {errors} problème(s)')
        return 1
    print('✅ APK conforme')
    return 0


if __name__ == '__main__':
    sys.exit(main())
