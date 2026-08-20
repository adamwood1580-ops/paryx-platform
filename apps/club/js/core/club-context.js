(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const STORAGE_PREFIX =
        "paryx_active_club";

    const BRANDING_BUCKET =
        "club-branding";

    const DEFAULT_BRANDING = {
        primaryColor: "#064831",
        secondaryColor: "#022D1D",
        accentColor: "#E5C45F"
    };

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

    function clone(value) {
        if (value === null || value === undefined) {
            return value;
        }

        return JSON.parse(
            JSON.stringify(value)
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
                ADMIN_ROLES.has(role),

            settings: {},

            branding: {
                logoPath: null,
                logoUrl: null,
                ...DEFAULT_BRANDING
            }
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

    function publicLogoUrl(path) {
        if (!path) {
            return null;
        }

        try {
            const client =
                getClient();

            const result =
                client.storage
                    .from(BRANDING_BUCKET)
                    .getPublicUrl(path);

            return (
                result?.data?.publicUrl ||
                null
            );
        } catch (error) {
            console.warn(
                "Paryx could not resolve the club logo:",
                error
            );

            return null;
        }
    }

    function normaliseConfiguration(row) {
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

            settings: {
                shortName:
                    row?.short_name || "",

                websiteUrl:
                    row?.website_url || "",

                contactEmail:
                    row?.contact_email || "",

                phone:
                    row?.phone || "",

                addressLine1:
                    row?.address_line_1 || "",

                addressLine2:
                    row?.address_line_2 || "",

                townCity:
                    row?.town_city || "",

                countyRegion:
                    row?.county_region || "",

                postcode:
                    row?.postcode || "",

                countryCode:
                    row?.country_code || "GB",

                currencyCode:
                    row?.currency_code || "GBP",

                defaultCourseId:
                    row?.default_course_id || null,

                defaultCourseName:
                    row?.default_course_name || ""
            },

            branding: {
                logoPath:
                    row?.logo_path || null,

                logoUrl:
                    publicLogoUrl(
                        row?.logo_path || null
                    ),

                primaryColor:
                    row?.primary_color ||
                    DEFAULT_BRANDING.primaryColor,

                secondaryColor:
                    row?.secondary_color ||
                    DEFAULT_BRANDING.secondaryColor,

                accentColor:
                    row?.accent_color ||
                    DEFAULT_BRANDING.accentColor
            }
        };
    }

    function hexToRgb(hex) {
        const normalised =
            String(hex || "")
                .replace("#", "")
                .trim();

        if (!/^[0-9a-fA-F]{6}$/.test(normalised)) {
            return null;
        }

        return {
            r: parseInt(normalised.slice(0, 2), 16),
            g: parseInt(normalised.slice(2, 4), 16),
            b: parseInt(normalised.slice(4, 6), 16)
        };
    }

    function rgbToHex(rgb) {
        return (
            "#" +
            [rgb.r, rgb.g, rgb.b]
                .map(function (value) {
                    return Math.max(
                        0,
                        Math.min(
                            255,
                            Math.round(value)
                        )
                    )
                        .toString(16)
                        .padStart(2, "0");
                })
                .join("")
        );
    }

    function mixHex(
        source,
        target,
        amount
    ) {
        const a = hexToRgb(source);
        const b = hexToRgb(target);

        if (!a || !b) {
            return source;
        }

        return rgbToHex({
            r:
                a.r +
                (b.r - a.r) * amount,

            g:
                a.g +
                (b.g - a.g) * amount,

            b:
                a.b +
                (b.b - a.b) * amount
        });
    }

    function applyBranding(club) {
        const branding =
            club?.branding ||
            DEFAULT_BRANDING;

        const primary =
            branding.primaryColor ||
            DEFAULT_BRANDING.primaryColor;

        const secondary =
            branding.secondaryColor ||
            DEFAULT_BRANDING.secondaryColor;

        const accent =
            branding.accentColor ||
            DEFAULT_BRANDING.accentColor;

        const root =
            document.documentElement;

        root.style.setProperty(
            "--color-primary",
            primary
        );

        root.style.setProperty(
            "--color-primary-dark",
            secondary
        );

        root.style.setProperty(
            "--color-primary-light",
            mixHex(primary, "#FFFFFF", 0.9)
        );

        root.style.setProperty(
            "--color-accent",
            accent
        );

        root.style.setProperty(
            "--color-accent-dark",
            mixHex(accent, "#000000", 0.24)
        );

        root.style.setProperty(
            "--color-accent-light",
            mixHex(accent, "#FFFFFF", 0.78)
        );

        const primaryRgb =
            hexToRgb(primary);

        if (primaryRgb) {
            root.style.setProperty(
                "--color-border-brand",
                `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.14)`
            );

            root.style.setProperty(
                "--shadow-brand",
                `0 9px 24px rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.18)`
            );
        }

        const themeMeta =
            document.querySelector(
                'meta[name="theme-color"]'
            );

        if (themeMeta) {
            themeMeta.setAttribute(
                "content",
                secondary
            );
        }
    }

    function publishActiveClub() {
        applyBranding(activeClub);

        window.Paryx.activeClub =
            clone(activeClub);

        window.dispatchEvent(
            new CustomEvent(
                "paryx:club-changed",
                {
                    detail: {
                        club:
                            clone(activeClub)
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

    async function fetchConfiguration(
        clubId
    ) {
        const client =
            getClient();

        const {
            data,
            error
        } = await client.rpc(
            "get_club_configuration",
            {
                p_club_id:
                    clubId
            }
        );

        if (error) {
            throw error;
        }

        const row =
            Array.isArray(data)
                ? data[0]
                : data;

        if (!row) {
            throw new Error(
                "The selected club configuration could not be loaded."
            );
        }

        return normaliseConfiguration(row);
    }

    async function hydrateClub(club) {
        const configuration =
            await fetchConfiguration(
                club.id
            );

        return {
            ...club,
            name:
                configuration.name ||
                club.name,
            slug:
                configuration.slug ||
                club.slug,
            timezone:
                configuration.timezone ||
                club.timezone,
            settings:
                configuration.settings,
            branding:
                configuration.branding
        };
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

                const selectedClub =
                    chooseActiveClub(
                        clubs,
                        userId
                    );

                activeClub =
                    await hydrateClub(
                        selectedClub
                    );

                clubs = clubs.map(
                    function (club) {
                        if (
                            club.id ===
                            activeClub.id
                        ) {
                            return {
                                ...club,
                                name:
                                    activeClub.name,
                                timezone:
                                    activeClub.timezone
                            };
                        }

                        return club;
                    }
                );

                writeStoredClubId(
                    userId,
                    activeClub.id
                );

                publishActiveClub();

                return {
                    clubs:
                        clone(clubs),

                    activeClub:
                        clone(activeClub)
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
        return clone(activeClub);
    }

    function getClubs() {
        return clone(clubs) || [];
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
        isAdminRole,
        applyBranding,
        publicLogoUrl
    };
})();
