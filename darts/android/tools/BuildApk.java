import com.reandroid.arsc.chunk.PackageBlock;
import com.reandroid.arsc.chunk.TableBlock;
import com.reandroid.arsc.chunk.xml.AndroidManifestBlock;
import com.reandroid.arsc.chunk.xml.ResXmlAttribute;
import com.reandroid.arsc.chunk.xml.ResXmlElement;
import com.reandroid.arsc.value.Entry;
import com.reandroid.arsc.value.ValueType;

import java.io.File;

/**
 * Génère AndroidManifest.xml (XML binaire) et resources.arsc sans le SDK Google,
 * en s'appuyant uniquement sur ARSCLib.
 *
 *   java -cp arsclib.jar:. BuildApk <dossier de sortie>
 */
public class BuildApk {

    // identifiants d'attributs du framework Android (android.R.attr)
    private static final int ATTR_LABEL = 0x01010001;
    private static final int ATTR_ICON = 0x01010002;
    private static final int ATTR_EXPORTED = 0x01010010;
    private static final int ATTR_CONFIG_CHANGES = 0x0101001f;
    private static final int ATTR_ALLOW_BACKUP = 0x01010280;
    private static final int ATTR_SUPPORTS_RTL = 0x010103af;
    private static final int ATTR_HW_ACCELERATED = 0x010102d3;

    // orientation | keyboardHidden | screenLayout | screenSize | smallestScreenSize | density
    private static final int CONFIG_CHANGES = 0x0080 | 0x0020 | 0x0100 | 0x0400 | 0x0800 | 0x1000;

    private static final String PACKAGE = "fr.macplay.darts301";
    private static final String ACTIVITY = PACKAGE + ".MainActivity";
    private static final String LABEL = "301 Fléchettes";
    private static final String ICON_PATH = "res/mipmap/ic_launcher.png";

    public static void main(String[] args) throws Exception {
        File outDir = new File(args[0]);
        int versionCode = Integer.parseInt(args[1]);
        String versionName = args[2];
        outDir.mkdirs();

        // --- resources.arsc : une seule entrée, l'icône du lanceur ---
        TableBlock table = new TableBlock();
        PackageBlock pkg = table.newPackage(0x7f, PACKAGE);
        Entry icon = pkg.getOrCreate("", "mipmap", "ic_launcher");
        icon.setValueAsString(ICON_PATH);
        int iconId = icon.getResourceId();
        table.refreshFull();
        table.writeBytes(new File(outDir, "resources.arsc"));

        // --- AndroidManifest.xml ---
        AndroidManifestBlock manifest = new AndroidManifestBlock();
        manifest.setPackageName(PACKAGE);
        manifest.setVersionCode(versionCode);
        manifest.setVersionName(versionName);
        manifest.setCompileSdkVersion(34);
        manifest.setCompileSdkVersionCodename("14");
        manifest.setMinSdkVersion(24);   // Android 7.0 : minimum pour une signature v2 seule
        manifest.setTargetSdkVersion(34); // Android 14

        ResXmlElement application = manifest.getOrCreateApplicationElement();
        manifest.setApplicationLabel(LABEL);
        setBool(application, "allowBackup", ATTR_ALLOW_BACKUP, true);
        setBool(application, "supportsRtl", ATTR_SUPPORTS_RTL, true);
        setBool(application, "hardwareAccelerated", ATTR_HW_ACCELERATED, true);
        setRef(application, "icon", ATTR_ICON, iconId);

        ResXmlElement activity = manifest.getOrCreateMainActivity(ACTIVITY);
        setBool(activity, "exported", ATTR_EXPORTED, true); // obligatoire dès Android 12
        setHex(activity, "configChanges", ATTR_CONFIG_CHANGES, CONFIG_CHANGES);
        activity.getOrCreateAndroidAttribute("label", ATTR_LABEL).setValueAsString(LABEL);

        manifest.refreshFull();
        manifest.writeBytes(new File(outDir, "AndroidManifest.xml"));

        System.out.println("manifeste + resources.arsc écrits (icône = 0x"
                + Integer.toHexString(iconId) + ")");
    }

    private static void setBool(ResXmlElement el, String name, int id, boolean value) {
        el.getOrCreateAndroidAttribute(name, id).setValueAsBoolean(value);
    }

    private static void setRef(ResXmlElement el, String name, int id, int resourceId) {
        ResXmlAttribute attr = el.getOrCreateAndroidAttribute(name, id);
        attr.setValueType(ValueType.REFERENCE);
        attr.setData(resourceId);
    }

    private static void setHex(ResXmlElement el, String name, int id, int value) {
        ResXmlAttribute attr = el.getOrCreateAndroidAttribute(name, id);
        attr.setValueType(ValueType.HEX);
        attr.setData(value);
    }
}
