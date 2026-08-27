(function () {
    "use strict";

    const P =
        window.ParyxMember;

    const elements = {
        tier:
            document.getElementById(
                "playTier"
            ),

        loading:
            document.getElementById(
                "playLoading"
            ),

        locked:
            document.getElementById(
                "playLocked"
            ),

        lockedTier:
            document.getElementById(
                "playLockedTier"
            ),

        enabled:
            document.getElementById(
                "playEnabled"
            ),

        enabledTitle:
            document.getElementById(
                "playEnabledTitle"
            ),

        enabledDescription:
            document.getElementById(
                "playEnabledDescription"
            ),

        accessType:
            document.getElementById(
                "playAccessType"
            ),

        accessUntil:
            document.getElementById(
                "playAccessUntil"
            ),

        error:
            document.getElementById(
                "playError"
            )
    };

    function parseTimestamp(value) {
        if (!value) {
            return null;
        }

        const date =
            new Date(value);

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date;
    }

    function isFuture(value) {
        const date =
            parseTimestamp(value);

        return Boolean(
            date &&
            date.getTime() >
                Date.now()
        );
    }

    function formatExpiry(value) {
        const date =
            parseTimestamp(value);

        if (!date) {
            return "No expiry";
        }

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            }
        ).format(date);
    }

    function resolveAccessState(
        entitlement
    ) {
        const safeEntitlement =
            entitlement || {};

        const scorecardAccess =
            Boolean(
                safeEntitlement
                    .scorecard_access
            );

        const plan =
            String(
                safeEntitlement.plan ||
                "free"
            ).toLowerCase();

        const tier2Active =
            plan === "tier2" &&
            (
                !safeEntitlement
                    .tier2_until ||
                isFuture(
                    safeEntitlement
                        .tier2_until
                )
            );

        const passActive =
            isFuture(
                safeEntitlement
                    .scorecard_pass_until
            );

        /*
         * Access itself is determined by member_get_bootstrap()
         * on the database/server side. The timestamp checks here
         * only decide which active entitlement label to display.
         */
        if (
            scorecardAccess &&
            tier2Active
        ) {
            return {
                unlocked: true,
                badge: "Tier 2",
                type: "Paryx Tier 2",
                until:
                    safeEntitlement
                        .tier2_until
                        ? formatExpiry(
                            safeEntitlement
                                .tier2_until
                        )
                        : "No expiry",
                title:
                    "Tier 2 active",
                description:
                    "Your Paryx Tier 2 scorecard access is active."
            };
        }

        if (
            scorecardAccess &&
            passActive
        ) {
            return {
                unlocked: true,
                badge: "Pass",
                type:
                    "Temporary scorecard pass",
                until:
                    formatExpiry(
                        safeEntitlement
                            .scorecard_pass_until
                    ),
                title:
                    "Temporary pass active",
                description:
                    "Your temporary Paryx scorecard pass is active."
            };
        }

        if (scorecardAccess) {
            /*
             * Defensive fallback: if the server says access is
             * active, never lock the player merely because the
             * browser cannot classify the entitlement.
             */
            return {
                unlocked: true,
                badge: "Active",
                type:
                    "Scorecard access",
                until:
                    "Active",
                title:
                    "Play unlocked",
                description:
                    "Your Paryx scorecard entitlement is active."
            };
        }

        return {
            unlocked: false,
            badge: "Free",
            type: "Free",
            until: "Not active",
            title: "Play is locked",
            description:
                "Scorecard access is not active."
        };
    }

    function renderLocked(
        entitlement,
        access
    ) {
        elements.tier.textContent =
            access.badge;

        elements.lockedTier.textContent =
            String(
                entitlement?.plan ||
                "free"
            ).toLowerCase() ===
            "tier2"
                ? "Tier 2 expired"
                : "Free";

        elements.loading.hidden =
            true;

        elements.enabled.hidden =
            true;

        elements.locked.hidden =
            false;
    }

    function renderEnabled(
        access
    ) {
        elements.tier.textContent =
            access.badge;

        elements.enabledTitle.textContent =
            access.title;

        elements
            .enabledDescription
            .textContent =
            access.description;

        elements.accessType.textContent =
            access.type;

        elements.accessUntil.textContent =
            access.until;

        elements.loading.hidden =
            true;

        elements.locked.hidden =
            true;

        elements.enabled.hidden =
            false;
    }

    P.ready
        .then(
            function (context) {
                const entitlement =
                    context.entitlement ||
                    {};

                const access =
                    resolveAccessState(
                        entitlement
                    );

                if (
                    access.unlocked
                ) {
                    renderEnabled(
                        access
                    );
                } else {
                    renderLocked(
                        entitlement,
                        access
                    );
                }
            }
        )
        .catch(
            function (error) {
                elements.loading.hidden =
                    true;

                elements.locked.hidden =
                    true;

                elements.enabled.hidden =
                    true;

                elements.error.hidden =
                    false;

                elements.error.textContent =
                    P.readableError(
                        error
                    );
            }
        );
})();
