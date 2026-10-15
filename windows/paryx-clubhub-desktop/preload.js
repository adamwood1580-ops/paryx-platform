const {
    contextBridge
} = require("electron");

// Sandboxed preloads cannot require arbitrary local files.
const packageInfo = { version: "0.31.0" };

contextBridge.exposeInMainWorld(
    "ParyxDesktop",
    Object.freeze({
        isDesktop:
            true,
        version:
            packageInfo.version,
        inviteRedirectUrl:
            "paryx://auth/invite",
        recoveryRedirectUrl:
            "paryx://auth/recovery"
    })
);
