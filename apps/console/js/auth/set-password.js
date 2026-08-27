(function () {
    "use strict";

    const form =
        document.getElementById(
            "consoleSetPasswordForm"
        );

    const newPassword =
        document.getElementById(
            "consoleNewPassword"
        );

    const confirmPassword =
        document.getElementById(
            "consoleConfirmPassword"
        );

    const submit =
        document.getElementById(
            "consoleSetPasswordButton"
        );

    const message =
        document.getElementById(
            "consoleSetPasswordMessage"
        );

    if (
        !form ||
        !newPassword ||
        !confirmPassword ||
        !submit ||
        !message
    ) {
        return;
    }

    let sessionReady =
        false;

    let saving =
        false;

    function show(
        text,
        type
    ) {
        message.textContent =
            text;

        message.hidden =
            false;

        message.dataset.type =
            type || "error";
    }

    function clear() {
        message.textContent =
            "";

        message.hidden =
            true;

        delete message.dataset.type;
    }

    function updateButton() {
        submit.disabled =
            !sessionReady ||
            saving;

        submit.textContent =
            saving
                ? "Saving…"
                : (
                    sessionReady
                        ? "Save new password"
                        : "Verify reset link"
                );
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

        url.hash =
            "";

        window.history
            .replaceState(
                {},
                document.title,
                `${url.pathname}${url.search}`
            );
    }

    async function prepareRecoverySession() {
        sessionReady =
            false;

        updateButton();

        if (!window.supabaseClient) {
            show(
                "The Paryx account service is unavailable."
            );

            return;
        }

        const query =
            new URLSearchParams(
                window.location.search
            );

        const hash =
            hashParameters();

        const suppliedError =
            query.get(
                "error_description"
            ) ||
            hash.get(
                "error_description"
            );

        if (suppliedError) {
            show(
                decodeURIComponent(
                    suppliedError.replace(
                        /\+/g,
                        " "
                    )
                )
            );

            return;
        }

        const tokenHash =
            query.get(
                "token_hash"
            );

        const type =
            String(
                query.get("type") ||
                hash.get("type") ||
                ""
            ).toLowerCase();

        if (
            tokenHash &&
            type ===
            "recovery"
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
                            type:
                                "recovery"
                        });

                if (
                    error ||
                    !data?.session
                ) {
                    throw (
                        error ||
                        new Error(
                            "No recovery session was created."
                        )
                    );
                }

                clearAuthParameters();
                clear();

                sessionReady =
                    true;

                updateButton();
                return;
            } catch (error) {
                show(
                    error?.message ||
                    "This password reset link is invalid or has expired."
                );

                return;
            }
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
                            "No recovery session was created."
                        )
                    );
                }

                clearAuthParameters();
                clear();

                sessionReady =
                    true;

                updateButton();
                return;
            } catch (error) {
                show(
                    error?.message ||
                    "This password reset link is invalid or has expired."
                );

                return;
            }
        }

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
                throw (
                    error ||
                    new Error(
                        "No recovery session is available."
                    )
                );
            }

            sessionReady =
                true;

            updateButton();
        } catch (error) {
            show(
                "This password reset could not be verified. Request another reset email from Console."
            );
        }
    }

    form.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();
            clear();

            if (!sessionReady) {
                show(
                    "Your password reset has not been verified yet."
                );

                return;
            }

            if (
                newPassword.value.length <
                8
            ) {
                show(
                    "Use at least 8 characters for your password."
                );

                newPassword.focus();
                return;
            }

            if (
                newPassword.value !==
                confirmPassword.value
            ) {
                show(
                    "The passwords do not match."
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

                show(
                    "Password updated. Opening Console sign in…",
                    "success"
                );

                window.setTimeout(
                    function () {
                        window.location
                            .replace(
                                "login.html?password_updated=1"
                            );
                    },
                    700
                );
            } catch (error) {
                show(
                    error?.message ||
                    "We could not update your password. Request another reset email."
                );
            } finally {
                saving =
                    false;

                updateButton();
            }
        }
    );

    prepareRecoverySession();
})();
