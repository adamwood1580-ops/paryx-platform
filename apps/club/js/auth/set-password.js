(function () {
    "use strict";

    const form =
        document.getElementById("setPasswordForm");

    const newPassword =
        document.getElementById("newPassword");

    const confirmPassword =
        document.getElementById("confirmPassword");

    const newPasswordToggle =
        document.getElementById("newPasswordToggle");

    const confirmPasswordToggle =
        document.getElementById("confirmPasswordToggle");

    const submitButton =
        document.getElementById("setPasswordButton");

    const message =
        document.getElementById("setPasswordMessage");

    if (
        !form ||
        !newPassword ||
        !confirmPassword ||
        !newPasswordToggle ||
        !confirmPasswordToggle ||
        !submitButton ||
        !message
    ) {
        console.error(
            "Set-password page elements are missing."
        );

        return;
    }

    let inviteSessionReady = false;
    let isSaving = false;

    function showMessage(text, type) {
        message.textContent = text;

        message.className =
            `auth-message auth-message--${type} is-visible`;
    }

    function clearMessage() {
        message.textContent = "";
        message.className = "auth-message";
    }

    function updateSubmitState() {
        submitButton.disabled =
            isSaving ||
            !inviteSessionReady;

        submitButton.textContent =
            isSaving
                ? "Saving password…"
                : "Set password";
    }

    function setInviteReady(value) {
        inviteSessionReady =
            value === true;

        updateSubmitState();
    }

    function setSaving(value) {
        isSaving =
            value === true;

        updateSubmitState();
    }

    function configurePasswordToggle(
        button,
        input
    ) {
        button.addEventListener(
            "click",
            function () {
                const isVisible =
                    input.type === "text";

                input.type =
                    isVisible
                        ? "password"
                        : "text";

                button.textContent =
                    isVisible
                        ? "Show"
                        : "Hide";

                button.setAttribute(
                    "aria-pressed",
                    String(!isVisible)
                );
            }
        );
    }

    function validatePasswords() {
        if (newPassword.value.length < 8) {
            showMessage(
                "Your password must contain at least 8 characters.",
                "error"
            );

            newPassword.focus();

            return false;
        }

        if (
            newPassword.value !==
            confirmPassword.value
        ) {
            showMessage(
                "The passwords do not match.",
                "error"
            );

            confirmPassword.focus();

            return false;
        }

        return true;
    }

    function getHashParameters() {
        const hash =
            window.location.hash.startsWith("#")
                ? window.location.hash.slice(1)
                : window.location.hash;

        return new URLSearchParams(hash);
    }

    function clearAuthParameters() {
        const url =
            new URL(window.location.href);

        [
            "token_hash",
            "type",
            "error",
            "error_code",
            "error_description"
        ].forEach(function (name) {
            url.searchParams.delete(name);
        });

        url.hash = "";

        window.history.replaceState(
            {},
            document.title,
            `${url.pathname}${url.search}`
        );
    }

    function getAuthError() {
        const query =
            new URLSearchParams(
                window.location.search
            );

        const hash =
            getHashParameters();

        return (
            query.get("error_description") ||
            hash.get("error_description") ||
            query.get("error") ||
            hash.get("error") ||
            ""
        );
    }

    async function createInviteSession() {
        setInviteReady(false);

        if (!window.supabaseClient) {
            showMessage(
                "The account service is unavailable. Refresh and try again.",
                "error"
            );

            return;
        }

        const authError =
            getAuthError();

        if (authError) {
            showMessage(
                decodeURIComponent(
                    authError.replace(/\+/g, " ")
                ),
                "error"
            );

            return;
        }

        const query =
            new URLSearchParams(
                window.location.search
            );

        const tokenHash =
            query.get("token_hash");

        const type =
            query.get("type");

        /*
         * Preferred Paryx invite flow.
         *
         * The customised Supabase email template links
         * directly to this page with token_hash and
         * type=invite. verifyOtp creates the authenticated
         * invite session in the browser.
         */
        if (
            tokenHash &&
            type === "invite"
        ) {
            try {
                const {
                    data,
                    error
                } =
                    await window.supabaseClient
                        .auth
                        .verifyOtp({
                            token_hash:
                                tokenHash,
                            type: "invite"
                        });

                if (
                    error ||
                    !data?.session
                ) {
                    throw (
                        error ||
                        new Error(
                            "No invitation session was created."
                        )
                    );
                }

                clearAuthParameters();
                clearMessage();
                setInviteReady(true);

                return;
            } catch (error) {
                console.error(
                    "Paryx invite verification error:",
                    error
                );

                showMessage(
                    error?.message ||
                        "This invitation link is invalid or has expired. Ask the club to send a new invitation.",
                    "error"
                );

                return;
            }
        }

        /*
         * Compatibility path for Supabase's standard
         * confirmation redirect, which may return an
         * access_token and refresh_token in the URL hash.
         */
        const hash =
            getHashParameters();

        const accessToken =
            hash.get("access_token");

        const refreshToken =
            hash.get("refresh_token");

        if (
            accessToken &&
            refreshToken
        ) {
            try {
                const {
                    data,
                    error
                } =
                    await window.supabaseClient
                        .auth
                        .setSession({
                            access_token:
                                accessToken,
                            refresh_token:
                                refreshToken
                        });

                if (
                    error ||
                    !data?.session
                ) {
                    throw (
                        error ||
                        new Error(
                            "No invitation session was created."
                        )
                    );
                }

                clearAuthParameters();
                clearMessage();
                setInviteReady(true);

                return;
            } catch (error) {
                console.error(
                    "Paryx invite session error:",
                    error
                );

                showMessage(
                    error?.message ||
                        "This invitation link is invalid or has expired. Ask the club to send a new invitation.",
                    "error"
                );

                return;
            }
        }

        /*
         * Final fallback: the browser may already have
         * received/persisted the invite session.
         */
        try {
            const {
                data,
                error
            } =
                await window.supabaseClient
                    .auth
                    .getSession();

            if (
                error ||
                !data?.session
            ) {
                showMessage(
                    "This invitation link could not be verified. Please use the newest invitation email or ask the club to send another invite.",
                    "error"
                );

                return;
            }

            clearMessage();
            setInviteReady(true);
        } catch (error) {
            console.error(
                "Paryx invite session check error:",
                error
            );

            showMessage(
                "This invitation link could not be verified. Please use the newest invitation email or ask the club to send another invite.",
                "error"
            );
        }
    }

    configurePasswordToggle(
        newPasswordToggle,
        newPassword
    );

    configurePasswordToggle(
        confirmPasswordToggle,
        confirmPassword
    );

    setInviteReady(false);

    form.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();
            clearMessage();

            if (!inviteSessionReady) {
                showMessage(
                    "Your invitation has not been verified yet.",
                    "error"
                );

                return;
            }

            if (!validatePasswords()) {
                return;
            }

            if (!window.supabaseClient) {
                showMessage(
                    "The account service is unavailable. Refresh and try again.",
                    "error"
                );

                return;
            }

            setSaving(true);

            try {
                const {
                    error
                } =
                    await window.supabaseClient
                        .auth
                        .updateUser({
                            password:
                                newPassword.value
                        });

                if (error) {
                    throw error;
                }

                await window.supabaseClient
                    .auth
                    .signOut();

                showMessage(
                    "Password saved. Opening Paryx…",
                    "success"
                );

                window.setTimeout(
                    function () {
                        window.location.href =
                            "login.html";
                    },
                    900
                );
            } catch (error) {
                console.error(
                    "Password update error:",
                    error
                );

                showMessage(
                    error?.message ||
                        "We could not save your password. Request a new invitation and try again.",
                    "error"
                );
            } finally {
                setSaving(false);
            }
        }
    );

    createInviteSession();
})();
