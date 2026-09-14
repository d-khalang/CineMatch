package com.cinematch.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;

@RunWith(AndroidJUnit4.class)
public class CredentialVaultInstrumentedTest {

    private Context context;
    private CredentialVault vault;

    @Before
    public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        vault = new CredentialVault(context);
        try {
            vault.resetAll();
        } catch (Exception ignored) {
        }
    }

    @After
    public void tearDown() throws Exception {
        try {
            vault.resetAll();
        } catch (Exception ignored) {
        }
    }

    @Test
    public void testRoundTripEncryptionDecryption() throws Exception {
        // 1. Initial state: absent vault returns null credentials and default rememberEnabled = true
        CredentialVault.ReadResult initial = vault.read();
        assertNull(initial.credentials);
        assertTrue(initial.rememberEnabled);

        // 2. Write valid credentials
        CredentialVault.StoredCredentials original = new CredentialVault.StoredCredentials(
                "read_access_token",
                "test-tmdb-token-xyz-12345",
                "test-gemini-key-abc",
                "test-openrouter-key-def"
        );
        vault.write(original);

        // 3. Read back with new vault instance (simulating fresh launch)
        CredentialVault freshVault = new CredentialVault(context);
        CredentialVault.ReadResult result = freshVault.read();

        assertNotNull(result.credentials);
        assertTrue(result.rememberEnabled);
        assertEquals("read_access_token", result.credentials.tmdbType);
        assertEquals("test-tmdb-token-xyz-12345", result.credentials.tmdbValue);
        assertEquals("test-gemini-key-abc", result.credentials.geminiApiKey);
        assertEquals("test-openrouter-key-def", result.credentials.openRouterApiKey);
    }

    @Test
    public void testDifferentIvAndCiphertextForRepeatedSaves() throws Exception {
        CredentialVault.StoredCredentials creds = new CredentialVault.StoredCredentials(
                "api_key",
                "same-key-value",
                "same-gemini-value",
                ""
        );

        vault.write(creds);
        File vaultFile = new File(context.getNoBackupFilesDir(), "credentials_v1.enc");
        assertTrue(vaultFile.exists());

        byte[] firstWriteBytes = readAllBytes(vaultFile);

        // Re-write identical credentials
        vault.write(creds);
        byte[] secondWriteBytes = readAllBytes(vaultFile);

        // The whole encrypted file bytes must differ because of fresh random IV
        assertFalse("Repeated writes of identical data must produce different ciphertext/IV",
                Arrays.equals(firstWriteBytes, secondWriteBytes));
    }

    @Test
    public void testTamperedCiphertextAndTagRejected() throws Exception {
        CredentialVault.StoredCredentials creds = new CredentialVault.StoredCredentials(
                "read_access_token",
                "sensitive-token",
                "gemini-key",
                ""
        );
        vault.write(creds);

        File vaultFile = new File(context.getNoBackupFilesDir(), "credentials_v1.enc");
        byte[] originalBytes = readAllBytes(vaultFile);

        // Tamper with last byte (part of the 128-bit authentication tag)
        originalBytes[originalBytes.length - 1] ^= 0x01;
        writeAllBytes(vaultFile, originalBytes);

        try {
            vault.read();
            fail("Tampered ciphertext/tag must fail AEAD authentication and throw VaultException");
        } catch (CredentialVault.VaultException e) {
            assertEquals("READ_FAILED", e.getCode());
        }
    }

    @Test
    public void testTamperedHeaderOrVersionRejected() throws Exception {
        CredentialVault.StoredCredentials creds = new CredentialVault.StoredCredentials(
                "read_access_token", "token-val", "", ""
        );
        vault.write(creds);

        File vaultFile = new File(context.getNoBackupFilesDir(), "credentials_v1.enc");
        byte[] originalBytes = readAllBytes(vaultFile);

        // Corrupt magic header (first byte)
        originalBytes[0] = (byte) 'X';
        writeAllBytes(vaultFile, originalBytes);

        try {
            vault.read();
            fail("Corrupted envelope magic header must throw INVALID_DATA");
        } catch (CredentialVault.VaultException e) {
            assertEquals("INVALID_DATA", e.getCode());
        }
    }

    @Test
    public void testMissingKeyForExistingFileReportsKeyUnavailable() throws Exception {
        CredentialVault.StoredCredentials creds = new CredentialVault.StoredCredentials(
                "read_access_token", "test-token", "", ""
        );
        vault.write(creds);

        // Delete Keystore key entry while preserving file
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        ks.deleteEntry("com.cinematch.app.credentials.v1");

        try {
            vault.read();
            fail("Reading existing file with missing Keystore key must throw KEY_UNAVAILABLE");
        } catch (CredentialVault.VaultException e) {
            assertEquals("KEY_UNAVAILABLE", e.getCode());
        }
    }

    @Test
    public void testClearIdempotencyAndRemoval() throws Exception {
        CredentialVault.StoredCredentials creds = new CredentialVault.StoredCredentials(
                "read_access_token", "val1", "val2", "val3"
        );
        vault.write(creds);

        File vaultFile = new File(context.getNoBackupFilesDir(), "credentials_v1.enc");
        assertTrue(vaultFile.exists());

        // First clear
        vault.clear();
        assertFalse(vaultFile.exists());

        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        assertFalse(ks.containsAlias("com.cinematch.app.credentials.v1"));

        // Second clear must succeed idempotently
        vault.clear();

        // Preference remains preserved
        assertTrue(vault.read().rememberEnabled);
        assertNull(vault.read().credentials);
    }

    @Test
    public void testSetRememberEnabledPreferenceLifecycle() throws Exception {
        // Initially default true
        assertTrue(vault.read().rememberEnabled);

        // Write credentials while true
        vault.write(new CredentialVault.StoredCredentials("read_access_token", "val1", "", ""));
        assertNotNull(vault.read().credentials);

        // Disabling remember removes saved credentials and persists preference false
        vault.setRememberEnabled(false);
        CredentialVault.ReadResult resDisabled = vault.read();
        assertFalse(resDisabled.rememberEnabled);
        assertNull(resDisabled.credentials);

        // Re-enabling remembers preference true
        vault.setRememberEnabled(true);
        CredentialVault.ReadResult resEnabled = vault.read();
        assertTrue(resEnabled.rememberEnabled);
        assertNull(resEnabled.credentials);
    }

    @Test
    public void testEmptySnapshotClearsVault() throws Exception {
        vault.write(new CredentialVault.StoredCredentials("read_access_token", "val1", "val2", ""));
        assertNotNull(vault.read().credentials);

        // Empty credentials write
        vault.write(new CredentialVault.StoredCredentials("read_access_token", "", "", ""));
        assertNull(vault.read().credentials);
    }

    private static byte[] readAllBytes(File file) throws Exception {
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] buf = new byte[(int) file.length()];
            int read = 0;
            while (read < buf.length) {
                int r = fis.read(buf, read, buf.length - read);
                if (r < 0) break;
                read += r;
            }
            return buf;
        }
    }

    private static void writeAllBytes(File file, byte[] bytes) throws Exception {
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(bytes);
            fos.flush();
        }
    }
}
