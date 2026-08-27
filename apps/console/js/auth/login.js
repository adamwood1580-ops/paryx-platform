(function () {
    "use strict";

    const form =
        document.getElementById(
            "consoleLoginForm"
        );

    const email =
        document.getElementById(
            "consoleEmail"
        );

    const password =
        document.getElementById(
            "consolePassword"
        );

    const submit =
        document.getElementById(
            "consoleLoginButton"
        );

    const forgotPassword =
        document.getElementById(
            "consoleForgotPassword"
        );

    const message =
        document.getElementById(
            "consoleLoginMessage"
        );

    if (
        !form ||
        !email ||
        !password ||
        !submit ||
        !message
    ) {
        return;
    }

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

    const params =
        new URLSearchParams(
            window.location.search
        );

    if (
        params.get("reason") ===
        "access"
    ) {
        show(
            "This account does not have Paryx Console access."
        );
    } else if (
        params.get("reason") ===
        "timeout"
    ) {
        show(
            "Your Console session ended after 30 minutes of inactivity."
        );
    } else if (
        params.get(
            "password_updated"
        ) === "1"
    ) {
        show(
            "Your Paryx password has been updated. Sign in to Console.",
            "success"
        );
    }

    if (forgotPassword) {
        forgotPassword.addEventListener(
            "click",
            async function () {
                clear();

                const emailValue =
                    email.value.trim();

                if (!emailValue) {
                    show(
                        "Enter your email address first."
                    );

                    email.focus();
                    return;
                }

                if (!email.validity.valid) {
                    show(
                        "Enter a valid email address."
                    );

                    email.focus();
                    return;
                }

                if (!window.supabaseClient) {
                    show(
                        "The password reset service is unavailable."
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
                                emailValue,
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

                    show(
                        "Password reset email sent. Open the newest email from Paryx.",
                        "success"
                    );
                } catch (error) {
                    console.error(
                        "Console password reset error:",
                        error
                    );

                    show(
                        error?.message ||
                        "The password reset email could not be sent."
                    );
                } finally {
                    forgotPassword.disabled =
                        false;
                }
            }
        );
    }

    form.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();
            clear();

            submit.disabled =
                true;

            submit.textContent =
                "Signing in…";

            try {
                const result =
                    await window.supabaseClient
                        .auth
                        .signInWithPassword({
                            email:
                                email.value.trim(),
                            password:
                                password.value
                        });

                if (result.error) {
                    throw result.error;
                }

                const accessResult =
                    await window.supabaseClient
                        .rpc(
                            "get_my_platform_access"
                        );

                if (accessResult.error) {
                    throw accessResult.error;
                }

                const access =
                    Array.isArray(
                        accessResult.data
                    )
                        ? accessResult.data[0]
                        : accessResult.data;

                if (
                    !access ||
                    access.is_active !== true
                ) {
                    await window.supabaseClient
                        .auth
                        .signOut();

                    show(
                        "This account does not have Paryx Console access."
                    );

                    return;
                }

                await window.supabaseClient
                    .rpc(
                        "platform_record_console_login"
                    );

                window.location.replace(
                    "dashboard.html"
                );
            } catch (error) {
                console.error(
                    "Paryx Console login error:",
                    error
                );

                show(
                    error?.message ||
                    "Sign in failed."
                );
            } finally {
                submit.disabled =
                    false;

                submit.textContent =
                    "Sign in to Console";
            }
        }
    );
})();
