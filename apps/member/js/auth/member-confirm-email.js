(function () {
    "use strict";

    const title =
        document.getElementById(
            "confirmEmailTitle"
        );

    const message =
        document.getElementById(
            "confirmEmailMessage"
        );

    function fail(text) {
        title.textContent =
            "Email confirmation failed";

        message.textContent =
            text;
    }

    async function confirmEmail() {
        if (!window.supabaseClient) {
            fail(
                "The Paryx account service is unavailable. Refresh and try again."
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
            String(
                query.get("type") ||
                ""
            ).toLowerCase();

        if (
            !tokenHash ||
            type !== "email"
        ) {
            fail(
                "This confirmation link is incomplete. Use the newest Paryx email."
            );

            return;
        }

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
                            "email"
                    });

            if (
                error ||
                !data?.session
            ) {
                throw (
                    error ||
                    new Error(
                        "No confirmation session was created."
                    )
                );
            }

            await window
                .supabaseClient
                .auth
                .signOut();

            title.textContent =
                "Email confirmed";

            message.textContent =
                "Opening Paryx sign in…";

            window.setTimeout(
                function () {
                    window.location
                        .replace(
                            "login.html?confirmed=1"
                        );
                },
                600
            );
        } catch (error) {
            fail(
                error?.message ||
                "This confirmation link is invalid or has expired."
            );
        }
    }

    confirmEmail();
})();
