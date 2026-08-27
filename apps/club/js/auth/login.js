(function () {
    "use strict";

    /* =========================================================
       PARYX LOGIN
       ========================================================= */

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
         * Only allow a local relative destination.
         */
        if (
            returnTo &&
            !returnTo.startsWith("http://") &&
            !returnTo.startsWith("https://") &&
            !returnTo.startsWith("//")
        ) {
            return returnTo;
        }

        return "dashboard.html";
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
            "Your account does not have access to the Paryx staff workspace.",
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
                 * Redirect immediately.
                 *
                 * No success message, timeout or intermediate
                 * loading screen.
                 */
                openDestination();
            } catch (error) {
                console.error(
                    "Paryx login error:",
                    error
                );

                submissionInProgress =
                    false;

                setLoading(false);

                showMessage(
                    "The email address or password is incorrect.",
                    "error"
                );
            }
        }
    );
})();