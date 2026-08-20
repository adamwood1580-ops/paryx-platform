(function () {
    "use strict";

    const loaderScript = document.currentScript;

    if (!loaderScript) {
        console.error(
            "Paryx Console loader could not identify its script element."
        );
        return;
    }

    const PAGE_SCRIPTS = {
        dashboard: "../js/pages/dashboard-page.js",
        clubs: "../js/pages/clubs-page.js",
        platformusers: "../js/pages/platform-users-page.js",
        audit: "../js/pages/audit-page.js"
    };

    function pageName() {
        return String(
            document.body.dataset.page || ""
        )
            .trim()
            .toLowerCase();
    }

    async function loadVersion() {
        try {
            const response =
                await fetch(
                    "../json/app-version.json",
                    { cache: "no-store" }
                );

            if (!response.ok) {
                return "console-dev";
            }

            const payload =
                await response.json();

            return (
                String(payload?.version || "")
                    .trim() ||
                "console-dev"
            );
        } catch (error) {
            return "console-dev";
        }
    }

    function loadScript(source, version) {
        return new Promise(function (resolve, reject) {
            const url =
                new URL(
                    source,
                    document.baseURI
                );

            if (version) {
                url.searchParams.set(
                    "v",
                    version
                );
            }

            const script =
                document.createElement(
                    "script"
                );

            script.src =
                url.href;

            script.async =
                false;

            script.addEventListener(
                "load",
                resolve,
                { once: true }
            );

            script.addEventListener(
                "error",
                function () {
                    reject(
                        new Error(
                            `Could not load ${source}`
                        )
                    );
                },
                { once: true }
            );

            document.head.appendChild(script);
        });
    }

    async function initialise() {
        try {
            const version =
                await loadVersion();

            window.PARYX_CONSOLE_ASSET_VERSION =
                version;

            await loadScript(
                "../../club/js/core/config.js",
                version
            );

            if (!window.supabase) {
                await loadScript(
                    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
                    null
                );
            }

            await loadScript(
                "../../club/js/core/supabase.js",
                version
            );

            await loadScript(
                "../js/core/console-boot.js",
                version
            );

            await loadScript(
                "../js/ui/console-shell.js",
                version
            );

            const pageScript =
                PAGE_SCRIPTS[pageName()];

            if (pageScript) {
                await loadScript(
                    pageScript,
                    version
                );
            }
        } catch (error) {
            console.error(
                "Paryx Console failed to load:",
                error
            );

            document.documentElement
                .classList
                .add("console-ready");

            const main =
                document.querySelector("main");

            if (main) {
                const element =
                    document.createElement("div");

                element.className =
                    "console-error";

                element.textContent =
                    "Paryx Console could not load. Refresh and try again.";

                main.prepend(element);
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialise,
            { once: true }
        );
    } else {
        initialise();
    }
})();
