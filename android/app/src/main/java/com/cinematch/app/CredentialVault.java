package com.cinematch.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Android Keystore AES-256 GCM encrypted credential vault.
 * Stores credential snapshots in an app-private file under Context.getNoBackupFilesDir().
 * Uses AtomicFile for crash-safe platform atomic writes.
 */
public class CredentialVault {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "com.cinematch.app.credentials.v1";
    private static final String CIPHER_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final byte[] AAD_BYTES = "com.cinematch.app.credentials.v1".getBytes(StandardCharsets.UTF_8);

    private static final byte[] MAGIC = new byte[]{'C', 'M', 'C', 'V'};
    private static final byte ENVELOPE_VERSION = 1;
    private static final int SCHEMA_VERSION = 1;
    private static final int GCM_TAG_LENGTH_BITS = 128;
    private static final int GCM_IV_LENGTH_BYTES = 12;

    private static final int MAX_ENVELOPE_SIZE = 65536; // 64 KiB
    private static final int MAX_DECRYPTED_SIZE = 32768; // 32 KiB
    private static final int MAX_FIELD_SIZE = 8192; // 8 KiB

    private static final String VAULT_FILE_NAME = "credentials_v1.enc";
    private static final String PREFS_FILE_NAME = "vault_prefs_v1.json";

    private final Context context;
    private final File vaultFile;
    private final File prefsFile;

    public static class VaultException extends Exception {
        private final String code;

        public VaultException(String code, String message) {
            super(message);
            this.code = code;
        }

        public VaultException(String code, String message, Throwable cause) {
            super(message, cause);
            this.code = code;
        }

        public String getCode() {
            return code;
        }
    }

    public static class StoredCredentials {
        public final String tmdbType;
        public final String tmdbValue;
        public final String geminiApiKey;
        public final String openRouterApiKey;

        public StoredCredentials(String tmdbType, String tmdbValue, String geminiApiKey, String openRouterApiKey) {
            this.tmdbType = tmdbType != null ? tmdbType : "read_access_token";
            this.tmdbValue = tmdbValue != null ? tmdbValue : "";
            this.geminiApiKey = geminiApiKey != null ? geminiApiKey : "";
            this.openRouterApiKey = openRouterApiKey != null ? openRouterApiKey : "";
        }

        public boolean isEmpty() {
            return tmdbValue.isEmpty() && geminiApiKey.isEmpty() && openRouterApiKey.isEmpty();
        }
    }

    public static class ReadResult {
        public final StoredCredentials credentials;
        public final boolean rememberEnabled;

        public ReadResult(StoredCredentials credentials, boolean rememberEnabled) {
            this.credentials = credentials;
            this.rememberEnabled = rememberEnabled;
        }
    }

    public CredentialVault(Context context) {
        this.context = context.getApplicationContext();
        File noBackupDir = this.context.getNoBackupFilesDir();
        this.vaultFile = new File(noBackupDir, VAULT_FILE_NAME);
        this.prefsFile = new File(noBackupDir, PREFS_FILE_NAME);
    }

