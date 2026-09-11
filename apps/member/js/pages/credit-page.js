(function () {
    "use strict";

    const P = window.ParyxMember;
    const state = { accounts: [] };

    const elements = {
        message: document.getElementById("creditMessage"),
        count: document.getElementById("creditAccountCount"),
        accounts: document.getElementById("creditAccounts"),
        activitySection: document.getElementById("creditActivitySection"),
        activityTitle: document.getElementById("creditActivityTitle"),
        activity: document.getElementById("creditActivity")
    };

    const typeLabels = {
        competition_prize: "Competition prize",
        manual_credit: "Club credit",
        manual_debit: "Credit spent",
        epos_purchase: "Club purchase",
        refund: "Refund",
        adjustment: "Adjustment"
    };

    function money(value, currency) {
        return new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: String(currency || "GBP")
        }).format(Number(value || 0));
    }

    function formatTimestamp(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }

    function showMessage(text, type) {
        elements.message.textContent = text;
        elements.message.className = `notice ${type || ""}`;
        elements.message.hidden = false;
    }

    function renderAccounts() {
        elements.count.textContent = `${state.accounts.length} club ${state.accounts.length === 1 ? "account" : "accounts"}`;

        if (!state.accounts.length) {
            elements.accounts.innerHTML = `
                <div class="empty">
                    No Club Credit accounts are available yet. A linked club may not have Club Credit enabled, or you may not have received any credit there yet.
                </div>
            `;
            return;
        }

        elements.accounts.innerHTML = state.accounts.map(function (account, index) {
            return `
                <button class="card credit-page-card" type="button" data-credit-club="${P.escapeHtml(account.club_id)}">
                    <div>
                        <p class="kicker">${P.escapeHtml(account.club_name)}</p>
                        <strong>${P.escapeHtml(money(account.balance, account.currency_code))}</strong>
                        <span>${P.escapeHtml(`${account.transaction_count || 0} transaction${Number(account.transaction_count || 0) === 1 ? "" : "s"}`)}</span>
                    </div>
                    <span class="credit-page-card__action">${index === 0 ? "View activity" : "Open"} ›</span>
                </button>
            `;
        }).join("");
    }

    function renderTransactions(rows, account) {
        const safe = Array.isArray(rows) ? rows : [];
        elements.activityTitle.textContent = `${account.club_name} activity`;
        elements.activitySection.hidden = false;

        if (!safe.length) {
            elements.activity.innerHTML = '<div class="empty">No Club Credit transactions yet.</div>';
            return;
        }

        elements.activity.innerHTML = safe.map(function (item) {
            const amount = Number(item.amount || 0);
            return `
                <div class="profile-credit-transaction">
                    <div>
                        <strong>${P.escapeHtml(typeLabels[item.transaction_type] || item.transaction_type || "Club Credit")}</strong>
                        <span>${P.escapeHtml(item.reference || item.description || "Club account")}</span>
                        <small>${P.escapeHtml(formatTimestamp(item.created_at))}</small>
                    </div>
                    <span class="profile-credit-transaction__amount ${amount >= 0 ? "profile-credit-transaction__amount--credit" : "profile-credit-transaction__amount--debit"}">
                        ${amount > 0 ? "+" : ""}${P.escapeHtml(money(amount, item.currency_code || account.currency_code))}
                    </span>
                </div>
            `;
        }).join("");

        elements.activitySection.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function openAccount(clubId) {
        const account = state.accounts.find(function (item) { return item.club_id === clubId; });
        if (!account) return;

        elements.activityTitle.textContent = `${account.club_name} activity`;
        elements.activitySection.hidden = false;
        elements.activity.innerHTML = '<div class="empty">Loading activity…</div>';

        try {
            const rows = P.rows(await P.rpc("member_get_club_credit_transactions", {
                p_club_id: clubId,
                p_limit: 100
            }));
            renderTransactions(rows, account);
        } catch (error) {
            elements.activity.innerHTML = `<div class="notice error">${P.escapeHtml(P.readableError(error))}</div>`;
        }
    }

    async function load() {
        state.accounts = P.rows(await P.rpc("member_get_club_credit_accounts"));
        renderAccounts();
        if (state.accounts.length === 1) {
            await openAccount(state.accounts[0].club_id);
        }
    }

    elements.accounts.addEventListener("click", function (event) {
        const button = event.target.closest("[data-credit-club]");
        if (button) openAccount(button.dataset.creditClub);
    });

    P.ready.then(load).catch(function (error) {
        elements.accounts.innerHTML = "";
        showMessage(P.readableError(error), "error");
    });
})();
