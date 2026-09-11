(function () {
    "use strict";

    const P = window.ParyxMember;
    const greeting = document.getElementById("greeting");
    const tier = document.getElementById("tierBadge");
    const nextBooking = document.getElementById("nextBooking");
    const clubs = document.getElementById("clubs");
    const latestSection = document.getElementById("latestResultSection");
    const latestResult = document.getElementById("latestResult");

    function ordinal(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 1) return "";
        const mod100 = number % 100;
        const suffix = mod100 >= 11 && mod100 <= 13
            ? "th"
            : number % 10 === 1
                ? "st"
                : number % 10 === 2
                    ? "nd"
                    : number % 10 === 3
                        ? "rd"
                        : "th";
        return `${number}${suffix}`;
    }

    function latestScore(row) {
        const result = row?.player_result;
        if (!result) return "View the leaderboard";
        const bits = [];
        if (result.placing) bits.push(`You finished ${ordinal(result.placing)}`);
        if (result.points !== null && result.points !== undefined) bits.push(`${result.points} pts`);
        else if (result.nett_score !== null && result.nett_score !== undefined) bits.push(`Nett ${result.nett_score}`);
        else if (result.gross_score !== null && result.gross_score !== undefined) bits.push(`Gross ${result.gross_score}`);
        return bits.join(" · ") || "View your result";
    }

    function renderClubs(memberClubs) {
        const safe = Array.isArray(memberClubs) ? memberClubs : [];
        if (!safe.length) {
            clubs.innerHTML = `
                <div class="empty">
                    No club membership is linked yet. <a href="clubs.html">Link your club membership</a> or book as a visitor at any Paryx club.
                </div>
            `;
            return;
        }

        clubs.innerHTML = safe.map(function (club) {
            return `
                <a class="club home-club-link" href="clubs.html">
                    <div class="club-logo">${P.escapeHtml(String(club.club_name || "C").charAt(0).toUpperCase())}</div>
                    <div>
                        <strong>${P.escapeHtml(club.club_name)}</strong>
                        <span>${P.escapeHtml(club.membership_number ? `Member ${club.membership_number}` : "Member access")}</span>
                    </div>
                    <span class="badge">Member</span>
                </a>
            `;
        }).join("");
    }

    async function loadBooking() {
        try {
            const booking = P.rows(await P.rpc("member_get_upcoming_bookings_v2", { p_limit: 1 }))[0];
            nextBooking.innerHTML = booking
                ? `
                    <a href="booking.html#my-bookings" class="card accent home-feature-card">
                        <p class="kicker">${P.escapeHtml(booking.club_name)}</p>
                        <h3>${P.escapeHtml(P.longDay(booking.play_date))} · ${P.escapeHtml(P.shortTime(booking.start_time))}</h3>
                        <p class="meta">${P.escapeHtml(booking.course_name)} · ${P.escapeHtml((booking.player_names || []).join(", "))}</p>
                        ${booking.checked_in_at ? '<span class="badge">Checked in</span>' : ''}
                    </a>
                `
                : '<div class="empty">No upcoming booking. <a href="booking.html">Book a tee time</a>.</div>';
        } catch (error) {
            nextBooking.innerHTML = '<div class="empty">Could not load your next booking.</div>';
        }
    }

    async function loadLatestResult(memberClubs) {
        if (!Array.isArray(memberClubs) || !memberClubs.length) {
            latestSection.hidden = true;
            return;
        }

        try {
            const rows = await P.rpc("player_list_competition_results", {
                p_club_id: null,
                p_limit: 1,
                p_offset: 0
            });
            const row = Array.isArray(rows) ? rows[0] : null;
            if (!row) {
                latestSection.hidden = true;
                return;
            }

            latestSection.hidden = false;
            latestResult.innerHTML = `
                <a class="card accent home-feature-card" href="results.html">
                    <p class="kicker">${P.escapeHtml(row.club_name)} · ${P.escapeHtml(P.formatDay(row.competition_date))}</p>
                    <h3>${P.escapeHtml(row.competition_name)}</h3>
                    <p class="meta">${P.escapeHtml(latestScore(row))}</p>
                </a>
            `;
        } catch (error) {
            latestSection.hidden = true;
        }
    }

    P.ready.then(async function (context) {
        const first = context.profile.first_name || String(context.profile.display_name || "Player").split(" ")[0];
        const hour = new Date().getHours();
        greeting.textContent = `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${first}`;
        tier.textContent = context.entitlement.scorecard_access ? "Tier 2" : "Free";
        renderClubs(context.memberClubs);
        await Promise.all([
            loadBooking(),
            loadLatestResult(context.memberClubs)
        ]);
    }).catch(function (error) {
        console.error(error);
        clubs.innerHTML = '<div class="empty">Could not load your club memberships.</div>';
    });
})();
