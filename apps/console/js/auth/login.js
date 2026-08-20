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

    const message =
        document.getElementById(
            "consoleLoginMessage"
        );

    function show(text) {
        message.textContent = text;
        message.hidden = false;
    }

    function clear() {
        message.textContent = "";
        message.hidden = true;
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
    }

    form.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();
            clear();

            submit.disabled = true;
            submit.textContent =
                "Signing in…";

            try {
                const result =
                    await window
                        .supabaseClient
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
                    await window
                        .supabaseClient
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
                    await window
                        .supabaseClient
                        .auth
                        .signOut();

                    show(
                        "This account does not have Paryx Console access."
                    );

                    return;
                }

                await window
                    .supabaseClient
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
                submit.disabled = false;
                submit.textContent =
                    "Sign in to Console";
            }
        }
    );
})();
