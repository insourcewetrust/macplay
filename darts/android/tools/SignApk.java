import com.android.apksig.ApkSigner;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

/**
 * Signe l'APK avec l'APK Signature Scheme v2, celui qu'exige Android 11+.
 *
 * La signature v1 (JAR) est volontairement désactivée : l'apksig publié sur Maven
 * Central s'appuie sur des API internes du JDK supprimées depuis, et le v2 seul
 * impose Android 7.0 minimum — ce que déclare aussi le manifeste. En prime, sans
 * v1 aucune entrée META-INF n'est insérée et l'alignement de resources.arsc reste
 * intact.
 *
 *   java -cp apksig.jar:. SignApk <keystore> <motdepasse> <alias> <entrée> <sortie>
 */
public class SignApk {

    public static void main(String[] args) throws Exception {
        File store = new File(args[0]);
        char[] password = args[1].toCharArray();
        String alias = args[2];
        File in = new File(args[3]);
        File out = new File(args[4]);

        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try (FileInputStream fis = new FileInputStream(store)) {
            keyStore.load(fis, password);
        }
        if (alias == null || alias.isEmpty()) {
            Enumeration<String> aliases = keyStore.aliases();
            alias = aliases.hasMoreElements() ? aliases.nextElement() : null;
        }
        PrivateKey key = (PrivateKey) keyStore.getKey(alias, password);
        java.security.cert.Certificate[] chain = keyStore.getCertificateChain(alias);
        List<X509Certificate> certs = new ArrayList<>();
        for (java.security.cert.Certificate c : chain) {
            certs.add((X509Certificate) c);
        }

        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder(
                "301", key, certs).build();

        new ApkSigner.Builder(Collections.singletonList(signer))
                .setInputApk(in)
                .setOutputApk(out)
                .setV1SigningEnabled(false)
                .setV2SigningEnabled(true)
                .setMinSdkVersion(24)
                .build()
                .sign();

        System.out.println("APK signé : " + out.getAbsolutePath()
                + " (" + (out.length() / 1024) + " Ko)");
    }
}
