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

        clubCreditSection:
            document.getElementById(
                "profileClubCreditSection"
            ),

        clubCredit:
            document.getElementById(
                "profileClubCredit"
            ),

        creditDialog:
            document.getElementById(
                "profileCreditDialog"
            ),

        creditDialogTitle:
            document.getElementById(
                "profileCreditDialogTitle"
            ),

        creditDialogClose:
            document.getElementById(
                "profileCreditDialogClose"
            ),

        creditTransactions:
            document.getElementById(
                "profileCreditTransactions"
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
                .filter(
                    function (part) {
                        return (
                            Boolean(part) &&
                            !/^\d+$/.test(part)
                        );
                    }
                );

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

    const CREDIT_TYPE_LABELS = {
        competition_prize: "Competition prize",
        manual_credit: "Club credit",
        manual_debit: "Club debit",
        epos_purchase: "Club purchase",
        refund: "Refund",
        adjustment: "Adjustment"
    };

    function formatCreditMoney(value, currency) {
        return new Intl.NumberFormat(
            "en-GB",
            {
                style: "currency",
                currency: String(currency || "GBP")
            }
        ).format(Number(value || 0));
    }

    function renderClubCredit(accounts) {
        const safe =
            Array.isArray(accounts)
                ? accounts
                : [];

        if (!safe.length) {
            elements.clubCreditSection.hidden = true;
            elements.clubCredit.innerHTML = "";
            return;
        }

        elements.clubCreditSection.hidden = false;

        elements.clubCredit.innerHTML =
            safe
                .map(function (account) {
                    return `
                        <article class="card profile-credit-card">
                            <div class="profile-credit-card__club">
                                <strong>
                                    ${P.escapeHtml(account.club_name)}
                                </strong>
                                <span>
                                    Club-specific member credit
                                </span>
                            </div>

                            <div class="profile-credit-card__balance">
                                <strong>
                                    ${P.escapeHtml(
                                        formatCreditMoney(
                                            account.balance,
                                            account.currency_code
                                        )
                                    )}
                                </strong>

                                <button
                                    type="button"
                                    data-credit-club="${P.escapeHtml(account.club_id)}"
                                    data-credit-name="${P.escapeHtml(account.club_name)}"
                                    data-credit-currency="${P.escapeHtml(
                                        account.currency_code || "GBP"
                                    )}"
                                >
                                    View activity
                                </button>
                            </div>
                        </article>
                    `;
                })
                .join("");
    }

    async function loadClubCredit() {
        try {
            const data =
                P.rows(
                    await P.rpc(
                        "member_get_club_credit_accounts"
                    )
                );

            renderClubCredit(data);
        } catch (error) {
            console.warn(
                "Paryx club-credit warning:",
                error
            );
            renderClubCredit([]);
        }
    }

    function renderCreditTransactions(rows, currency) {
        const safe =
            Array.isArray(rows)
                ? rows
                : [];

        if (!safe.length) {
            elements.creditTransactions.innerHTML = `
                <div class="empty">
                    No club-credit activity yet.
                </div>
            `;
            return;
        }

        elements.creditTransactions.innerHTML =
            safe
                .map(function (item) {
                    const amount =
                        Number(item.amount || 0);

                    const positive =
                        amount > 0;

                    return `
                        <div class="profile-credit-transaction">
                            <div>
                                <strong>
                                    ${P.escapeHtml(
                                        CREDIT_TYPE_LABELS[
                                            item.transaction_type
                                        ] ||
                                        item.transaction_type
                                    )}
                                </strong>

                                <span>
                                    ${P.escapeHtml(
                                        item.reference ||
                                        item.description ||
                                        "Club account"
                                    )}
                                </span>

                                <small>
                                    ${P.escapeHtml(
                                        formatExpiry(item.created_at)
                                    )}
                                </small>
                            </div>

                            <span class="profile-credit-transaction__amount ${
                                positive
                                    ? "profile-credit-transaction__amount--credit"
                                    : "profile-credit-transaction__amount--debit"
                            }">
                                ${positive ? "+" : ""}${P.escapeHtml(
                                    formatCreditMoney(
                                        amount,
                                        currency
                                    )
                                )}
                            </span>
                        </div>
                    `;
                })
                .join("");
    }

    async function openCreditActivity(
        clubId,
        clubName,
        currency
    ) {
        elements.creditDialogTitle.textContent =
            clubName || "Club credit";

        elements.creditTransactions.innerHTML = `
            <div class="empty">
                Loading activity…
            </div>
        `;

        elements.creditDialog.showModal();

        try {
            const rows =
                P.rows(
                    await P.rpc(
                        "member_get_club_credit_transactions",
                        {
                            p_club_id: clubId,
                            p_limit: 50
                        }
                    )
                );

            renderCreditTransactions(
                rows,
                currency
            );
        } catch (error) {
            elements.creditTransactions.innerHTML = `
                <div class="notice error">
                    ${P.escapeHtml(
                        P.readableError(error)
                    )}
                </div>
            `;
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

    elements.clubCredit.addEventListener(
        "click",
        function (event) {
            const button =
                event.target.closest(
                    "[data-credit-club]"
                );

            if (!button) {
                return;
            }

            openCreditActivity(
                button.dataset.creditClub,
                button.dataset.creditName,
                button.dataset.creditCurrency
            );
        }
    );

    elements.creditDialogClose.addEventListener(
        "click",
        function () {
            elements.creditDialog.close();
        }
    );

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

                await Promise.all([
                    loadMembershipNotices(),
                    loadClubCredit()
                ]);
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
