package com.cinematch.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "CredentialVault")
public class CredentialVaultPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private CredentialVault vault;

    @Override
    public void load() {
        super.load();
        this.vault = new CredentialVault(getContext());
    }

    @PluginMethod
    public void read(PluginCall call) {
        executor.execute(() -> {
            try {
                CredentialVault.ReadResult result = vault.read();
                JSObject ret = new JSObject();
                ret.put("rememberEnabled", result.rememberEnabled);

                if (result.credentials != null) {
                    JSObject creds = new JSObject();
                    creds.put("tmdbType", result.credentials.tmdbType);
                    creds.put("tmdbValue", result.credentials.tmdbValue);
                    creds.put("geminiApiKey", result.credentials.geminiApiKey);
                    creds.put("openRouterApiKey", result.credentials.openRouterApiKey);
                    ret.put("credentials", creds);
                } else {
                    ret.put("credentials", JSONObject.NULL);
                }

                call.resolve(ret);
            } catch (CredentialVault.VaultException e) {
                call.reject(e.getMessage(), e.getCode());
            } catch (Exception e) {
                call.reject("Read operation failed", "READ_FAILED");
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (!call.getData().has("credentials")) {
            call.reject("Missing credentials parameter", "INVALID_DATA");
            return;
        }

        JSObject credsObj = call.getObject("credentials");
        if (credsObj == null) {
            call.reject("Invalid credentials parameter", "INVALID_DATA");
            return;
        }

        // Validate that no unexpected extra fields are present in credentials
        Iterator<String> keys = credsObj.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!key.equals("tmdbType") && !key.equals("tmdbValue") &&
                !key.equals("geminiApiKey") && !key.equals("openRouterApiKey")) {
                call.reject("Unexpected field in credentials snapshot", "INVALID_DATA");
                return;
            }
        }

        String tmdbType = credsObj.optString("tmdbType", "read_access_token");
        String tmdbValue = credsObj.optString("tmdbValue", "");
        String geminiApiKey = credsObj.optString("geminiApiKey", "");
        String openRouterApiKey = credsObj.optString("openRouterApiKey", "");

        if (!tmdbType.equals("read_access_token") && !tmdbType.equals("api_key")) {
            call.reject("Invalid TMDB credential type", "INVALID_DATA");
            return;
        }

        CredentialVault.StoredCredentials credentials = new CredentialVault.StoredCredentials(
                tmdbType, tmdbValue, geminiApiKey, openRouterApiKey
        );

        executor.execute(() -> {
            try {
                vault.write(credentials);
                call.resolve();
            } catch (CredentialVault.VaultException e) {
                call.reject(e.getMessage(), e.getCode());
            } catch (Exception e) {
                call.reject("Write operation failed", "WRITE_FAILED");
            }
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        executor.execute(() -> {
            try {
                vault.clear();
                call.resolve();
            } catch (CredentialVault.VaultException e) {
                call.reject(e.getMessage(), e.getCode());
            } catch (Exception e) {
                call.reject("Clear operation failed", "DELETE_FAILED");
            }
        });
    }

    @PluginMethod
    public void setRememberEnabled(PluginCall call) {
        if (!call.getData().has("enabled")) {
            call.reject("Missing enabled parameter", "INVALID_DATA");
            return;
        }

        boolean enabled = call.getBoolean("enabled", true);

        executor.execute(() -> {
            try {
                vault.setRememberEnabled(enabled);
                call.resolve();
            } catch (CredentialVault.VaultException e) {
                call.reject(e.getMessage(), e.getCode());
            } catch (Exception e) {
                call.reject("Failed to set remember preference", "WRITE_FAILED");
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
        super.handleOnDestroy();
    }
}