    /**
     * Reads the encrypted credential snapshot and the rememberEnabled preference.
     * Returns null for credentials if no vault file exists.
     */
    public synchronized ReadResult read() throws VaultException {
        boolean rememberEnabled = readRememberPreference();

        if (!vaultFile.exists()) {
            return new ReadResult(null, rememberEnabled);
        }

        // Bounded check on raw envelope file size before reading/allocating
        long fileLength = vaultFile.length();
        if (fileLength <= 0 || fileLength > MAX_ENVELOPE_SIZE) {
            throw new VaultException("INVALID_DATA", "Encrypted vault envelope size invalid or out of bounds");
        }

        byte[] envelopeBytes;
        try {
            AtomicFile atomicFile = new AtomicFile(vaultFile);
            envelopeBytes = atomicFile.readFully();
        } catch (IOException e) {
            throw new VaultException("READ_FAILED", "Failed to read encrypted vault file");
        }

        if (envelopeBytes.length > MAX_ENVELOPE_SIZE) {
            throw new VaultException("INVALID_DATA", "Envelope exceeds maximum allowable size");
        }

        // Envelope structure:
        // 4 bytes magic ('C','M','C','V')
        // 1 byte envelope version (1)
        // 1 byte IV length (12)
        // IV bytes
        // 4 bytes ciphertext length
        // ciphertext + tag bytes
        byte[] iv;
        byte[] ciphertext;
        try {
            DataInputStream dis = new DataInputStream(new java.io.ByteArrayInputStream(envelopeBytes));
            byte[] magic = new byte[4];
            dis.readFully(magic);
            if (!Arrays.equals(magic, MAGIC)) {
                throw new VaultException("INVALID_DATA", "Malformed vault envelope header");
            }

            byte envVer = dis.readByte();
            if (envVer != ENVELOPE_VERSION) {
                throw new VaultException("UNSUPPORTED_VERSION", "Unsupported envelope version: " + envVer);
            }

            int ivLen = dis.readByte() & 0xFF;
            if (ivLen != GCM_IV_LENGTH_BYTES) {
                throw new VaultException("INVALID_DATA", "Invalid IV length in envelope");
            }

            iv = new byte[ivLen];
            dis.readFully(iv);

            int cipherLen = dis.readInt();
            if (cipherLen <= 0 || cipherLen > MAX_ENVELOPE_SIZE) {
                throw new VaultException("INVALID_DATA", "Invalid ciphertext length in envelope");
            }

            ciphertext = new byte[cipherLen];
            dis.readFully(ciphertext);
        } catch (IOException e) {
            throw new VaultException("INVALID_DATA", "Malformed vault envelope structure");
        }

        // Keystore check: key must exist for existing encrypted file
        SecretKey secretKey = getExistingKey();
        if (secretKey == null) {
            throw new VaultException("KEY_UNAVAILABLE", "Stored Keystore key is missing or unavailable");
        }

        // Decrypt in memory
        byte[] decryptedBytes;
        try {
            Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
            GCMParameterSpec gcmSpec = new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, gcmSpec);
            cipher.updateAAD(AAD_BYTES);
            decryptedBytes = cipher.doFinal(ciphertext);
        } catch (javax.crypto.AEADBadTagException e) {
            throw new VaultException("READ_FAILED", "Authentication tag mismatch or tampered ciphertext");
        } catch (Exception e) {
            throw new VaultException("READ_FAILED", "Decryption failed");
        }

        if (decryptedBytes.length > MAX_DECRYPTED_SIZE) {
            throw new VaultException("INVALID_DATA", "Decrypted snapshot exceeds maximum permitted size");
        }

