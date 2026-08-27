(function () {
    "use strict";

    const LOGIN = "login.html";
    const CLUB_KEY = "paryx_member_selected_club";

    window.ParyxMember =
        window.ParyxMember || {};

    function readableError(error) {
        return (
            error?.message ||
            error?.details ||
            error?.hint ||
            String(
                error ||
                "Something went wrong."
            )
        );
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function rows(data) {
        if (!data) {
            return [];
        }

        return Array.isArray(data)
            ? data
            : [data];
    }

    async function rpc(name, args) {
        const {
            data,
            error
        } =
            await window.supabaseClient
                .rpc(
                    name,
                    args || {}
                );

        if (error) {
            throw error;
        }

        return data;
    }

    function isoDate(date) {
        return [
            date.getFullYear(),
            String(
                date.getMonth() + 1
            ).padStart(2, "0"),
            String(
                date.getDate()
            ).padStart(2, "0")
        ].join("-");
    }

    function parseDate(value) {
        const parts =
            String(value || "")
                .split("-")
                .map(Number);

        return new Date(
            parts[0],
            (parts[1] || 1) - 1,
            parts[2] || 1
        );
    }

    function formatDay(value, options) {
        return new Intl.DateTimeFormat(
            "en-GB",
            options || {
                weekday: "short",
                day: "numeric",
                month: "short"
            }
        ).format(
            value instanceof Date
                ? value
                : parseDate(value)
        );
    }

    function longDay(value) {
        return formatDay(
            value,
            {
                weekday: "long",
                day: "numeric",
                month: "long"
            }
        );
    }

    function shortTime(value) {
        return String(value || "")
            .slice(0, 5);
    }

    function selectedClubId() {
        return localStorage.getItem(
            CLUB_KEY
        );
    }

    function setSelectedClubId(value) {
        if (value) {
            localStorage.setItem(
                CLUB_KEY,
                value
            );
        } else {
            localStorage.removeItem(
                CLUB_KEY
            );
        }
    }

    async function signOut() {
        await window.supabaseClient
            .auth
            .signOut();

        window.location.replace(
            LOGIN
        );
    }

    const ready =
        (async function () {
            if (
                !window.supabaseClient
            ) {
                throw new Error(
                    "Paryx could not connect to the sign-in service."
                );
            }

            const {
                data,
                error
            } =
                await window.supabaseClient
                    .auth
                    .getSession();

            if (error) {
                throw error;
            }

            if (
                !data?.session?.user
            ) {
                const returnTo =
                    encodeURIComponent(
                        window.location.pathname
                            .split("/")
                            .pop() ||
                        "home.html"
                    );

                window.location.replace(
                    `${LOGIN}?returnTo=${returnTo}`
                );

                throw new Error(
                    "No authenticated session."
                );
            }

            /*
             * A club may already have created this player's
             * global Paryx Auth account through CSV import.
             * On first authenticated use, promote any invited
             * or pending club memberships to active.
             */
            try {
                await rpc(
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

            const bootstrap =
                await rpc(
                    "member_get_bootstrap"
                );

            return {
                user:
                    data.session.user,

                profile:
                    bootstrap?.profile ||
                    {},

                entitlement:
                    bootstrap?.entitlement ||
                    {
                        plan:
                            "free",
                        scorecard_access:
                            false
                    },

                memberClubs:
                    Array.isArray(
                        bootstrap
                            ?.member_clubs
                    )
                        ? bootstrap
                            .member_clubs
                        : []
            };
        })();

    Object.assign(
        window.ParyxMember,
        {
            ready,
            rpc,
            readableError,
            escapeHtml,
            rows,
            isoDate,
            parseDate,
            formatDay,
            longDay,
            shortTime,
            selectedClubId,
            setSelectedClubId,
            signOut
        }
    );
})();
