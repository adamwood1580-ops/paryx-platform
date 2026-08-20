(function () {
    "use strict";

    const SESSION_TIMEOUT_MS =
        30 * 60 * 1000;

    const LAST_ACTIVITY_KEY =
        "paryx_console_last_activity";

    window.ParyxConsole =
        window.ParyxConsole || {};

    let resolveReady;
    let rejectReady;

    window.ParyxConsole.ready =
        new Promise(function (resolve, reject) {
            resolveReady = resolve;
            rejectReady = reject;
        });

    function redirectToLogin(reason) {
        const url =
            new URL(
                "login.html",
                window.location.href
            );

        if (reason) {
            url.searchParams.set(
                "reason",
                reason
            );
        }

        window.location.replace(
            url.href
        );
    }

    function recordActivity() {
        try {
            window.localStorage.setItem(
                LAST_ACTIVITY_KEY,
                String(Date.now())
            );
        } catch (error) {
            // Local storage is a convenience, not a security boundary.
        }
    }

    function startInactivityGuard() {
        recordActivity();

        [
            "pointerdown",
            "keydown",
            "touchstart",
            "scroll"
        ].forEach(function (eventName) {
            window.addEventListener(
                eventName,
                recordActivity,
                { passive: true }
            );
        });

        window.setInterval(
            async function () {
                let last =
                    Date.now();

                try {
                    last =
                        Number(
                            window.localStorage.getItem(
                                LAST_ACTIVITY_KEY
                            )
                        ) || Date.now();
                } catch (error) {
                    return;
                }

                if (
                    Date.now() - last <
                    SESSION_TIMEOUT_MS
                ) {
                    return;
                }

                try {
                    await window.supabaseClient
                        ?.auth
                        ?.signOut();
                } finally {
                    redirectToLogin(
                        "timeout"
                    );
                }
            },
            60 * 1000
        );
    }

    async function initialise() {
        try {
            if (!window.supabaseClient) {
                throw new Error(
                    "Paryx data service unavailable."
                );
            }

            const {
                data: sessionData,
                error: sessionError
            } =
                await window.supabaseClient
                    .auth
                    .getSession();

            if (
                sessionError ||
                !sessionData?.session
            ) {
                redirectToLogin(
                    "auth"
                );
                return;
            }

            const {
                data,
                error
            } =
                await window.supabaseClient
                    .rpc(
                        "get_my_platform_access"
                    );

            if (error) {
                throw error;
            }

            const access =
                Array.isArray(data)
                    ? data[0]
                    : data;

            if (
                !access ||
                access.is_active !== true
            ) {
                redirectToLogin(
                    "access"
                );
                return;
            }

            const context = {
                user:
                    sessionData.session.user,

                access: {
                    userId:
                        access.user_id,

                    email:
                        access.email || "",

                    role:
                        access.role || "",

                    isActive:
                        access.is_active === true
                }
            };

            window.ParyxConsole.context =
                context;

            startInactivityGuard();

            document.documentElement
                .classList
                .add("console-ready");

            resolveReady(context);
        } catch (error) {
            console.error(
                "Paryx Console bootstrap failed:",
                error
            );

            document.documentElement
                .classList
                .add("console-ready");

            rejectReady(error);

            const main =
                document.querySelector("main");

            if (main) {
                const element =
                    document.createElement("div");

                element.className =
                    "console-error";

                element.textContent =
                    error?.message ||
                    "Paryx Console could not start.";

                main.prepend(element);
            }
        }
    }

    initialise();
})();
