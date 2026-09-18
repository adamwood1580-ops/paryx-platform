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

    function getHashParameters() {
        const value =
            window.location.hash.startsWith("#")
                ? window.location.hash.slice(1)
                : window.location.hash;

        return new URLSearchParams(value);
    }

    function firstError(query, hash) {
        return (
            query.get("error_description") ||
            hash.get("error_description") ||
            query.get("error") ||
            hash.get("error") ||
            ""
        );
    }

    function delay(milliseconds) {
        return new Promise(function (resolve) {
            window.setTimeout(
                resolve,
                milliseconds
            );
        });
    }

    async function getConfirmedSession() {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const {
                data,
                error
            } =
                await window
                    .supabaseClient
                    .auth
                    .getSession();

            if (error) {
                throw error;
            }

            if (data?.session) {
                return data.session;
            }

            await delay(250);
        }

        return null;
    }

    function safeReturnTo(query) {
        const returnTo =
            String(
                query.get("returnTo") ||
                ""
            ).trim();

        if (
            /^[A-Za-z0-9_-]+\.html(?:\?[^#]*)?(?:#.*)?$/.test(returnTo) &&
            !returnTo.includes("..")
        ) {
            return returnTo;
        }

        return "";
    }

    async function completeConfirmation(query) {
        title.textContent =
            "Email confirmed";

        message.textContent =
            "Opening Paryx sign in…";

        try {
            await window
                .supabaseClient
                .auth
                .signOut();
        } catch (error) {
            console.warn(
                "Paryx confirmation sign-out warning:",
                error
            );
        }

        window.setTimeout(
            function () {
                const returnTo =
                    safeReturnTo(query);

                const destination =
                    returnTo
                        ? `login.html?confirmed=1&returnTo=${encodeURIComponent(returnTo)}`
                        : "login.html?confirmed=1";

                window.location
                    .replace(
                        destination
                    );
            },
            600
        );
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

        const hash =
            getHashParameters();

        const authError =
            firstError(
                query,
                hash
            );

        if (authError) {
            fail(
                decodeURIComponent(
                    authError.replace(/\+/g, " ")
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
                ""
            ).toLowerCase();

        try {
            /*
             * Flow 1: custom Paryx link carrying a Supabase
             * token_hash directly to this page.
             */
            if (
                tokenHash &&
                (
                    type === "email" ||
                    type === "signup"
                )
            ) {
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

                await completeConfirmation(
                    query
                );

                return;
            }

            /*
             * Flow 2: Supabase ConfirmationURL verifies the
             * email first, then redirects to Paryx with an
             * implicit-flow session in the URL hash.
             */
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
                            "The confirmation session could not be restored."
                        )
                    );
                }

                await completeConfirmation(
                    query
                );

                return;
            }

            /*
             * Flow 3: PKCE-style redirect. Supabase may send
             * a code instead of hash tokens depending on the
             * Auth configuration/client version.
             */
            const code =
                query.get("code");

            if (code) {
                const {
                    data,
                    error
                } =
                    await window
                        .supabaseClient
                        .auth
                        .exchangeCodeForSession(
                            code
                        );

                if (
                    error ||
                    !data?.session
                ) {
                    throw (
                        error ||
                        new Error(
                            "The confirmation code could not be exchanged."
                        )
                    );
                }

                await completeConfirmation(
                    query
                );

                return;
            }

            /*
             * Flow 4: supabase-js may already have consumed
             * the URL and persisted the confirmed session by
             * the time this page script runs.
             */
            const existingSession =
                await getConfirmedSession();

            if (existingSession) {
                await completeConfirmation(
                    query
                );

                return;
            }

            fail(
                "This confirmation link could not be verified. Please open the newest Paryx confirmation email and try again."
            );
        } catch (error) {
            console.error(
                "Paryx email confirmation error:",
                error
            );

            fail(
                error?.message ||
                "This confirmation link is invalid or has expired."
            );
        }
    }

    confirmEmail();
})();
