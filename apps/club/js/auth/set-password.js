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

    function showMessage(text, type) {
        message.textContent = text;

        message.className =
            `auth-message auth-message--${type} is-visible`;
    }

    function clearMessage() {
        message.textContent = "";
        message.className = "auth-message";
    }

    function setLoading(isLoading) {
        submitButton.disabled =
            isLoading ||
            !inviteSessionReady;

        submitButton.textContent =
            isLoading
                ? "Saving password…"
                : "Set password";
    }

    function setInviteReady(isReady) {
        inviteSessionReady = isReady;
        submitButton.disabled = !isReady;
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

    function cleanInviteUrl() {
        const url =
            new URL(window.location.href);

        url.searchParams.delete(
            "token_hash"
        );

        url.searchParams.delete(
            "type"
        );

        window.history.replaceState(
            {},
            document.title,
            `${url.pathname}${url.search}${url.hash}`
        );
    }

    async function confirmInviteSession() {
        setInviteReady(false);

        if (!window.supabaseClient) {
            showMessage(
                "The account service is unavailable. Refresh and try again.",
                "error"
            );

            return;
        }

        const parameters =
            new URLSearchParams(
                window.location.search
            );

        const tokenHash =
            parameters.get(
                "token_hash"
            );

        const type =
            parameters.get(
                "type"
            );

        /*
         * Preferred Paryx invite flow:
         *
         * The Supabase invite email links directly to this
         * page with token_hash + type=invite.
         *
         * The browser then verifies the token using
         * supabase-js, which automatically sends the
         * project's publishable API key.
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

                cleanInviteUrl();
                clearMessage();
                setInviteReady(true);

                return;
            } catch (error) {
                console.error(
                    "Paryx invitation verification error:",
                    error
                );

                showMessage(
                    "This invitation link is invalid or has expired. Ask the club to send a new invitation.",
                    "error"
                );

                return;
            }
        }

        /*
         * Backwards-compatible fallback for older Supabase
         * invitation links that arrive with an established
         * browser session.
         */
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
                "This invitation link is invalid or has expired. Ask the club to send a new invitation.",
                "error"
            );

            return;
        }

        clearMessage();
        setInviteReady(true);
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

            setLoading(true);

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

                /*
                 * End the temporary invite session so the
                 * member proves the new password on the
                 * next login.
                 */
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
                    error.message ||
                        "We could not save your password. Request a new invitation and try again.",
                    "error"
                );
            } finally {
                if (
                    document.visibilityState !==
                    "hidden"
                ) {
                    setLoading(false);
                }
            }
        }
    );

    confirmInviteSession();
})();