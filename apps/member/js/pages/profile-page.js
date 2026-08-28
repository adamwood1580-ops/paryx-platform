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

        accountEmail:
            document.getElementById(
                "profileAccountEmail"
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

        membershipNoticesSection:
            document.getElementById(
                "profileMembershipNoticesSection"
            ),

        membershipNotices:
            document.getElementById(
                "profileMembershipNotices"
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

    function formatRenewalDate(value) {
        if (!value) {
            return "";
        }

        const parts =
            String(value)
                .split("-")
                .map(Number);

        const date =
            new Date(
                parts[0],
                (parts[1] || 1) - 1,
                parts[2] || 1
            );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return String(value);
        }

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                day: "numeric",
                month: "short",
                year: "numeric"
            }
        ).format(date);
    }

    function renewalCopy(notice) {
        const clubName =
            String(
                notice.club_name ||
                "your club"
            );

        const days =
            Number(
                notice.days_remaining
            );

        const date =
            formatRenewalDate(
                notice.renewal_date
            );

        const level =
            String(
                notice.notice_level ||
                "60_day"
            );

        if (level === "expired") {
            return {
                title:
                    `${clubName} membership expired`,
                body:
                    `Your membership at ${clubName} expired on ${date}. If you have not renewed, contact the club.`
            };
        }

        const remaining =
            days === 0
                ? "today"
                : days === 1
                    ? "in 1 day"
                    : `in ${days} days`;

        return {
            title:
                level === "30_day"
                    ? "30-day renewal reminder"
                    : "60-day renewal reminder",
            body:
                `Your membership at ${clubName} expires ${remaining} on ${date}.`
        };
    }

    function renderMembershipNotices(
        notices
    ) {
        const safe =
            Array.isArray(notices)
                ? notices
                : [];

        if (!safe.length) {
            elements
                .membershipNoticesSection
                .hidden =
                true;

            elements
                .membershipNotices
                .innerHTML =
                "";

            return;
        }

        elements
            .membershipNoticesSection
            .hidden =
            false;

        elements.membershipNotices
            .innerHTML =
            safe
                .map(
                    function (notice) {
                        const copy =
                            renewalCopy(
                                notice
                            );

                        const level =
                            String(
                                notice.notice_level ||
                                "60_day"
                            );

                        return `
                            <article
                                class="profile-renewal-notice profile-renewal-notice--${P.escapeHtml(
                                    level
                                )}"
                            >
                                <div class="profile-renewal-notice__icon">
                                    !
                                </div>

                                <div>
                                    <strong>
                                        ${P.escapeHtml(
                                            copy.title
                                        )}
                                    </strong>

                                    <p>
                                        ${P.escapeHtml(
                                            copy.body
                                        )}
                                    </p>
                                </div>
                            </article>
                        `;
                    }
                )
                .join("");
    }

    async function loadMembershipNotices() {
        try {
            const data =
                await P.rpc(
                    "member_get_membership_renewal_notices"
                );

            renderMembershipNotices(
                data
            );
        } catch (error) {
            console.warn(
                "Paryx membership renewal notice warning:",
                error
            );

            renderMembershipNotices(
                []
            );
        }
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

        elements.accountEmail.textContent =
            email ||
            "View and edit your Paryx details";

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
        .then(
            async function (context) {
                render(
                    context
                );

                await loadMembershipNotices();
            }
        )
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
