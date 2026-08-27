(function () {
    "use strict";

    const form =
        document.getElementById(
            "setPasswordForm"
        );

    const newPassword =
        document.getElementById(
            "newPassword"
        );

    const confirmPassword =
        document.getElementById(
            "confirmPassword"
        );

    const newPasswordToggle =
        document.getElementById(
            "newPasswordToggle"
        );

    const confirmPasswordToggle =
        document.getElementById(
            "confirmPasswordToggle"
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

    const intro =
        document.getElementById(
            "setPasswordIntro"
        );

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

    let sessionReady =
        false;

    let isSaving =
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
            `auth-message auth-message--${type} is-visible`;
    }

    function clearMessage() {
        message.textContent =
            "";

        message.className =
            "auth-message";
    }

    function updateCopy() {
        document.title =
            isRecovery()
                ? "Reset Password | Paryx"
                : "Set Password | Paryx";

        if (eyebrow) {
            eyebrow.textContent =
                isRecovery()
                    ? "Password reset"
                    : "Welcome to Paryx";
        }

        if (intro) {
            intro.textContent =
                isRecovery()
                    ? "Choose a new password for your global Paryx account."
                    : "Your Paryx account is ready. Create a password to get started.";
        }
    }

    function updateSubmitState() {
        submitButton.disabled =
            isSaving ||
            !sessionReady;

        submitButton.textContent =
            isSaving
                ? "Saving password…"
                : (
                    isRecovery()
                        ? "Save new password"
                        : "Set password"
                );
    }

    function setSessionReady(value) {
        sessionReady =
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
        if (
            newPassword.value.length <
            8
        ) {
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
            window.location.hash
                .startsWith("#")
                ? window.location.hash
                    .slice(1)
                : window.location.hash;

        return new URLSearchParams(
            hash
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

    function getAuthError() {
        const query =
            new URLSearchParams(
                window.location.search
            );

        const hash =
            getHashParameters();

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
            getHashParameters();

        const suppliedType =
            String(
                query.get("type") ||
                hash.get("type") ||
                ""
            ).toLowerCase();

        flowType =
            suppliedType ===
            "recovery"
                ? "recovery"
                : "invite";

        updateCopy();
        updateSubmitState();
    }

    async function createSession() {
        setSessionReady(false);
        detectFlowType();

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
                    authError.replace(
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
                    await window.supabaseClient
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
                setSessionReady(true);
                return;
            } catch (error) {
                console.error(
                    "Paryx password link verification error:",
                    error
                );

                showMessage(
                    error?.message ||
                    (
                        isRecovery()
                            ? "This password reset link is invalid or has expired."
                            : "This invitation link is invalid or has expired."
                    ),
                    "error"
                );

                return;
            }
        }

        const hash =
            getHashParameters();

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
                            "No authenticated session was created."
                        )
                    );
                }

                clearAuthParameters();
                clearMessage();
                setSessionReady(true);
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
                        "No account session is available."
                    )
                );
            }

            clearMessage();
            setSessionReady(true);
        } catch (error) {
            showMessage(
                isRecovery()
                    ? "This password reset could not be verified. Request another reset email."
                    : "This invitation could not be verified. Use the newest invitation email.",
                "error"
            );
        }
    }

    async function destinationAfterInvite() {
        const {
            data: {
                user
            }
        } =
            await window.supabaseClient
                .auth
                .getUser();

        let destination =
            "../../member/html/login.html?activated=1";

        if (!user?.id) {
            return destination;
        }

        const {
            data:
                memberships,
            error
        } =
            await window.supabaseClient
                .from(
                    "club_memberships"
                )
                .select(
                    "role,status"
                )
                .eq(
                    "profile_id",
                    user.id
                )
                .eq(
                    "status",
                    "active"
                );

        if (error) {
            console.warn(
                "Could not inspect membership roles:",
                error
            );

            return destination;
        }

        const hasStaffAccess =
            (
                memberships ||
                []
            ).some(
                function (membership) {
                    return [
                        "starter",
                        "reception",
                        "professional",
                        "greenkeeper",
                        "manager",
                        "club_admin"
                    ].includes(
                        membership.role
                    );
                }
            );

        if (hasStaffAccess) {
            destination =
                "login.html?activated=1";
        }

        return destination;
    }

    configurePasswordToggle(
        newPasswordToggle,
        newPassword
    );

    configurePasswordToggle(
        confirmPasswordToggle,
        confirmPassword
    );

    setSessionReady(false);

    form.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();
            clearMessage();

            if (!sessionReady) {
                showMessage(
                    isRecovery()
                        ? "Your password reset has not been verified yet."
                        : "Your invitation has not been verified yet.",
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

                let destination =
                    "login.html?password_updated=1";

                if (!isRecovery()) {
                    const {
                        error:
                            activationError
                    } =
                        await window.supabaseClient
                            .rpc(
                                "activate_my_invited_memberships"
                            );

                    if (activationError) {
                        throw activationError;
                    }

                    destination =
                        await destinationAfterInvite();
                }

                await window.supabaseClient
                    .auth
                    .signOut();

                showMessage(
                    isRecovery()
                        ? "Password updated. Opening ClubHub sign in…"
                        : "Password saved. Opening Paryx…",
                    "success"
                );

                window.setTimeout(
                    function () {
                        window.location
                            .replace(
                                destination
                            );
                    },
                    800
                );
            } catch (error) {
                console.error(
                    "Password update error:",
                    error
                );

                showMessage(
                    error?.message ||
                    (
                        isRecovery()
                            ? "We could not update your password. Request another reset email."
                            : "We could not activate your Paryx account. Ask for another invitation."
                    ),
                    "error"
                );
            } finally {
                setSaving(false);
            }
        }
    );

    createSession();
})();
