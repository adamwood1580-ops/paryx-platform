(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const STORAGE_PREFIX =
        "paryx_active_club";

    const STAFF_ROLES = new Set([
        "starter",
        "reception",
        "professional",
        "greenkeeper",
        "manager",
        "club_admin"
    ]);

    const ADMIN_ROLES = new Set([
        "manager",
        "club_admin"
    ]);

    let clubs = [];
    let activeClub = null;
    let currentUserId = null;
    let loadingPromise = null;

    function getClient() {
        if (
            window.supabaseClient &&
            typeof window.supabaseClient.rpc === "function"
        ) {
            return window.supabaseClient;
        }

        throw new Error(
            "The Paryx data service is unavailable."
        );
    }

    function storageKey(userId) {
        return `${STORAGE_PREFIX}:${userId}`;
    }

    function readStoredClubId(userId) {
        if (!userId) {
            return null;
        }

        try {
            return window.localStorage.getItem(
                storageKey(userId)
            );
        } catch (error) {
            console.warn(
                "Paryx could not read the saved club selection:",
                error
            );

            return null;
        }
    }

    function writeStoredClubId(
        userId,
        clubId
    ) {
        if (!userId || !clubId) {
            return;
        }

        try {
            window.localStorage.setItem(
                storageKey(userId),
                clubId
            );
        } catch (error) {
            console.warn(
                "Paryx could not save the club selection:",
                error
            );
        }
    }

    function normaliseClub(row) {
        const role =
            String(row?.staff_role || "")
                .trim()
                .toLowerCase();

        return {
            id:
                row?.club_id || null,

            name:
                row?.club_name || "Your club",

            slug:
                row?.club_slug || "",

            timezone:
                row?.club_timezone ||
                "Europe/London",

            membershipId:
                row?.membership_id || null,

            role,

            isPrimary:
                row?.is_primary === true,

            isAdmin:
                ADMIN_ROLES.has(role)
        };
    }

    function chooseActiveClub(
        availableClubs,
        userId
    ) {
        const savedId =
            readStoredClubId(userId);

        const saved =
            availableClubs.find(
                function (club) {
                    return club.id === savedId;
                }
            );

        if (saved) {
            return saved;
        }

        return (
            availableClubs.find(
                function (club) {
                    return club.isPrimary;
                }
            ) ||
            availableClubs[0] ||
            null
        );
    }

    function publishActiveClub() {
        window.Paryx.activeClub =
            activeClub;

        window.dispatchEvent(
            new CustomEvent(
                "paryx:club-changed",
                {
                    detail: {
                        club:
                            activeClub
                    }
                }
            )
        );
    }

    async function fetchStaffClubs() {
        const client =
            getClient();

        const {
            data,
            error
        } = await client.rpc(
            "get_my_staff_clubs"
        );

        if (error) {
            throw error;
        }

        return (
            Array.isArray(data)
                ? data
                : []
        )
            .map(normaliseClub)
            .filter(function (club) {
                return (
                    club.id &&
                    STAFF_ROLES.has(
                        club.role
                    )
                );
            });
    }

    async function load(options = {}) {
        const forceRefresh =
            options.forceRefresh === true;

        if (
            loadingPromise &&
            !forceRefresh
        ) {
            return loadingPromise;
        }

        loadingPromise =
            (async function () {
                if (!window.Paryx.ready) {
                    throw new Error(
                        "Paryx has not finished initialising."
                    );
                }

                const appContext =
                    await window.Paryx.ready;

                const userId =
                    appContext?.user?.id ||
                    appContext?.profile?.userId ||
                    null;

                if (!userId) {
                    throw new Error(
                        "Staff club access required."
                    );
                }

                const availableClubs =
                    await fetchStaffClubs();

                if (!availableClubs.length) {
                    clubs = [];
                    activeClub = null;
                    currentUserId = userId;
                    publishActiveClub();

                    throw new Error(
                        "Staff club access required."
                    );
                }

                currentUserId =
                    userId;

                clubs =
                    availableClubs;

                activeClub =
                    chooseActiveClub(
                        clubs,
                        userId
                    );

                writeStoredClubId(
                    userId,
                    activeClub.id
                );

                publishActiveClub();

                return {
                    clubs:
                        clubs.slice(),

                    activeClub:
                        { ...activeClub }
                };
            })();

        try {
            return await loadingPromise;
        } finally {
            loadingPromise = null;
        }
    }

    async function refresh() {
        return load({
            forceRefresh: true
        });
    }

    function getActiveClub() {
        return activeClub
            ? { ...activeClub }
            : null;
    }

    function getClubs() {
        return clubs.map(
            function (club) {
                return { ...club };
            }
        );
    }

    function setActiveClub(clubId) {
        const next =
            clubs.find(
                function (club) {
                    return club.id === clubId;
                }
            );

        if (!next) {
            throw new Error(
                "That club is not available to this account."
            );
        }

        if (
            activeClub?.id ===
            next.id
        ) {
            return getActiveClub();
        }

        activeClub =
            next;

        writeStoredClubId(
            currentUserId,
            activeClub.id
        );

        publishActiveClub();

        return getActiveClub();
    }

    function isAdminRole(role) {
        return ADMIN_ROLES.has(
            String(role || "")
                .trim()
                .toLowerCase()
        );
    }

    const ready =
        load();

    window.Paryx.clubContext = {
        ready,
        load,
        refresh,
        getActiveClub,
        getClubs,
        setActiveClub,
        isAdminRole
    };
})();
