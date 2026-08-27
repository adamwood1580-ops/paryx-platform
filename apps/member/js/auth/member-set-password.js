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

    if (
        !form ||
        !newPassword ||
        !confirmPassword ||
        !submitButton ||
        !message
    ) {
        return;
    }

    let inviteReady =
        false;

    let saving =
        false;

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

    function updateButton() {
        submitButton.disabled =
            !inviteReady ||
            saving;

        submitButton.textContent =
            saving
                ? "Activating…"
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

    async function prepareInvite() {
        inviteReady =
            false;

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

        const query =
            new URLSearchParams(
                window.location.search
            );

        const tokenHash =
            query.get(
                "token_hash"
            );

        const type =
            query.get(
                "type"
            );

        if (
            tokenHash &&
            type === "invite"
        ) {
            try {
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
                                "invite"
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

                inviteReady =
                    true;

                updateButton();

                return;
            } catch (error) {
                showMessage(
                    error?.message ||
                    "This invitation is invalid or has expired. Ask the club to send another invitation.",
                    "error"
                );

                return;
            }
        }

        const hash =
            hashParameters();

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
                            "No invitation session was created."
                        )
                    );
                }

                clearAuthParameters();
                clearMessage();

                inviteReady =
                    true;

                updateButton();

                return;
            } catch (error) {
                showMessage(
                    error?.message ||
                    "This invitation is invalid or has expired.",
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
                        "No invitation session is available."
                    )
                );
            }

            inviteReady =
                true;

            updateButton();
        } catch (error) {
            showMessage(
                "This invitation could not be verified. Use the newest email from your club or ask them to send another invitation.",
                "error"
            );
        }
    }

    form.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();
            clearMessage();

            if (!inviteReady) {
                showMessage(
                    "Your club invitation has not been verified yet.",
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

                await window
                    .supabaseClient
                    .auth
                    .signOut();

                showMessage(
                    "Your Paryx account is active. Opening sign in…",
                    "success"
                );

                window.setTimeout(
                    function () {
                        window.location
                            .replace(
                                "login.html?activated=1"
                            );
                    },
                    700
                );
            } catch (error) {
                showMessage(
                    error?.message ||
                    "We could not activate your Paryx account. Ask the club to resend your invitation.",
                    "error"
                );
            } finally {
                saving =
                    false;

                updateButton();
            }
        }
    );

    prepareInvite();
})();
