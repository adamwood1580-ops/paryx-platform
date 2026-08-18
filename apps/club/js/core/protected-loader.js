(function () {
    "use strict";

    const loaderScript = document.currentScript;

    if (!loaderScript) {
        console.error("Paryx protected loader could not identify its script element.");
        return;
    }

    const SHARED_SCRIPTS = [
        "../js/ui/staff-shell.js"
    ];

    const PAGE_SCRIPTS = {
        dashboard: ["../js/pages/dashboard-page.js"],
        members: ["../js/pages/members-page.js"],
        importmembers: ["../js/pages/import-members-page.js"]
    };

    function pageName() {
        return String(document.body?.dataset?.page || "")
            .trim()
            .toLowerCase();
    }

    function versionUrl() {
        return new URL("../../json/app-version.json", loaderScript.src);
    }

    async function loadVersion() {
        const url = versionUrl();
        url.searchParams.set("cacheBust", String(Date.now()));
        const response = await fetch(url.href, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Could not load app-version.json (${response.status}).`);
        }
        const data = await response.json();
        const version = String(data?.version || "").trim();
        if (!version) throw new Error("app-version.json has no version.");
        return version;
    }

    function buildUrl(source, version) {
        const url = new URL(source, document.baseURI);
        url.searchParams.set("v", version);
        return url.href;
    }

    function loadScript(source, version) {
        return new Promise((resolve, reject) => {
            const url = buildUrl(source, version);
            const existing = Array.from(document.scripts).find((script) => script.src === url);
            if (existing?.dataset?.paryxLoaded === "true") {
                resolve();
                return;
            }
            const script = existing || document.createElement("script");
            if (!existing) {
                script.src = url;
                script.async = false;
                document.head.appendChild(script);
            }
            script.addEventListener("load", () => {
                script.dataset.paryxLoaded = "true";
                resolve();
            }, { once: true });
            script.addEventListener("error", () => reject(new Error(`Could not load ${source}.`)), { once: true });
        });
    }

    async function initialise() {
        try {
            const version = await loadVersion();
            window.PARYX_ASSET_VERSION = version;
            window.Paryx = window.Paryx || {};
            window.Paryx.assetVersion = version;
            window.Paryx.pageName = pageName();

            await loadScript("../js/core/boot.js", version);

            for (const source of SHARED_SCRIPTS.concat(PAGE_SCRIPTS[pageName()] || [])) {
                await loadScript(source, version);
            }
        } catch (error) {
            console.error("Paryx page loader failed:", error);
            document.documentElement.classList.add("auth-ready");
            const main = document.querySelector("main");
            if (main) {
                const message = document.createElement("div");
                message.className = "admin-error";
                message.textContent = "Paryx could not load this page. Refresh and try again.";
                main.prepend(message);
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialise, { once: true });
    } else {
        initialise();
    }
})();
