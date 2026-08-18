(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    let cachedProfile = null;
    let cachedUserId = null;
    let loadingPromise = null;
    let loadingUserId = null;

    function normaliseProfileData(
        user,
        profile,
        membership,
        handicap
    ) {
        const club =
            membership?.clubs || null;

        return {
            userId:
                user.id,

            email:
                user.email || "",

            firstName:
                profile?.first_name || "",

            lastName:
                profile?.last_name || "",

            displayName:
                profile?.display_name ||
                [
                    profile?.first_name,
                    profile?.last_name
                ]
                    .filter(Boolean)
                    .join(" ")
                    .trim() ||
                user.email ||
                "User",

            phone:
                profile?.phone || "",

            avatarUrl:
                profile?.avatar_url || null,

            club: club
                ? {
                    id:
                        club.id,

                    name:
                        club.name
                }
                : null,

            membership: membership
                ? {
                    id:
                        membership.id,

                    number:
                        membership.membership_number ||
                        "",

                    type:
                        membership.membership_type,

                    status:
                        membership.status,

                    role:
                        membership.role,

                    joinedAt:
                        membership.joined_at,

                    isPrimary:
                        membership.is_primary
                }
                : null,

            handicap: handicap
                ? {
                    id:
                        handicap.id,

                    index:
                        handicap.handicap_index ===
                        null
                            ? null
                            : Number(
                                handicap.handicap_index
                            ),

                    governingBody:
                        handicap.governing_body,

                    externalMemberId:
                        handicap.external_member_id ||
                        null,

                    verificationStatus:
                        handicap.verification_status,

                    verifiedAt:
                        handicap.verified_at,

                    lastCheckedAt:
                        handicap.last_checked_at,

                    sourceUpdatedAt:
                        handicap.source_updated_at
                }
                : null
        };
    }

    function getClient() {
        if (!window.supabaseClient) {
            throw new Error(
                "Supabase client is unavailable."
            );
        }

        return window.supabaseClient;
    }

    async function getAuthenticatedUser() {
        const client =
            getClient();

        const {
            data: { user },
            error
        } = await client.auth.getUser();

        if (error) {
            throw error;
        }

        if (!user) {
            throw new Error(
                "No authenticated user was found."
            );
        }

        return user;
    }

    async function fetchProfile(userId) {
        const client =
            getClient();

        const { data, error } =
            await client
                .from("profiles")
                .select(`
                    id,
                    first_name,
                    last_name,
                    display_name,
                    phone,
                    avatar_url,
                    created_at,
                    updated_at
                `)
                .eq("id", userId)
                .maybeSingle();

        if (error) {
            throw error;
        }

        return data;
    }

    async function fetchPrimaryMembership(
        userId
    ) {
        const client =
            getClient();

        const { data, error } =
            await client
                .from("club_memberships")
                .select(`
                    id,
                    profile_id,
                    club_id,
                    membership_number,
                    membership_type,
                    status,
                    role,
                    joined_at,
                    is_primary,
                    created_at,
                    updated_at,

                    clubs (
                        id,
                        name
                    )
                `)
                .eq(
                    "profile_id",
                    userId
                )
                .eq(
                    "status",
                    "active"
                )
                .order(
                    "is_primary",
                    {
                        ascending: false
                    }
                )
                .order(
                    "created_at",
                    {
                        ascending: true
                    }
                )
                .limit(1)
                .maybeSingle();

        if (error) {
            throw error;
        }

        return data;
    }

    async function fetchHandicap(userId) {
        const client =
            getClient();

        const { data, error } =
            await client
                .from("player_handicaps")
                .select(`
                    id,
                    profile_id,
                    governing_body,
                    external_member_id,
                    handicap_index,
                    verification_status,
                    verified_at,
                    last_checked_at,
                    source_updated_at,
                    created_at,
                    updated_at
                `)
                .eq(
                    "profile_id",
                    userId
                )
                .maybeSingle();

        if (error) {
            throw error;
        }

        return data;
    }

    function exposeProfile(profile) {
        window.Paryx.currentProfile =
            profile;

        window.paryxProfile =
            profile;
    }

    function clearProfileCache() {
        cachedProfile = null;
        cachedUserId = null;

        loadingPromise = null;
        loadingUserId = null;

        window.Paryx.currentProfile =
            null;

        window.paryxProfile =
            null;
    }

    async function loadProfile(
        options = {}
    ) {
        const forceRefresh =
            options.forceRefresh === true;

        const user =
            await getAuthenticatedUser();

        /*
         * Never return profile data belonging to another
         * authenticated account.
         */
        if (
            cachedProfile &&
            cachedUserId === user.id &&
            !forceRefresh
        ) {
            exposeProfile(
                cachedProfile
            );

            return cachedProfile;
        }

        if (
            cachedUserId &&
            cachedUserId !== user.id
        ) {
            clearProfileCache();
        }

        if (
            loadingPromise &&
            loadingUserId === user.id &&
            !forceRefresh
        ) {
            return loadingPromise;
        }

        loadingUserId =
            user.id;

        loadingPromise =
            (async function () {
                const [
                    profile,
                    membership,
                    handicap
                ] = await Promise.all([
                    fetchProfile(user.id),
                    fetchPrimaryMembership(
                        user.id
                    ),
                    fetchHandicap(user.id)
                ]);

                /*
                 * Confirm the authenticated account has not
                 * changed while the requests were running.
                 */
                const latestUser =
                    await getAuthenticatedUser();

                if (
                    latestUser.id !== user.id
                ) {
                    throw new Error(
                        "The authenticated account changed while the profile was loading."
                    );
                }

                cachedProfile =
                    normaliseProfileData(
                        user,
                        profile,
                        membership,
                        handicap
                    );

                cachedUserId =
                    user.id;

                exposeProfile(
                    cachedProfile
                );

                return cachedProfile;
            })();

        try {
            return await loadingPromise;
        } catch (error) {
            console.error(
                "Paryx profile loading failed:",
                error
            );

            if (
                loadingUserId ===
                user.id
            ) {
                cachedProfile = null;
                cachedUserId = null;
            }

            throw error;
        } finally {
            if (
                loadingUserId ===
                user.id
            ) {
                loadingPromise = null;
                loadingUserId = null;
            }
        }
    }

    async function refreshProfile() {
        return loadProfile({
            forceRefresh: true
        });
    }

    function getCachedProfile() {
        return cachedProfile;
    }

    function getCachedUserId() {
        return cachedUserId;
    }

    window.Paryx.profile = {
        load:
            loadProfile,

        refresh:
            refreshProfile,

        getCached:
            getCachedProfile,

        getCachedUserId,

        clearCache:
            clearProfileCache
    };
})();