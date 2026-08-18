(function () {
    "use strict";

    /* =========================================================
       PARYX APPLICATION BOOTSTRAP
       ========================================================= */

    const SUPABASE_LIBRARY =
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

    const LOGIN_PAGE =
        "login.html";

    const SESSION_TIMEOUT_MS =
        30 * 60 * 1000;

    const LAST_ACTIVITY_KEY =
        "paryx_last_activity";

    const STARTUP_PROFILE_ATTEMPTS =
        3;

    const STARTUP_PROFILE_RETRY_MS =
        350;

    window.Paryx =
        window.Paryx || {};

    let isInitialising =
        false;

    let isReady =
        false;

    let isRedirecting =
        false;

    let isSigningOut =
        false;

    let inactivityInterval =
        null;

    let lastRecordedActivity =
        0;

    let resolveReady;
    let rejectReady;

    /*
     * Page-specific scripts can use:
     *
     * window.Paryx.ready.then(function ({ user, profile }) {
     *     // Application is ready.
     * });
     */
    window.Paryx.ready =
        new Promise(function (
            resolve,
            reject
        ) {
            resolveReady =
                resolve;

            rejectReady =
                reject;
        });

    /* =========================================================
       GENERAL HELPERS
       ========================================================= */

    function wait(milliseconds) {
        return new Promise(function (
            resolve
        ) {
            window.setTimeout(
                resolve,
                milliseconds
            );
        });
    }

    function getReadableError(error) {
        if (!error) {
            return "An unknown error occurred.";
        }

        if (
            typeof error.message ===
            "string" &&
            error.message.trim()
        ) {
            return error.message;
        }

        if (
            typeof error.details ===
            "string" &&
            error.details.trim()
        ) {
            return error.details;
        }

        return String(error);
    }

    function isMissingSessionError(error) {
        const name =
            error?.name || "";

        const message =
            error?.message || "";

        return (
            name ===
                "AuthSessionMissingError" ||
            message ===
                "Auth session missing!" ||
            message ===
                "No authenticated user was found."
        );
    }

    /* =========================================================
       VERSIONED DEPENDENCIES
       ========================================================= */

    function getAssetVersion() {
        const version =
            typeof window
                .PARYX_ASSET_VERSION ===
                "string"
                ? window
                    .PARYX_ASSET_VERSION
                    .trim()
                : "";

        return version || null;
    }

    function buildVersionedUrl(
        source
    ) {
        const url =
            new URL(
                source,
                document.baseURI
            );

        const version =
            getAssetVersion();

        if (version) {
            url.searchParams.set(
                "v",
                version
            );
        }

        return url.href;
    }

    const CONFIG_SCRIPT =
        buildVersionedUrl(
            "../js/core/config.js"
        );

    const SUPABASE_SCRIPT =
        buildVersionedUrl(
            "../js/core/supabase.js"
        );

    const PROFILE_SCRIPT =
        buildVersionedUrl(
            "../js/core/profile.js"
        );

    /* =========================================================
       DEPENDENCY LOADING
       ========================================================= */

    function getCanonicalScriptUrl(
        source
    ) {
        return new URL(
            source,
            document.baseURI
        ).href;
    }

    function findExistingScript(
        source
    ) {
        const targetUrl =
            getCanonicalScriptUrl(
                source
            );

        return (
            Array.from(
                document.scripts
            ).find(function (
                script
            ) {
                return (
                    script.src ===
                    targetUrl
                );
            }) ||
            null
        );
    }

    function loadScript(
        source,
        readyCheck
    ) {
        return new Promise(function (
            resolve,
            reject
        ) {
            if (
                typeof readyCheck ===
                    "function" &&
                readyCheck()
            ) {
                resolve();
                return;
            }

            const existingScript =
                findExistingScript(
                    source
                );

            if (existingScript) {
                const handleExistingLoad =
                    function () {
                        if (
                            typeof readyCheck !==
                                "function" ||
                            readyCheck()
                        ) {
                            resolve();
                            return;
                        }

                        reject(
                            new Error(
                                `Script loaded but did not initialise: ${source}`
                            )
                        );
                    };

                if (
                    existingScript
                        .dataset
                        .paryxLoaded ===
                    "true"
                ) {
                    handleExistingLoad();
                    return;
                }

                if (
                    typeof readyCheck ===
                        "function" &&
                    readyCheck()
                ) {
                    resolve();
                    return;
                }

                existingScript
                    .addEventListener(
                        "load",
                        handleExistingLoad,
                        {
                            once: true
                        }
                    );

                existingScript
                    .addEventListener(
                        "error",
                        function () {
                            reject(
                                new Error(
                                    `Could not load script: ${source}`
                                )
                            );
                        },
                        {
                            once: true
                        }
                    );

                return;
            }

            const script =
                document.createElement(
                    "script"
                );

            script.src =
                source;

            script.async =
                false;

            script.dataset
                .paryxDependency =
                "true";

            script.addEventListener(
                "load",
                function () {
                    script.dataset
                        .paryxLoaded =
                        "true";

                    if (
                        typeof readyCheck ===
                            "function" &&
                        !readyCheck()
                    ) {
                        reject(
                            new Error(
                                `Script loaded but did not initialise: ${source}`
                            )
                        );

                        return;
                    }

                    resolve();
                },
                {
                    once: true
                }
            );

            script.addEventListener(
                "error",
                function () {
                    reject(
                        new Error(
                            `Could not load script: ${source}`
                        )
                    );
                },
                {
                    once: true
                }
            );

            document.head
                .appendChild(
                    script
                );
        });
    }

    async function loadDependencies() {
        await loadScript(
            SUPABASE_LIBRARY,
            function () {
                return Boolean(
                    window.supabase
                );
            }
        );

        await loadScript(
            CONFIG_SCRIPT
        );

        await loadScript(
            SUPABASE_SCRIPT,
            function () {
                return Boolean(
                    window
                        .supabaseClient
                );
            }
        );

        await loadScript(
            PROFILE_SCRIPT,
            function () {
                return Boolean(
                    window.Paryx
                        .profile &&
                    typeof window
                        .Paryx
                        .profile
                        .load ===
                        "function"
                );
            }
        );
    }

    /* =========================================================
       AUTHENTICATION
       ========================================================= */

    function getSupabaseClient() {
        if (
            !window
                .supabaseClient
        ) {
            throw new Error(
                "Supabase client is unavailable."
            );
        }

        return window
            .supabaseClient;
    }

    function getCurrentPage() {
        return (
            window.location
                .pathname
                .split("/")
                .pop() ||
            "index.html"
        );
    }

    function buildReturnTo() {
        return (
            `${getCurrentPage()}` +
            `${window.location.search}`
        );
    }

    function redirectToLogin(
        reason = ""
    ) {
        if (isRedirecting) {
            return;
        }

        isRedirecting =
            true;

        const parameters =
            new URLSearchParams();

        parameters.set(
            "returnTo",
            buildReturnTo()
        );

        if (reason) {
            parameters.set(
                "reason",
                reason
            );
        }

        window.location
            .replace(
                `${LOGIN_PAGE}?${parameters.toString()}`
            );
    }

    async function getAuthenticatedUser() {
        const client =
            getSupabaseClient();

        const {
            data: sessionData,
            error: sessionError
        } =
            await client
                .auth
                .getSession();

        if (sessionError) {
            throw sessionError;
        }

        if (
            !sessionData
                ?.session
        ) {
            return null;
        }

        const {
            data: userData,
            error: userError
        } =
            await client
                .auth
                .getUser();

        if (userError) {
            if (
                isMissingSessionError(
                    userError
                )
            ) {
                return null;
            }

            throw userError;
        }

        return (
            userData
                ?.user ||
            null
        );
    }

    /* =========================================================
       STARTUP PROFILE RETRY
       ========================================================= */

    async function loadStartupProfile(
        user
    ) {
        if (
            !window.Paryx
                .profile ||
            typeof window.Paryx
                .profile
                .load !==
                "function"
        ) {
            throw new Error(
                "The Paryx profile service is unavailable."
            );
        }

        let lastError =
            null;

        for (
            let attempt = 1;
            attempt <=
                STARTUP_PROFILE_ATTEMPTS;
            attempt += 1
        ) {
            try {
                const profile =
                    await window
                        .Paryx
                        .profile
                        .load({
                            forceRefresh:
                                true
                        });

                if (
                    profile?.userId &&
                    profile.userId !==
                        user.id
                ) {
                    throw new Error(
                        "The loaded profile does not belong to the authenticated user."
                    );
                }

                return profile;
            } catch (error) {
                lastError =
                    error;

                console.warn(
                    `Paryx profile startup attempt ${attempt} of ${STARTUP_PROFILE_ATTEMPTS} failed:`,
                    error
                );

                if (
                    isMissingSessionError(
                        error
                    )
                ) {
                    throw error;
                }

                if (
                    attempt <
                    STARTUP_PROFILE_ATTEMPTS
                ) {
                    /*
                     * The delay increases slightly with each
                     * retry, allowing the new Supabase session
                     * and related database requests to settle.
                     */
                    await wait(
                        STARTUP_PROFILE_RETRY_MS *
                            attempt
                    );
                }
            }
        }

        throw (
            lastError ||
            new Error(
                "Paryx could not load your account information."
            )
        );
    }

    /* =========================================================
       INACTIVITY TIMEOUT
       ========================================================= */

    function readLastActivity() {
        try {
            const value =
                Number(
                    window
                        .localStorage
                        .getItem(
                            LAST_ACTIVITY_KEY
                        )
                );

            if (
                !Number.isFinite(
                    value
                ) ||
                value <= 0
            ) {
                return null;
            }

            return value;
        } catch (error) {
            console.warn(
                "Could not read Paryx activity time:",
                error
            );

            return null;
        }
    }

    function saveLastActivity(
        timestamp
    ) {
        try {
            window
                .localStorage
                .setItem(
                    LAST_ACTIVITY_KEY,
                    String(
                        timestamp
                    )
                );
        } catch (error) {
            console.warn(
                "Could not save Paryx activity time:",
                error
            );
        }
    }

    function clearLastActivity() {
        try {
            window
                .localStorage
                .removeItem(
                    LAST_ACTIVITY_KEY
                );
        } catch (error) {
            console.warn(
                "Could not clear Paryx activity time:",
                error
            );
        }
    }

    function recordActivity() {
        const now =
            Date.now();

        if (
            now -
                lastRecordedActivity <
            1000
        ) {
            return;
        }

        lastRecordedActivity =
            now;

        saveLastActivity(
            now
        );
    }

    function sessionHasTimedOut() {
        const lastActivity =
            readLastActivity();

        if (
            lastActivity ===
            null
        ) {
            return false;
        }

        return (
            Date.now() -
                lastActivity >=
            SESSION_TIMEOUT_MS
        );
    }

    function clearApplicationData() {
        if (
            window.Paryx
                .profile &&
            typeof window.Paryx
                .profile
                .clearCache ===
                "function"
        ) {
            window.Paryx
                .profile
                .clearCache();
        }

        if (
            window.Paryx
                .booking &&
            typeof window.Paryx
                .booking
                .clearCache ===
                "function"
        ) {
            window.Paryx
                .booking
                .clearCache();
        }

        window.Paryx.user =
            null;

        window.Paryx
            .currentProfile =
            null;

        window.paryxUser =
            null;

        window.paryxProfile =
            null;
    }

    async function signOutForInactivity() {
        if (isSigningOut) {
            return;
        }

        isSigningOut =
            true;

        try {
            const client =
                getSupabaseClient();

            await client
                .auth
                .signOut({
                    scope: "local"
                });
        } catch (error) {
            console.error(
                "Paryx inactivity sign-out failed:",
                error
            );
        } finally {
            clearLastActivity();
            clearApplicationData();
            redirectToLogin(
                "timeout"
            );
        }
    }

    async function checkInactivity() {
        if (
            isRedirecting ||
            isSigningOut
        ) {
            return;
        }

        if (
            sessionHasTimedOut()
        ) {
            await signOutForInactivity();
        }
    }

    function startInactivityTracking() {
        recordActivity();

        [
            "pointerdown",
            "keydown",
            "touchstart",
            "scroll"
        ].forEach(function (
            eventName
        ) {
            window.addEventListener(
                eventName,
                recordActivity,
                {
                    passive: true
                }
            );
        });

        document.addEventListener(
            "visibilitychange",
            function () {
                if (
                    document
                        .visibilityState ===
                    "visible"
                ) {
                    checkInactivity();
                }
            }
        );

        window.addEventListener(
            "pageshow",
            checkInactivity
        );

        inactivityInterval =
            window.setInterval(
                checkInactivity,
                15000
            );
    }

    /* =========================================================
       APPLICATION READY STATE
       ========================================================= */

    function exposeApplicationData(
        user,
        profile
    ) {
        window.Paryx.user =
            user;

        window.Paryx
            .currentProfile =
            profile;

        /*
         * Temporary aliases for older scripts.
         */
        window.paryxUser =
            user;

        window.paryxProfile =
            profile;
    }

    function revealApplication() {
        document
            .documentElement
            .classList
            .add(
                "auth-ready"
            );
    }

    function dispatchReady(
        user,
        profile
    ) {
        const detail = {
            user,
            profile,
            version:
                getAssetVersion()
        };

        isReady =
            true;

        exposeApplicationData(
            user,
            profile
        );

        revealApplication();

        resolveReady(
            detail
        );

        document.dispatchEvent(
            new CustomEvent(
                "paryx:ready",
                {
                    detail
                }
            )
        );
    }

    function dispatchError(
        error
    ) {
        const normalisedError =
            error instanceof Error
                ? error
                : new Error(
                    String(
                        error
                    )
                );

        const detail = {
            message:
                normalisedError
                    .message ||
                "Paryx could not load your account information.",

            code:
                error &&
                typeof error ===
                    "object"
                    ? error.code ||
                        null
                    : null,

            details:
                error &&
                typeof error ===
                    "object"
                    ? error.details ||
                        null
                    : null,

            hint:
                error &&
                typeof error ===
                    "object"
                    ? error.hint ||
                        null
                    : null,

            error:
                normalisedError
        };

        revealApplication();

        rejectReady(
            normalisedError
        );

        document.dispatchEvent(
            new CustomEvent(
                "paryx:error",
                {
                    detail
                }
            )
        );
    }

    /* =========================================================
       STARTUP
       ========================================================= */

    async function initialiseParyx() {
        if (
            isInitialising ||
            isReady ||
            isRedirecting
        ) {
            return;
        }

        isInitialising =
            true;

        try {
            await loadDependencies();

            const user =
                await getAuthenticatedUser();

            if (!user) {
                redirectToLogin();
                return;
            }

            if (
                sessionHasTimedOut()
            ) {
                await signOutForInactivity();
                return;
            }

            /*
             * A newly created session can occasionally become
             * available slightly before all related profile
             * requests are ready. Retry the complete validated
             * profile load silently before exposing an error.
             */
            const profile =
                await loadStartupProfile(
                    user
                );

            startInactivityTracking();

            dispatchReady(
                user,
                profile
            );
        } catch (error) {
            console.error(
                "Paryx startup failed:",
                error
            );

            if (
                isMissingSessionError(
                    error
                )
            ) {
                clearApplicationData();
                redirectToLogin();
                return;
            }

            console.error(
                "Paryx startup detail:",
                getReadableError(
                    error
                )
            );

            dispatchError(
                error
            );
        } finally {
            isInitialising =
                false;
        }
    }

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initialiseParyx,
            {
                once: true
            }
        );
    } else {
        initialiseParyx();
    }

    window.addEventListener(
        "beforeunload",
        function () {
            if (
                inactivityInterval
            ) {
                window.clearInterval(
                    inactivityInterval
                );
            }
        }
    );
})();