        // Parse and validate JSON schema
        StoredCredentials credentials = parseDecryptedJson(decryptedBytes);
        return new ReadResult(credentials, rememberEnabled);
    }

    /**
     * Atomically writes a credential snapshot to the encrypted vault.
     * If credentials are completely empty, clears the vault instead.
     */
    public synchronized void write(StoredCredentials credentials) throws VaultException {
        if (credentials == null || credentials.isEmpty()) {
            clearVaultFilesAndKey();
            return;
        }

        validateCredentials(credentials);

        // Build versioned JSON payload
        byte[] payloadBytes;
        try {
            JSONObject json = new JSONObject();
            json.put("version", SCHEMA_VERSION);
            json.put("tmdbType", credentials.tmdbType);
            json.put("tmdbValue", credentials.tmdbValue);
            json.put("geminiApiKey", credentials.geminiApiKey);
            json.put("openRouterApiKey", credentials.openRouterApiKey);
            payloadBytes = json.toString().getBytes(StandardCharsets.UTF_8);
        } catch (JSONException e) {
            throw new VaultException("INVALID_DATA", "Failed to serialize credentials snapshot");
        }

        if (payloadBytes.length > MAX_DECRYPTED_SIZE) {
            throw new VaultException("INVALID_DATA", "Credential payload exceeds maximum permitted size");
        }

        // Get or generate key
        SecretKey secretKey = getOrCreateKey();
        if (secretKey == null) {
            throw new VaultException("UNAVAILABLE", "Unable to access Android KeyStore for encryption");
        }

        // Encrypt in memory
        byte[] iv;
        byte[] ciphertext;
        try {
            Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, new SecureRandom());
            cipher.updateAAD(AAD_BYTES);
            ciphertext = cipher.doFinal(payloadBytes);
            iv = cipher.getIV();
            if (iv == null || iv.length != GCM_IV_LENGTH_BYTES) {
                throw new VaultException("WRITE_FAILED", "Invalid provider-generated IV");
            }
        } catch (VaultException e) {
            throw e;
        } catch (Exception e) {
            throw new VaultException("WRITE_FAILED", "Encryption failed");
        }

        // Assemble envelope in memory
        byte[] envelopeBytes;
        try {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            DataOutputStream dos = new DataOutputStream(baos);
            dos.write(MAGIC);
            dos.writeByte(ENVELOPE_VERSION);
            dos.writeByte(iv.length);
            dos.write(iv);
            dos.writeInt(ciphertext.length);
            dos.write(ciphertext);
            dos.flush();
            envelopeBytes = baos.toByteArray();
        } catch (IOException e) {
            throw new VaultException("WRITE_FAILED", "Failed to build envelope");
        }

        // Atomically write envelope bytes to disk
        AtomicFile atomicFile = new AtomicFile(vaultFile);
        FileOutputStream fos = null;
        try {
            fos = atomicFile.startWrite();
            fos.write(envelopeBytes);
            atomicFile.finishWrite(fos);
        } catch (IOException e) {
            if (fos != null) {
                atomicFile.failWrite(fos);
            }
            throw new VaultException("WRITE_FAILED", "Failed to atomically write encrypted vault file");
        }
    }

    /**
     * Clears persistent vault credentials and removes the Keystore entry.
     * Preserves the rememberEnabled preference.
     */
    public synchronized void clear() throws VaultException {
        clearVaultFilesAndKey();
    }

    /**
     * Updates the rememberEnabled preference.
     * When disabling (enabled == false), clears saved credentials first before persisting preference.
     */
    public synchronized void setRememberEnabled(boolean enabled) throws VaultException {
        if (!enabled) {
            // Must clear saved credentials first using serialized operations
            clearVaultFilesAndKey();
        }
        writeRememberPreference(enabled);
    }

    /**
     * Resets all vault data and resets remember preference to the default (true).
     * Used by Clear All Data.
     */
    public synchronized void resetAll() throws VaultException {
        clearVaultFilesAndKey();
        writeRememberPreference(true);
    }

    private void clearVaultFilesAndKey() throws VaultException {
        boolean fileSuccess = true;
        boolean keySuccess = true;

        // Clean vault file and AtomicFile backup/temp variants
        File noBackupDir = context.getNoBackupFilesDir();
        File bakFile = new File(noBackupDir, VAULT_FILE_NAME + ".bak");
        File newFile = new File(noBackupDir, VAULT_FILE_NAME + ".new");

        if (vaultFile.exists() && !vaultFile.delete()) {
            fileSuccess = false;
        }
        if (bakFile.exists() && !bakFile.delete()) {
            fileSuccess = false;
        }
        if (newFile.exists() && !newFile.delete()) {
            fileSuccess = false;
        }

        // Delete Keystore key
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS);
            }
        } catch (Exception e) {
            keySuccess = false;
        }

        if (!fileSuccess || !keySuccess) {
            throw new VaultException("DELETE_FAILED", "Failed to completely remove vault files or Keystore key");
        }
    }

    private boolean readRememberPreference() throws VaultException {
        if (!prefsFile.exists()) {
            // Default is true when absent (fresh install or upgrade without saved preference)
            return true;
        }

        try {
            AtomicFile atomicFile = new AtomicFile(prefsFile);
            byte[] bytes = atomicFile.readFully();
            String content = new String(bytes, StandardCharsets.UTF_8);
            JSONObject json = new JSONObject(content);
            if (!json.has("rememberEnabled")) {
                throw new VaultException("INVALID_DATA", "Preference metadata missing rememberEnabled field");
            }
            return json.getBoolean("rememberEnabled");
        } catch (VaultException e) {
            throw e;
        } catch (Exception e) {
            throw new VaultException("INVALID_DATA", "Failed to read or parse preference metadata");
        }
    }

    private void writeRememberPreference(boolean enabled) throws VaultException {
        AtomicFile atomicFile = new AtomicFile(prefsFile);
        FileOutputStream fos = null;
        try {
            JSONObject json = new JSONObject();
            json.put("rememberEnabled", enabled);
            byte[] bytes = json.toString().getBytes(StandardCharsets.UTF_8);

            fos = atomicFile.startWrite();
            fos.write(bytes);
            atomicFile.finishWrite(fos);
        } catch (Exception e) {
            if (fos != null) {
                atomicFile.failWrite(fos);
            }
            throw new VaultException("WRITE_FAILED", "Failed to write preference metadata");
        }
    }

    private SecretKey getExistingKey() throws VaultException {
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);
            if (!keyStore.containsAlias(KEY_ALIAS)) {
                return null;
            }
            KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
            return null;
        } catch (Exception e) {
            throw new VaultException("KEY_UNAVAILABLE", "Failed to access KeyStore entry");
        }
    }

    private SecretKey getOrCreateKey() throws VaultException {
        SecretKey existing = getExistingKey();
        if (existing != null) {
            return existing;
        }

        try {
            KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build();

            keyGenerator.init(spec);
            return keyGenerator.generateKey();
        } catch (Exception e) {
            throw new VaultException("UNAVAILABLE", "Failed to generate KeyStore AES key");
        }
    }

    private void validateCredentials(StoredCredentials credentials) throws VaultException {
        if (credentials.tmdbType != null &&
                !credentials.tmdbType.equals("read_access_token") &&
                !credentials.tmdbType.equals("api_key")) {
            throw new VaultException("INVALID_DATA", "Invalid TMDB credential type");
        }

        validateFieldBound("tmdbValue", credentials.tmdbValue);
        validateFieldBound("geminiApiKey", credentials.geminiApiKey);
        validateFieldBound("openRouterApiKey", credentials.openRouterApiKey);
    }

    private void validateFieldBound(String fieldName, String value) throws VaultException {
        if (value != null && value.getBytes(StandardCharsets.UTF_8).length > MAX_FIELD_SIZE) {
            throw new VaultException("INVALID_DATA", fieldName + " exceeds maximum permitted field size");
        }
    }

    private StoredCredentials parseDecryptedJson(byte[] decryptedBytes) throws VaultException {
        try {
            String jsonStr = new String(decryptedBytes, StandardCharsets.UTF_8);
            JSONObject json = new JSONObject(jsonStr);

            int version = json.optInt("version", -1);
            if (version != SCHEMA_VERSION) {
                throw new VaultException("UNSUPPORTED_VERSION", "Unsupported decrypted payload version: " + version);
            }

            String tmdbType = json.optString("tmdbType", "read_access_token");
            if (!tmdbType.equals("read_access_token") && !tmdbType.equals("api_key")) {
                throw new VaultException("INVALID_DATA", "Invalid TMDB credential type in payload");
            }

            String tmdbValue = json.optString("tmdbValue", "");
            String geminiApiKey = json.optString("geminiApiKey", "");
            String openRouterApiKey = json.optString("openRouterApiKey", "");

            validateFieldBound("tmdbValue", tmdbValue);
            validateFieldBound("geminiApiKey", geminiApiKey);
            validateFieldBound("openRouterApiKey", openRouterApiKey);

            return new StoredCredentials(tmdbType, tmdbValue, geminiApiKey, openRouterApiKey);
        } catch (JSONException e) {
            throw new VaultException("INVALID_DATA", "Invalid JSON in decrypted vault payload");
        }
    }
}
