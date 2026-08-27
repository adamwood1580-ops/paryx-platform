(function () {
    "use strict";

    const P =
        window.ParyxMember;

    const elements = {
        initials:
            document.getElementById(
                "profileInitials"
            ),

        name:
            document.getElementById(
                "profileName"
            ),

        email:
            document.getElementById(
                "profileEmail"
            ),

        emailStatus:
            document.getElementById(
                "profileEmailStatus"
            ),

        phoneRow:
            document.getElementById(
                "profilePhoneRow"
            ),

        phone:
            document.getElementById(
                "profilePhone"
            ),

        tierBadge:
            document.getElementById(
                "profileTierBadge"
            ),

        tier:
            document.getElementById(
                "profileTier"
            ),

        scorecard:
            document.getElementById(
                "profileScorecard"
            ),

        accessExpiry:
            document.getElementById(
                "profileAccessExpiry"
            ),

        accessExpiryValue:
            document.getElementById(
                "profileAccessExpiryValue"
            ),

        clubCount:
            document.getElementById(
                "profileClubCount"
            ),

        clubs:
            document.getElementById(
                "profileClubs"
            ),

        signOut:
            document.getElementById(
                "signOut"
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
            return "";
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

    function initials(name) {
        const parts =
            String(
                name ||
                "Player"
            )
                .trim()
                .split(/\s+/)
                .filter(Boolean);

        if (!parts.length) {
            return "P";
        }

        if (parts.length === 1) {
            return parts[0]
                .slice(0, 2)
                .toUpperCase();
        }

        return (
            parts[0].charAt(0) +
            parts[
                parts.length - 1
            ].charAt(0)
        ).toUpperCase();
    }

    function entitlementState(
        entitlement
    ) {
        const safe =
            entitlement || {};

        const plan =
            String(
                safe.plan ||
                "free"
            ).toLowerCase();

        const tier2Active =
            plan === "tier2" &&
            (
                !safe.tier2_until ||
                isFuture(
                    safe.tier2_until
                )
            );

        const passActive =
            isFuture(
                safe.scorecard_pass_until
            );

        if (
            safe.scorecard_access &&
            tier2Active
        ) {
            return {
                badge: "Tier 2",
                tier: "Tier 2",
                scorecard: "Active",
                expiry:
                    safe.tier2_until ||
                    null
            };
        }

        if (
            safe.scorecard_access &&
            passActive
        ) {
            return {
                badge: "Pass",
                tier: "Free",
                scorecard:
                    "Temporary pass",
                expiry:
                    safe.scorecard_pass_until
            };
        }

        if (
            safe.scorecard_access
        ) {
            return {
                badge: "Active",
                tier:
                    plan === "tier2"
                        ? "Tier 2"
                        : "Free",
                scorecard: "Active",
                expiry: null
            };
        }

        return {
            badge:
                plan === "tier2"
                    ? "Free"
                    : "Free",

            tier:
                plan === "tier2"
                    ? "Tier 2 expired"
                    : "Free",

            scorecard:
                "Not active",

            expiry: null
        };
    }

    function membershipLabel(
        club
    ) {
        const number =
            String(
                club.membership_number ||
                ""
            ).trim();

        if (number) {
            return `Member ${number}`;
        }

        return "Member access";
    }

    function clubInitial(
        clubName
    ) {
        return String(
            clubName ||
            "C"
        )
            .trim()
            .charAt(0)
            .toUpperCase() ||
            "C";
    }

    function renderClubs(
        clubs
    ) {
        const safeClubs =
            Array.isArray(clubs)
                ? clubs
                : [];

        elements.clubCount.textContent =
            `${safeClubs.length} linked ${
                safeClubs.length === 1
                    ? "club"
                    : "clubs"
            }`;

        if (!safeClubs.length) {
            elements.clubs.innerHTML = `
                <div class="empty">
                    No linked club memberships yet.
                    You can request member access from Book.
                </div>
            `;

            return;
        }

        elements.clubs.innerHTML =
            safeClubs
                .map(
                    function (club) {
                        const primary =
                            Boolean(
                                club.is_primary
                            );

                        return `
                            <article class="club profile-club">
                                <div
                                    class="club-logo"
                                    aria-hidden="true"
                                >
                                    ${P.escapeHtml(
                                        clubInitial(
                                            club.club_name
                                        )
                                    )}
                                </div>

                                <div class="profile-club__body">
                                    <strong>
                                        ${P.escapeHtml(
                                            club.club_name
                                        )}
                                    </strong>

                                    <span>
                                        ${P.escapeHtml(
                                            membershipLabel(
                                                club
                                            )
                                        )}
                                    </span>
                                </div>

                                <div class="profile-club__badges">
                                    ${
                                        primary
                                            ? `
                                                <span class="badge profile-badge-primary">
                                                    Primary
                                                </span>
                                            `
                                            : ""
                                    }

                                    <span class="badge">
                                        Member
                                    </span>
                                </div>
                            </article>
                        `;
                    }
                )
                .join("");
    }

    function render(
        context
    ) {
        const profile =
            context.profile ||
            {};

        const entitlement =
            context.entitlement ||
            {};

        const user =
            context.user ||
            {};

        const playerName =
            String(
                profile.display_name ||
                "Player"
            ).trim() ||
            "Player";

        const email =
            String(
                profile.email ||
                user.email ||
                ""
            ).trim();

        const phone =
            String(
                profile.phone ||
                ""
            ).trim();

        const access =
            entitlementState(
                entitlement
            );

        elements.initials.textContent =
            initials(
                playerName
            );

        elements.name.textContent =
            playerName;

        elements.email.textContent =
            email ||
            "—";

        elements.emailStatus.textContent =
            user.email_confirmed_at
                ? "Verified"
                : "Not verified";

        if (phone) {
            elements.phone.textContent =
                phone;

            elements.phoneRow.hidden =
                false;
        } else {
            elements.phoneRow.hidden =
                true;
        }

        elements.tierBadge.textContent =
            access.badge;

        elements.tier.textContent =
            access.tier;

        elements.scorecard.textContent =
            access.scorecard;

        if (access.expiry) {
            elements
                .accessExpiryValue
                .textContent =
                formatExpiry(
                    access.expiry
                );

            elements.accessExpiry.hidden =
                false;
        } else {
            elements.accessExpiry.hidden =
                true;
        }

        renderClubs(
            context.memberClubs
        );
    }

    elements.signOut.addEventListener(
        "click",
        async function () {
            elements.signOut.disabled =
                true;

            elements.signOut.textContent =
                "Signing out…";

            try {
                await P.signOut();
            } catch (error) {
                elements.signOut.disabled =
                    false;

                elements.signOut.textContent =
                    "Sign out";

                window.alert(
                    P.readableError(
                        error
                    )
                );
            }
        }
    );

    P.ready
        .then(render)
        .catch(
            function (error) {
                elements.clubs.innerHTML = `
                    <div class="notice error">
                        ${P.escapeHtml(
                            P.readableError(
                                error
                            )
                        )}
                    </div>
                `;
            }
        );
})();
