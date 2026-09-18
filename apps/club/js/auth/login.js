(function () {
    "use strict";

    /* =========================================================
       PARYX LOGIN
       ========================================================= */

    const STAFF_ROLES =
        new Set([
            "starter",
            "reception",
            "professional",
            "greenkeeper",
            "manager",
            "club_admin"
        ]);

    const LAST_ACTIVITY_KEY =
        "paryx_last_activity";

    const form =
        document.getElementById("loginForm");

    const emailInput =
        document.getElementById("email");

    const passwordInput =
        document.getElementById("password");

    const passwordToggle =
        document.getElementById("passwordToggle");

    const loginButton =
        document.getElementById("loginButton");

    const loginButtonLabel =
        loginButton?.querySelector(
            ".auth-submit__label"
        ) || null;

    const message =
        document.getElementById("loginMessage");

    const forgotPassword =
        document.getElementById(
            "clubForgotPassword"
        );

    if (
        !form ||
        !emailInput ||
        !passwordInput ||
        !passwordToggle ||
        !loginButton ||
        !message
    ) {
        console.error(
            "Paryx login page elements are missing."
        );

        return;
    }

    let submissionInProgress =
        false;

    /* =========================================================
       MESSAGE
       ========================================================= */

    function showMessage(text, type) {
        message.textContent =
            text;

        message.className =
            `auth-message auth-message--${type} is-visible`;

        message.hidden =
            false;
    }

    function clearMessage() {
        message.textContent =
            "";

        message.className =
            "auth-message";

        message.hidden =
            true;
    }

    /* =========================================================
       LOADING STATE
       ========================================================= */

    function setLoading(isLoading) {
        loginButton.disabled =
            isLoading;

        loginButton.classList.toggle(
            "is-loading",
            isLoading
        );

        emailInput.disabled =
            isLoading;

        passwordInput.disabled =
            isLoading;

        passwordToggle.disabled =
            isLoading;

        if (loginButtonLabel) {
            loginButtonLabel.textContent =
                isLoading
                    ? "Signing in…"
                    : "Sign In";
        }
    }

    /* =========================================================
       VALIDATION
       ========================================================= */

    function validateForm() {
        const email =
            emailInput.value.trim();

        const password =
            passwordInput.value;

        if (!email) {
            showMessage(
                "Enter your email address.",
                "error"
            );

            emailInput.focus();

            return false;
        }

        if (!emailInput.validity.valid) {
            showMessage(
                "Enter a valid email address.",
                "error"
            );

            emailInput.focus();

            return false;
        }

        if (!password) {
            showMessage(
                "Enter your password.",
                "error"
            );

            passwordInput.focus();

            return false;
        }

        return true;
    }

    /* =========================================================
       STAFF ACCESS
       ========================================================= */

    function clearClubHubActivity() {
        try {
            window.localStorage.removeItem(
                LAST_ACTIVITY_KEY
            );
        } catch (error) {
            console.warn(
                "ClubHub could not clear the previous activity timestamp:",
                error
            );
        }
    }

    function recordClubHubActivity() {
        try {
            window.localStorage.setItem(
                LAST_ACTIVITY_KEY,
                String(
                    Date.now()
                )
            );
        } catch (error) {
            console.warn(
                "ClubHub could not save the current activity timestamp:",
                error
            );
        }
    }

    let selectedStaffAccess = null;

    const MODULE_ROUTES = {
        dashboard: "dashboard.html",
        tee_sheet: "tee-sheet.html",
        members: "members.html",
        member_credit: "club-credit.html",
        calendar: "calendar.html",
        competitions: "competitions.html",
        courses: "courses.html",
        stock_inventory: "stock.html",
        epos_integration: "epos.html",
        settings: "settings.html"
    };

    const ROLE_LANDING_MODULES = {
        starter: ["tee_sheet"],
        reception: ["tee_sheet", "competitions", "member_credit", "stock_inventory"],
        professional: ["tee_sheet", "competitions", "member_credit", "stock_inventory", "epos_integration"],
        greenkeeper: ["tee_sheet", "courses", "settings"],
        manager: ["dashboard", "tee_sheet"],
        club_admin: ["dashboard", "tee_sheet"]
    };

    async function resolveStaffAccess(userId) {
        const {
            data,
            error
        } =
            await window.supabaseClient
                .rpc(
                    "get_my_clubhub_access"
                );

        if (error) {
            throw error;
        }

        const rows =
            Array.isArray(data)
                ? data
                : [];

        const authorised = rows.filter(
            function (row) {
                const role =
                    String(
                        row?.staff_role ||
                        ""
                    )
                        .trim()
                        .toLowerCase();

                return STAFF_ROLES.has(
                    role
                );
            }
        );

        if (!authorised.length) {
            selectedStaffAccess = null;
            return [];
        }

        const storageKey =
            `paryx_active_club:${userId}`;

        let savedClubId = null;

        try {
            savedClubId =
                window.localStorage.getItem(
                    storageKey
                );
        } catch (error) {
            console.warn(
                "ClubHub could not read the saved club selection:",
                error
            );
        }

        const selected =
            authorised.find(function (row) {
                return row.club_id === savedClubId;
            }) ||
            authorised.find(function (row) {
                return row.is_primary === true;
            }) ||
            authorised[0];

        selectedStaffAccess = selected;

        try {
            window.localStorage.setItem(
                storageKey,
                selected.club_id
            );
        } catch (error) {
            console.warn(
                "ClubHub could not save the authorised club selection:",
                error
            );
        }

        return authorised;
    }

    /* =========================================================
       REDIRECT
       ========================================================= */

    function getDestination() {
        const parameters =
            new URLSearchParams(
                window.location.search
            );

        const returnTo =
            parameters.get("returnTo");

        /*
         * Only allow a local relative destination. The protected
         * shell will still enforce the role/module boundary if the
         * requested page is not available to this staff account.
         */
        if (
            returnTo &&
            !returnTo.startsWith("http://") &&
            !returnTo.startsWith("https://") &&
            !returnTo.startsWith("//")
        ) {
            return returnTo;
        }

        const role =
            String(
                selectedStaffAccess?.staff_role ||
                ""
            )
                .trim()
                .toLowerCase();

        const enabledModules = new Set(
            Array.isArray(
                selectedStaffAccess?.enabled_modules
            )
                ? selectedStaffAccess.enabled_modules
                : []
        );

        const preferredModules =
            ROLE_LANDING_MODULES[role] ||
            [];

        for (const moduleKey of preferredModules) {
            if (
                enabledModules.has(moduleKey) &&
                MODULE_ROUTES[moduleKey]
            ) {
                return MODULE_ROUTES[moduleKey];
            }
        }

        for (const moduleKey of enabledModules) {
            if (MODULE_ROUTES[moduleKey]) {
                return MODULE_ROUTES[moduleKey];
            }
        }

        return (
            MODULE_ROUTES[
                preferredModules[0]
            ] ||
            "dashboard.html"
        );
    }

    function openDestination() {
        window.location.replace(
            getDestination()
        );
    }

    /* =========================================================
       TIMEOUT MESSAGE
       ========================================================= */

    const pageParameters =
        new URLSearchParams(
            window.location.search
        );

    if (
        pageParameters.get("reason") ===
        "timeout"
    ) {
        showMessage(
            "You were signed out after 30 minutes of inactivity.",
            "error"
        );
    } else if (
        pageParameters.get("reason") ===
        "access"
    ) {
        showMessage(
            "ClubHub is available only to authorised club staff. Contact your club administrator if you require access.",
            "error"
        );
    } else if (
        pageParameters.get(
            "password_updated"
        ) === "1"
    ) {
        showMessage(
            "Your Paryx password has been updated. Sign in to ClubHub.",
            "success"
        );
    } else if (
        pageParameters.get(
            "activated"
        ) === "1"
    ) {
        showMessage(
            "Your Paryx account is active. Sign in to ClubHub.",
            "success"
        );
    } else {
        clearMessage();
    }

    /* =========================================================
       PASSWORD VISIBILITY
       ========================================================= */

    passwordToggle.addEventListener(
        "click",
        function () {
            const passwordIsVisible =
                passwordInput.type ===
                "text";

            passwordInput.type =
                passwordIsVisible
                    ? "password"
                    : "text";

            passwordToggle.setAttribute(
                "aria-label",
                passwordIsVisible
                    ? "Show password"
                    : "Hide password"
            );

            passwordToggle.setAttribute(
                "aria-pressed",
                String(
                    !passwordIsVisible
                )
            );
        }
    );

    /* =========================================================
       PASSWORD RECOVERY
       ========================================================= */

    if (forgotPassword) {
        forgotPassword.addEventListener(
            "click",
            async function () {
                clearMessage();

                const email =
                    emailInput.value.trim();

                if (!email) {
                    showMessage(
                        "Enter your email address first.",
                        "error"
                    );

                    emailInput.focus();
                    return;
                }

                if (
                    !emailInput.validity.valid
                ) {
                    showMessage(
                        "Enter a valid email address.",
                        "error"
                    );

                    emailInput.focus();
                    return;
                }

                if (!window.supabaseClient) {
                    showMessage(
                        "The password reset service is unavailable. Refresh and try again.",
                        "error"
                    );

                    return;
                }

                forgotPassword.disabled =
                    true;

                try {
                    const {
                        error
                    } =
                        await window.supabaseClient
                            .auth
                            .resetPasswordForEmail(
                                email,
                                {
                                    redirectTo:
                                        new URL(
                                            "set-password.html",
                                            window.location.href
                                        ).href
                                }
                            );

                    if (error) {
                        throw error;
                    }

                    showMessage(
                        "Password reset email sent. Open the newest email from Paryx.",
                        "success"
                    );
                } catch (error) {
                    console.error(
                        "ClubHub password reset error:",
                        error
                    );

                    showMessage(
                        error?.message ||
                        "We could not send the password reset email.",
                        "error"
                    );
                } finally {
                    forgotPassword.disabled =
                        false;
                }
            }
        );
    }

    /* =========================================================
       SUBMISSION
       ========================================================= */

    form.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();

            if (submissionInProgress) {
                return;
            }

            clearMessage();

            if (!validateForm()) {
                return;
            }

            if (!window.supabaseClient) {
                showMessage(
                    "The sign-in service is unavailable. Please refresh and try again.",
                    "error"
                );

                return;
            }

            submissionInProgress =
                true;

            setLoading(true);

            try {
                const email =
                    emailInput.value.trim();

                const password =
                    passwordInput.value;

                const {
                    data,
                    error
                } =
                    await window.supabaseClient
                        .auth
                        .signInWithPassword({
                            email,
                            password
                        });

                if (error) {
                    throw error;
                }

                if (!data.session) {
                    throw new Error(
                        "No active session was created."
                    );
                }

                /*
                 * Authentication is not enough for ClubHub.
                 *
                 * Confirm an active staff relationship BEFORE
                 * navigating to any protected ClubHub route.
                 */
                const authorisedClubs =
                    await resolveStaffAccess(
                        data.user.id
                    );

                if (!authorisedClubs.length) {
                    /*
                     * Do not let a stale ClubHub inactivity
                     * timestamp convert an access denial into
                     * a timeout if the Player later opens a
                     * protected ClubHub URL directly.
                     *
                     * The shared Paryx session is deliberately
                     * kept intact so rejecting ClubHub access
                     * does not sign the Player out of Paryx.
                     */
                    clearClubHubActivity();

                    submissionInProgress =
                        false;

                    setLoading(false);

                    showMessage(
                        "ClubHub is available only to authorised club staff. Contact your club administrator if you require access.",
                        "error"
                    );

                    return;
                }

                /*
                 * A valid staff sign-in starts a fresh ClubHub
                 * inactivity window. This prevents an old
                 * timestamp from immediately signing a newly
                 * authenticated staff user out.
                 */
                recordClubHubActivity();

                openDestination();
            } catch (error) {
                console.error(
                    "Paryx login error:",
                    error
                );

                submissionInProgress =
                    false;

                setLoading(false);

                const isCredentialError =
                    Boolean(
                        error?.status === 400 ||
                        error?.status === 422 ||
                        error?.code ===
                            "invalid_credentials"
                    );

                showMessage(
                    isCredentialError
                        ? "The email address or password is incorrect."
                        : "ClubHub could not verify staff access. Refresh and try again.",
                    "error"
                );
            }
        }
    );
})();
