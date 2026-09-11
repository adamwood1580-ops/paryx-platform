(function () {
    "use strict";

    const P = window.ParyxMember;

    const state = {
        context: null,
        clubs: [],
        linked: [],
        claimClub: null,
        timer: null,
        autoClaimDone: false
    };

    const elements = {
        message: document.getElementById("clubsMessage"),
        linkedCount: document.getElementById("linkedClubCount"),
        linked: document.getElementById("linkedClubs"),
        openSearch: document.getElementById("openClubSearch"),
        search: document.getElementById("clubSearch"),
        results: document.getElementById("clubSearchResults"),
        claimDialog: document.getElementById("claimDialog"),
        claimForm: document.getElementById("claimForm"),
        claimClubName: document.getElementById("claimClubName"),
        membershipNumber: document.getElementById("claimMembershipNumber"),
        claimMessage: document.getElementById("claimMessage"),
        submitClaim: document.getElementById("submitClaim"),
        closeClaim: document.getElementById("closeClaimDialog"),
        cancelClaim: document.getElementById("cancelClaim"),
        cardDialog: document.getElementById("cardDialog"),
        cardTitle: document.getElementById("cardDialogTitle"),
        card: document.getElementById("membershipCard"),
        closeCard: document.getElementById("closeCardDialog"),
        infoDialog: document.getElementById("clubInfoDialog"),
        infoTitle: document.getElementById("clubInfoTitle"),
        info: document.getElementById("clubInfoContent"),
        closeInfo: document.getElementById("closeClubInfoDialog")
    };

    function showMessage(text, type) {
        elements.message.textContent = text;
        elements.message.className = `notice ${type || ""}`;
        elements.message.hidden = false;
    }

    function clearMessage() {
        elements.message.hidden = true;
        elements.message.textContent = "";
    }

    function showClaimMessage(text, type) {
        elements.claimMessage.textContent = text;
        elements.claimMessage.className = `notice ${type || ""}`;
        elements.claimMessage.hidden = false;
    }

    function formatDate(value) {
        if (!value) return "—";
        const date = P.parseDate(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric"
        }).format(date);
    }

    function typeLabel(value) {
        return String(value || "member")
            .replaceAll("_", " ")
            .replace(/\b\w/g, function (character) {
                return character.toUpperCase();
            });
    }

    function clubInitial(name) {
        return String(name || "C").trim().charAt(0).toUpperCase() || "C";
    }

    function selectedClubId() {
        return P.selectedClubId();
    }

    function renderLinked() {
        elements.linkedCount.textContent = `${state.linked.length} linked ${state.linked.length === 1 ? "club" : "clubs"}`;

        if (!state.linked.length) {
            elements.linked.innerHTML = `
                <div class="empty">
                    You have not linked a club membership yet. Search for your club below and use your membership number to verify it.
                </div>
            `;
            return;
        }

        const selected = selectedClubId();

        elements.linked.innerHTML = state.linked.map(function (club) {
            const memberMeta = [
                club.membership_number ? `Member ${club.membership_number}` : "Member",
                typeLabel(club.membership_type),
                club.handicap_index !== null && club.handicap_index !== undefined
                    ? `HI ${club.handicap_index}`
                    : null
            ].filter(Boolean).join(" · ");

            return `
                <article class="card club-service-card" data-linked-club="${P.escapeHtml(club.club_id)}">
                    <div class="club-service-card__top">
                        <div class="club-logo" aria-hidden="true">${P.escapeHtml(clubInitial(club.club_name))}</div>
                        <div class="club-service-card__identity">
                            <strong>${P.escapeHtml(club.club_name)}</strong>
                            <span>${P.escapeHtml(memberMeta)}</span>
                        </div>
                        ${selected === club.club_id ? '<span class="badge">Selected</span>' : '<span class="badge club-service-card__member-badge">Member</span>'}
                    </div>
                    <div class="club-service-card__actions">
                        <button class="button secondary" type="button" data-use-club="${P.escapeHtml(club.club_id)}">Use club</button>
                        <button class="button secondary" type="button" data-card-club="${P.escapeHtml(club.club_id)}">Membership card</button>
                        <button class="button secondary" type="button" data-info-club="${P.escapeHtml(club.club_id)}">Club info</button>
                    </div>
                </article>
            `;
        }).join("");
    }

    function renderSearchResults() {
        if (!state.clubs.length) {
            elements.results.innerHTML = '<div class="empty">No matching clubs found.</div>';
            return;
        }

        elements.results.innerHTML = state.clubs.map(function (club) {
            const location = [club.town_city, club.county_region].filter(Boolean).join(", ") || `${club.active_course_count || 0} active course(s)`;
            const action = club.is_member
                ? `<span class="badge">Member</span>`
                : `<button type="button" class="button secondary club-search-link" data-claim-club="${P.escapeHtml(club.club_id)}">I'm a member</button>`;

            return `
                <article class="club club-search-row">
                    <div class="club-logo" aria-hidden="true">${P.escapeHtml(clubInitial(club.club_name))}</div>
                    <div>
                        <strong>${P.escapeHtml(club.club_name)}</strong>
                        <span>${P.escapeHtml(location)}</span>
                    </div>
                    ${action}
                </article>
            `;
        }).join("");
    }

    async function loadLinked() {
        state.linked = P.rows(
            await P.rpc("player_get_my_clubs")
        );
        renderLinked();
    }

    async function loadClubs(query) {
        state.clubs = P.rows(await P.rpc("player_list_clubs_v2", {
            p_search: String(query || "").trim() || null
        }));
        renderSearchResults();
        maybeOpenAutoClaim();
    }

    async function refreshAll() {
        await Promise.all([
            loadLinked(),
            loadClubs(elements.search.value)
        ]);
    }

    function openClaim(clubId) {
        const club = state.clubs.find(function (item) {
            return item.club_id === clubId;
        });

        if (!club || club.is_member) return;

        state.claimClub = club;
        elements.claimClubName.textContent = club.club_name;
        elements.membershipNumber.value = "";
        elements.claimMessage.hidden = true;
        elements.submitClaim.disabled = false;
        elements.submitClaim.textContent = "Link membership";
        elements.claimDialog.showModal();
        window.setTimeout(function () {
            elements.membershipNumber.focus();
        }, 50);
    }

    function closeClaim() {
        state.claimClub = null;
        if (elements.claimDialog.open) elements.claimDialog.close();
    }

    async function submitClaim(event) {
        event.preventDefault();
        if (!state.claimClub) return;

        elements.submitClaim.disabled = true;
        elements.submitClaim.textContent = "Verifying…";
        elements.claimMessage.hidden = true;

        try {
            const result = await P.rpc("player_claim_club_membership", {
                p_club_id: state.claimClub.club_id,
                p_membership_number: elements.membershipNumber.value
            });

            if (result?.status !== "linked") {
                showClaimMessage(
                    result?.message || "We could not automatically verify those membership details.",
                    "error"
                );
                return;
            }

            const linkedClubName = result.club_name || state.claimClub.club_name;
            const linkedClubId = result.club_id || state.claimClub.club_id;
            P.setSelectedClubId(linkedClubId);
            closeClaim();
            clearMessage();
            showMessage(`${linkedClubName} membership linked successfully.`, "success");
            await refreshAll();
        } catch (error) {
            showClaimMessage(P.readableError(error), "error");
        } finally {
            elements.submitClaim.disabled = false;
            elements.submitClaim.textContent = "Link membership";
        }
    }

    function safeUrl(value) {
        try {
            const url = new URL(String(value || ""));
            if (url.protocol === "http:" || url.protocol === "https:") return url.href;
        } catch (error) {
            return "";
        }
        return "";
    }

    async function loadClubService(clubId) {
        return await P.rpc("player_get_club_services", {
            p_club_id: clubId
        });
    }

    function renderMembershipCard(data) {
        const club = data?.club || {};
        const membership = data?.membership || {};
        const profile = state.context?.profile || {};
        const playerName = membership.member_name || profile.display_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Paryx Player";

        elements.cardTitle.textContent = club.club_name || "Membership card";
        elements.card.innerHTML = `
            <article class="digital-membership-card" style="--card-primary:${P.escapeHtml(club.primary_color || "#064831")};--card-accent:${P.escapeHtml(club.accent_color || "#E5C45F")}">
                <div class="digital-membership-card__brand">
                    <span>Paryx</span>
                    <small>Digital membership card</small>
                </div>
                <div class="digital-membership-card__club">${P.escapeHtml(club.club_name || "Club")}</div>
                <div class="digital-membership-card__name">${P.escapeHtml(playerName)}</div>
                <div class="digital-membership-card__grid">
                    <div><span>Member no.</span><strong>${P.escapeHtml(membership.membership_number || "—")}</strong></div>
                    <div><span>Type</span><strong>${P.escapeHtml(typeLabel(membership.membership_type))}</strong></div>
                    <div><span>Handicap Index</span><strong>${P.escapeHtml(membership.handicap_index ?? "—")}</strong></div>
                    <div><span>Renewal</span><strong>${P.escapeHtml(formatDate(membership.renewal_date))}</strong></div>
                </div>
                <div class="digital-membership-card__reference">
                    <span>Card reference</span>
                    <strong>${P.escapeHtml(membership.card_reference || "—")}</strong>
                </div>
            </article>
        `;
    }

    async function openCard(clubId) {
        elements.card.innerHTML = '<div class="empty">Loading card…</div>';
        elements.cardDialog.showModal();
        try {
            const data = await loadClubService(clubId);
            renderMembershipCard(data);
        } catch (error) {
            elements.card.innerHTML = `<div class="notice error">${P.escapeHtml(P.readableError(error))}</div>`;
        }
    }

    function eventTime(event) {
        return event.time_text || P.shortTime(event.start_time) || "All day";
    }

    function renderClubInfo(data) {
        const club = data?.club || {};
        const membership = data?.membership || {};
        const courses = Array.isArray(data?.courses) ? data.courses : [];
        const events = Array.isArray(data?.upcoming_events) ? data.upcoming_events : [];
        const address = [club.address_line_1, club.address_line_2, club.town_city, club.county_region, club.postcode].filter(Boolean).join(", ");
        const website = safeUrl(club.website_url);

        elements.infoTitle.textContent = club.club_name || "Club information";
        elements.info.innerHTML = `
            <div class="stack">
                <article class="card club-info-membership">
                    <p class="kicker">Your membership</p>
                    <h3>${P.escapeHtml(membership.membership_number ? `Member ${membership.membership_number}` : typeLabel(membership.membership_type))}</h3>
                    <p class="meta">${P.escapeHtml(typeLabel(membership.membership_type))}${membership.renewal_date ? ` · Renews ${P.escapeHtml(formatDate(membership.renewal_date))}` : ""}</p>
                </article>

                <article class="card">
                    <p class="kicker">Club details</p>
                    <h3>${P.escapeHtml(club.club_name || "Club")}</h3>
                    ${address ? `<p class="meta">${P.escapeHtml(address)}</p>` : ""}
                    ${club.phone ? `<p class="meta"><strong>Phone:</strong> ${P.escapeHtml(club.phone)}</p>` : ""}
                    ${club.contact_email ? `<p class="meta"><strong>Email:</strong> ${P.escapeHtml(club.contact_email)}</p>` : ""}
                    ${website ? `<p class="meta"><a href="${P.escapeHtml(website)}" target="_blank" rel="noopener">Visit club website</a></p>` : ""}
                </article>

                <article class="card">
                    <p class="kicker">Courses</p>
                    ${courses.length ? courses.map(function (course) {
                        return `<div class="club-info-line"><strong>${P.escapeHtml(course.course_name)}</strong><span>${P.escapeHtml(course.holes ? `${course.holes} holes` : "Course")}</span></div>`;
                    }).join("") : '<p class="meta">No active course information available.</p>'}
                </article>

                <article class="card">
                    <p class="kicker">Coming up</p>
                    ${events.length ? events.map(function (event) {
                        return `<div class="club-info-line"><strong>${P.escapeHtml(event.title)}</strong><span>${P.escapeHtml(`${P.formatDay(event.event_date)} · ${eventTime(event)}`)}</span></div>`;
                    }).join("") : '<p class="meta">No upcoming published club events.</p>'}
                </article>
            </div>
        `;
    }

    async function openInfo(clubId) {
        elements.info.innerHTML = '<div class="empty">Loading club information…</div>';
        elements.infoDialog.showModal();
        try {
            const data = await loadClubService(clubId);
            renderClubInfo(data);
        } catch (error) {
            elements.info.innerHTML = `<div class="notice error">${P.escapeHtml(P.readableError(error))}</div>`;
        }
    }

    function useClub(clubId) {
        P.setSelectedClubId(clubId);
        renderLinked();
        const club = state.linked.find(function (item) {
            return item.club_id === clubId;
        });
        showMessage(`${club?.club_name || "Club"} selected for booking and member services.`, "success");
    }

    function maybeOpenAutoClaim() {
        if (state.autoClaimDone) return;
        const params = new URLSearchParams(window.location.search);
        const clubId = params.get("club");
        const claim = params.get("claim");
        if (!clubId || claim !== "1") return;
        const club = state.clubs.find(function (item) {
            return item.club_id === clubId;
        });
        if (!club) return;
        state.autoClaimDone = true;
        if (club.is_member) {
            showMessage(`${club.club_name} is already linked to your Paryx account.`, "success");
            return;
        }
        openClaim(clubId);
    }

    function bind() {
        elements.openSearch.addEventListener("click", function () {
            elements.search.scrollIntoView({ behavior: "smooth", block: "center" });
            window.setTimeout(function () { elements.search.focus(); }, 350);
        });

        elements.search.addEventListener("input", function () {
            window.clearTimeout(state.timer);
            state.timer = window.setTimeout(function () {
                loadClubs(elements.search.value).catch(function (error) {
                    showMessage(P.readableError(error), "error");
                });
            }, 220);
        });

        elements.results.addEventListener("click", function (event) {
            const button = event.target.closest("[data-claim-club]");
            if (button) openClaim(button.dataset.claimClub);
        });

        elements.linked.addEventListener("click", function (event) {
            const use = event.target.closest("[data-use-club]");
            const card = event.target.closest("[data-card-club]");
            const info = event.target.closest("[data-info-club]");
            if (use) useClub(use.dataset.useClub);
            if (card) openCard(card.dataset.cardClub);
            if (info) openInfo(info.dataset.infoClub);
        });

        elements.claimForm.addEventListener("submit", submitClaim);
        elements.closeClaim.addEventListener("click", closeClaim);
        elements.cancelClaim.addEventListener("click", closeClaim);
        elements.closeCard.addEventListener("click", function () { elements.cardDialog.close(); });
        elements.closeInfo.addEventListener("click", function () { elements.infoDialog.close(); });
    }

    P.ready.then(async function (context) {
        state.context = context;
        bind();
        await refreshAll();
    }).catch(function (error) {
        elements.linked.innerHTML = `<div class="notice error">${P.escapeHtml(P.readableError(error))}</div>`;
        elements.results.innerHTML = "";
    });
})();
