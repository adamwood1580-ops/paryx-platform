(function () {
    "use strict";

    const form =
        document.getElementById(
            "authForm"
        );

    if (!form) {
        return;
    }

    const tabs =
        Array.from(
            document.querySelectorAll(
                "[data-mode]"
            )
        );

    const names =
        document.getElementById(
            "nameFields"
        );

    const first =
        document.getElementById(
            "firstName"
        );

    const last =
        document.getElementById(
            "lastName"
        );

    const email =
        document.getElementById(
            "email"
        );

    const password =
        document.getElementById(
            "password"
        );

    const submit =
        document.getElementById(
            "submit"
        );

    const message =
        document.getElementById(
            "message"
        );

    const forgotPassword =
        document.getElementById(
            "forgotPassword"
        );

    const pageParameters =
        new URLSearchParams(
            window.location.search
        );

    let mode =
        "signin";

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
        message.hidden =
            true;

        message.textContent =
            "";
    }

    function setMode(value) {
        mode =
            value;

        const signup =
            value ===
            "signup";

        names.hidden =
            !signup;

        first.required =
            signup;

        last.required =
            signup;

        submit.textContent =
            signup
                ? "Create free account"
                : "Sign in";

        if (forgotPassword) {
            forgotPassword.hidden =
                signup;
        }

        tabs.forEach(
            function (button) {
                button.classList.toggle(
                    "active",
                    button.dataset.mode ===
                        value
                );
            }
        );

        clearMessage();
    }

    function destination() {
        const value =
            pageParameters.get(
                "returnTo"
            );

        return (
            value &&
            !value.includes("://") &&
            !value.includes("..")
        )
            ? value
            : "home.html";
    }

    tabs.forEach(
        function (button) {
            button.addEventListener(
                "click",
                function () {
                    setMode(
                        button.dataset.mode
                    );
                }
            );
        }
    );


    if (forgotPassword) {
        forgotPassword.addEventListener(
            "click",
            async function () {
                clearMessage();

                if (
                    !email.validity.valid
                ) {
                    showMessage(
                        "Enter your email address first.",
                        "error"
                    );

                    email.focus();
                    return;
                }

                forgotPassword.disabled =
                    true;

                try {
                    const {
                        error
                    } =
                        await window
                            .supabaseClient
                            .auth
                            .resetPasswordForEmail(
                                email.value.trim(),
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
                    showMessage(
                        error?.message ||
                        "Could not send the password reset email.",
                        "error"
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
            clearMessage();

            if (
                !email.validity.valid
            ) {
                showMessage(
                    "Enter a valid email address.",
                    "error"
                );

                return;
            }

            if (
                password.value.length <
                6
            ) {
                showMessage(
                    "Password must contain at least 6 characters.",
                    "error"
                );

                return;
            }

            submit.disabled =
                true;

            try {
                if (
                    mode ===
                    "signup"
                ) {
                    const firstName =
                        first.value.trim();

                    const lastName =
                        last.value.trim();

                    if (
                        !firstName ||
                        !lastName
                    ) {
                        throw new Error(
                            "Enter your first and last name."
                        );
                    }

                    const {
                        data,
                        error
                    } =
                        await window
                            .supabaseClient
                            .auth
                            .signUp({
                                email:
                                    email
                                        .value
                                        .trim(),
                                password:
                                    password
                                        .value,
                                options: {
                                    emailRedirectTo:
                                        new URL(
                                            "confirm-email.html",
                                            window.location.href
                                        ).href,

                                    data: {
                                        first_name:
                                            firstName,
                                        last_name:
                                            lastName,
                                        display_name:
                                            `${firstName} ${lastName}`
                                    }
                                }
                            });

                    if (error) {
                        throw error;
                    }

                    if (
                        data?.session
                    ) {
                        window.location
                            .replace(
                                destination()
                            );

                        return;
                    }

                    showMessage(
                        "Account created. Check your email to confirm it, then sign in.",
                        "success"
                    );

                    mode =
                        "signin";

                    names.hidden =
                        true;

                    first.required =
                        false;

                    last.required =
                        false;

                    submit.textContent =
                        "Sign in";

                    tabs.forEach(
                        function (
                            button
                        ) {
                            button.classList.toggle(
                                "active",
                                button.dataset.mode ===
                                    "signin"
                            );
                        }
                    );

                    return;
                }

                const {
                    error
                } =
                    await window
                        .supabaseClient
                        .auth
                        .signInWithPassword({
                            email:
                                email
                                    .value
                                    .trim(),
                            password:
                                password
                                    .value
                        });

                if (error) {
                    throw error;
                }

                /*
                 * If this player was imported by a club before
                 * they first used Paryx Player, activate the
                 * existing invited/pending membership now.
                 */
                try {
                    await window
                        .supabaseClient
                        .rpc(
                            "activate_my_invited_memberships"
                        );
                } catch (
                    activationError
                ) {
                    console.warn(
                        "Paryx membership activation warning:",
                        activationError
                    );
                }

                window.location.replace(
                    destination()
                );
            } catch (error) {
                showMessage(
                    error?.message ||
                    "Could not sign in.",
                    "error"
                );
            } finally {
                submit.disabled =
                    false;
            }
        }
    );

    if (
        pageParameters.get(
            "activated"
        ) === "1"
    ) {
        showMessage(
            "Your Paryx account is ready. Sign in with the password you just created.",
            "success"
        );
    } else if (
        pageParameters.get(
            "confirmed"
        ) === "1"
    ) {
        showMessage(
            "Your email is confirmed. Sign in to Paryx.",
            "success"
        );
    } else if (
        pageParameters.get(
            "password_updated"
        ) === "1"
    ) {
        showMessage(
            "Your password has been updated. Sign in to Paryx.",
            "success"
        );
    }

    window.supabaseClient
        .auth
        .getSession()
        .then(
            function (result) {
                if (
                    result.data
                        ?.session
                        ?.user
                ) {
                    window.location
                        .replace(
                            destination()
                        );
                }
            }
        );
})();
