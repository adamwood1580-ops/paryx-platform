(function () {
    "use strict";

    const P = window.ParyxMember;
    const state = {
        notifications: [],
        alerts: []
    };

    const elements = {
        message: document.getElementById("notificationMessage"),
        count: document.getElementById("notificationCount"),
        list: document.getElementById("notificationList"),
        alerts: document.getElementById("alertList"),
        markAll: document.getElementById("markAllRead")
    };

    function showMessage(text, type) {
        elements.message.textContent = text;
        elements.message.className = `notice ${type || ""}`;
        elements.message.hidden = false;
    }

    function clearMessage() {
        elements.message.hidden = true;
    }

    function relativeDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";

        const diff = Date.now() - date.getTime();
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;

        if (diff < minute) return "Just now";
        if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
        if (diff < day) return `${Math.floor(diff / hour)}h ago`;
        if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;

        return new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short"
        }).format(date);
    }

    function notificationIcon(type) {
        if (type === "tee_time_available") return "◷";
        if (type === "booking_confirmed" || type === "booking_joined") return "✓";
        return "•";
    }

    function renderNotifications() {
        const unread = state.notifications.filter(function (item) {
            return !item.read_at;
        }).length;

        elements.count.textContent = state.notifications.length
            ? `${unread} unread · ${state.notifications.length} shown`
            : "No notifications";

        elements.markAll.disabled = unread === 0;

        if (!state.notifications.length) {
            elements.list.innerHTML = `
                <div class="empty">
                    You have no notifications yet. Booking confirmations and tee-time availability will appear here.
                </div>
            `;
            return;
        }

        elements.list.innerHTML = state.notifications.map(function (item) {
            const action = item.action_url
                ? `data-action-url="${P.escapeHtml(item.action_url)}"`
                : "";

            return `
                <button
                    class="notification-card ${item.read_at ? "" : "notification-card--unread"}"
                    type="button"
                    data-notification-id="${P.escapeHtml(item.notification_id)}"
                    ${action}
                >
                    <span class="notification-card__icon" aria-hidden="true">${P.escapeHtml(notificationIcon(item.notification_type))}</span>
                    <span class="notification-card__body">
                        <span class="notification-card__topline">
                            <strong>${P.escapeHtml(item.title)}</strong>
                            <small>${P.escapeHtml(relativeDate(item.created_at))}</small>
                        </span>
                        ${item.body ? `<span>${P.escapeHtml(item.body)}</span>` : ""}
                        ${item.club_name ? `<small>${P.escapeHtml(item.club_name)}</small>` : ""}
                    </span>
                    ${item.read_at ? "" : '<span class="notification-card__dot" aria-label="Unread"></span>'}
                </button>
            `;
        }).join("");
    }

    function renderAlerts() {
        const active = state.alerts.filter(function (item) {
            return item.alert_status === "active";
        });

        if (!state.alerts.length) {
            elements.alerts.innerHTML = `
                <div class="empty">
                    You are not watching any tee times. When a time is full, use <strong>Alert me</strong> from the booking screen.
                </div>
            `;
            return;
        }

        elements.alerts.innerHTML = state.alerts.map(function (item) {
            const activeAlert = item.alert_status === "active";
            const status = activeAlert ? "Watching" : "Notified";
            const party = Number(item.requested_places || 1);

            return `
                <article class="card tee-alert-card ${activeAlert ? "" : "tee-alert-card--notified"}">
                    <div>
                        <p class="kicker">${P.escapeHtml(item.club_name)}</p>
                        <h3>${P.escapeHtml(P.longDay(item.play_date))} · ${P.escapeHtml(P.shortTime(item.start_time))}</h3>
                        <p class="meta">${P.escapeHtml(item.course_name)} · ${party} ${party === 1 ? "place" : "places"}</p>
                    </div>
                    <div class="tee-alert-card__actions">
                        <span class="badge">${P.escapeHtml(status)}</span>
                        ${activeAlert
                            ? `<button class="button secondary" type="button" data-cancel-alert="${P.escapeHtml(item.alert_id)}">Cancel</button>`
                            : `<a class="button secondary" href="${P.escapeHtml(item.action_url)}">View time</a>`}
                    </div>
                </article>
            `;
        }).join("");

        if (active.length === 0) {
            elements.alerts.insertAdjacentHTML(
                "beforeend",
                '<p class="notification-footnote">No active watches remain. Notified alerts are kept here briefly for reference.</p>'
            );
        }
    }

    async function loadNotifications() {
        const data = await P.rpc("player_list_notifications", {
            p_limit: 50,
            p_offset: 0
        });
        state.notifications = Array.isArray(data) ? data : [];
        renderNotifications();
    }

    async function loadAlerts() {
        const data = await P.rpc("player_list_tee_time_alerts");
        state.alerts = Array.isArray(data) ? data : [];
        renderAlerts();
    }

    async function refresh() {
        clearMessage();
        await Promise.all([
            loadNotifications(),
            loadAlerts()
        ]);
        window.dispatchEvent(new CustomEvent("paryx:notifications-changed"));
    }

    async function openNotification(button) {
        const id = button.dataset.notificationId;
        const url = button.dataset.actionUrl || "";

        if (id) {
            try {
                await P.rpc("player_mark_notification_read", {
                    p_notification_id: id
                });
            } catch (error) {
                console.warn("Could not mark notification read:", error);
            }
        }

        if (url) {
            window.location.href = url;
            return;
        }

        await refresh();
    }

    async function cancelAlert(id) {
        try {
            await P.rpc("player_cancel_tee_time_alert", {
                p_alert_id: id
            });
            showMessage("Tee-time alert cancelled.", "success");
            await refresh();
        } catch (error) {
            showMessage(P.readableError(error), "error");
        }
    }

    function bind() {
        elements.list.addEventListener("click", function (event) {
            const button = event.target.closest("[data-notification-id]");
            if (button) openNotification(button);
        });

        elements.alerts.addEventListener("click", function (event) {
            const button = event.target.closest("[data-cancel-alert]");
            if (button) cancelAlert(button.dataset.cancelAlert);
        });

        elements.markAll.addEventListener("click", async function () {
            elements.markAll.disabled = true;
            try {
                await P.rpc("player_mark_all_notifications_read");
                await refresh();
            } catch (error) {
                showMessage(P.readableError(error), "error");
            } finally {
                elements.markAll.disabled = false;
            }
        });
    }

    P.ready.then(async function () {
        bind();
        await refresh();

        window.setInterval(function () {
            if (!document.hidden) {
                refresh().catch(function (error) {
                    console.warn("Paryx notification refresh warning:", error);
                });
            }
        }, 60000);
    }).catch(function (error) {
        elements.list.innerHTML = `<div class="notice error">${P.escapeHtml(P.readableError(error))}</div>`;
        elements.alerts.innerHTML = "";
    });
})();
