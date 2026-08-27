(function () {
    "use strict";

    const form =
        document.getElementById(
            "memberSetPasswordForm"
        );

    const newPassword =
        document.getElementById(
            "newPassword"
        );

    const confirmPassword =
        document.getElementById(
            "confirmPassword"
        );

    const submitButton =
        document.getElementById(
            "setPasswordButton"
        );

    const message =
        document.getElementById(
            "setPasswordMessage"
        );

    const eyebrow =
        document.getElementById(
            "setPasswordEyebrow"
        );

    const subtitle =
        document.getElementById(
            "setPasswordSubtitle"
        );

    if (
        !form ||
        !newPassword ||
        !confirmPassword ||
        !submitButton ||
        !message
    ) {
        return;
    }

    let sessionReady =
        false;

    let saving =
        false;

    let flowType =
        "invite";

    function isRecovery() {
        return (
            flowType ===
            "recovery"
        );
    }

    function showMessage(
        text,
        type
    ) {
        message.textContent =
            text;

        message.className =
            `notice ${type || ""}`;

        message.hidden =
            false;
    }

    function clearMessage() {
        message.textContent =
            "";

        message.hidden =
            true;
    }

    function updateCopy() {
        document.title =
            isRecovery()
                ? "Reset Paryx Password"
                : "Activate Paryx Account";

        if (eyebrow) {
            eyebrow.textContent =
                isRecovery()
                    ? "Password reset"
                    : "Club invitation";
        }

        if (subtitle) {
            subtitle.textContent =
                isRecovery()
                    ? "Choose a new password for your Paryx account."
                    : "Your club has already created your Paryx account. Choose a password to activate it.";
        }
    }

    function updateButton() {
        submitButton.disabled =
            !sessionReady ||
            saving;

        if (saving) {
            submitButton.textContent =
                isRecovery()
                    ? "Saving…"
                    : "Activating…";

            return;
        }

        submitButton.textContent =
            isRecovery()
                ? "Save new password"
                : "Activate Paryx account";
    }

    function hashParameters() {
        return new URLSearchParams(
            window.location.hash
                .startsWith("#")
                ? window.location.hash
                    .slice(1)
                : window.location.hash
        );
    }

    function clearAuthParameters() {
        const url =
            new URL(
                window.location.href
            );

        [
            "token_hash",
            "type",
            "error",
            "error_code",
            "error_description"
        ].forEach(
            function (name) {
                url.searchParams
                    .delete(name);
            }
        );

        url.hash = "";

        window.history
            .replaceState(
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
            hashParameters();

        return (
            query.get(
                "error_description"
            ) ||
            hash.get(
                "error_description"
            ) ||
            query.get(
                "error"
            ) ||
            hash.get(
                "error"
            ) ||
            ""
        );
    }

    function detectFlowType() {
        const query =
            new URLSearchParams(
                window.location.search
            );

        const hash =
            hashParameters();

        const suppliedType =
            String(
                query.get("type") ||
                hash.get("type") ||
                ""
            ).toLowerCase();

        if (
            suppliedType ===
            "recovery"
        ) {
            flowType =
                "recovery";
        } else {
            flowType =
                "invite";
        }

        updateCopy();
        updateButton();
    }

    async function prepareSession() {
        sessionReady =
            false;

        detectFlowType();
        updateButton();

        const suppliedError =
            getAuthError();

        if (suppliedError) {
            showMessage(
                decodeURIComponent(
                    suppliedError
                        .replace(
                            /\+/g,
                            " "
                        )
                ),
                "error"
            );

            return;
        }

        if (!window.supabaseClient) {
            showMessage(
                "The Paryx account service is unavailable. Refresh and try again.",
                "error"
            );

            return;
        }

        const query =
            new URLSearchParams(
                window.location.search
            );

        const tokenHash =
            query.get(
                "token_hash"
            );

        const suppliedType =
            String(
                query.get("type") ||
                ""
            ).toLowerCase();

        if (
            tokenHash &&
            (
                suppliedType ===
                    "invite" ||
                suppliedType ===
                    "recovery"
            )
        ) {
            try {
                flowType =
                    suppliedType;

                updateCopy();

                const {
                    data,
                    error
                } =
                    await window
                        .supabaseClient
                        .auth
                        .verifyOtp({
                            token_hash:
                                tokenHash,
                            type:
                                suppliedType
                        });

                if (
                    error ||
                    !data?.session
                ) {
                    throw (
                        error ||
                        new Error(
                            "No authenticated session was created."
                        )
                    );
                }

                clearAuthParameters();
                clearMessage();

                sessionReady =
                    true;

                updateButton();

                return;
            } catch (error) {
                showMessage(
                    error?.message ||
                    (
                        isRecovery()
                            ? "This password reset link is invalid or has expired. Request another reset email."
                            : "This invitation is invalid or has expired. Ask the club to send another invitation."
                    ),
                    "error"
                );

                return;
            }
        }

        /*
         * Backward compatibility with older Supabase links
         * that return access/refresh tokens in the URL hash.
         */
        const hash =
            hashParameters();

        const hashType =
            String(
                hash.get("type") ||
                ""
            ).toLowerCase();

        if (
            hashType ===
            "recovery"
        ) {
            flowType =
                "recovery";

            updateCopy();
        }

        const accessToken =
            hash.get(
                "access_token"
            );

        const refreshToken =
            hash.get(
                "refresh_token"
            );

        if (
            accessToken &&
            refreshToken
        ) {
            try {
                const {
                    data,
                    error
                } =
                    await window
                        .supabaseClient
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
                            "No authenticated session was created."
                        )
                    );
                }

                clearAuthParameters();
                clearMessage();

                sessionReady =
                    true;

                updateButton();

                return;
            } catch (error) {
                showMessage(
                    error?.message ||
                    "This account link is invalid or has expired.",
                    "error"
                );

                return;
            }
        }

        try {
            const {
                data,
                error
            } =
                await window
                    .supabaseClient
                    .auth
                    .getSession();

            if (
                error ||
                !data?.session
            ) {
                throw (
                    error ||
                    new Error(
                        "No account session is available."
                    )
                );
            }

            sessionReady =
                true;

            updateButton();
        } catch (error) {
            showMessage(
                isRecovery()
                    ? "This password reset could not be verified. Request a new reset email."
                    : "This invitation could not be verified. Use the newest email from your club or ask them to send another invitation.",
                "error"
            );
        }
    }

    form.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();
            clearMessage();

            if (!sessionReady) {
                showMessage(
                    isRecovery()
                        ? "Your password reset has not been verified yet."
                        : "Your club invitation has not been verified yet.",
                    "error"
                );

                return;
            }

            if (
                newPassword.value.length <
                8
            ) {
                showMessage(
                    "Use at least 8 characters for your password.",
                    "error"
                );

                newPassword.focus();

                return;
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

                return;
            }

            saving =
                true;

            updateButton();

            try {
                const {
                    error
                } =
                    await window
                        .supabaseClient
                        .auth
                        .updateUser({
                            password:
                                newPassword
                                    .value
                        });

                if (error) {
                    throw error;
                }

                if (
                    !isRecovery()
                ) {
                    const {
                        error:
                            activationError
                    } =
                        await window
                            .supabaseClient
                            .rpc(
                                "activate_my_invited_memberships"
                            );

                    if (
                        activationError
                    ) {
                        throw activationError;
                    }
                }

                await window
                    .supabaseClient
                    .auth
                    .signOut();

                showMessage(
                    isRecovery()
                        ? "Password updated. Opening sign in…"
                        : "Your Paryx account is active. Opening sign in…",
                    "success"
                );

                window.setTimeout(
                    function () {
                        window.location
                            .replace(
                                isRecovery()
                                    ? "login.html?password_updated=1"
                                    : "login.html?activated=1"
                            );
                    },
                    700
                );
            } catch (error) {
                showMessage(
                    error?.message ||
                    (
                        isRecovery()
                            ? "We could not update your password. Request a new reset email."
                            : "We could not activate your Paryx account. Ask the club to resend your invitation."
                    ),
                    "error"
                );
            } finally {
                saving =
                    false;

                updateButton();
            }
        }
    );

    prepareSession();
})();
