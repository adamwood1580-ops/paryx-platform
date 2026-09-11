(function () {
    "use strict";

    /*
     * Paryx Membership Identity v2 privacy guard.
     *
     * ClubHub manages club-owned membership records. Whether a membership is
     * linked to a global Paryx Player account is deliberately a Paryx-only
     * concern and must not be shown or inferred in the club UI.
     *
     * This guard removes the legacy member-card Details block that contained
     * "ClubHub role" and "Paryx identity" whenever the member list renders.
     */

    const MEMBER_LIST_ID = "memberList";
    const TARGET_LABELS = [
        "clubhub role",
        "paryx identity"
    ];

    function normalise(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function isExactText(element, value) {
        return element && normalise(element.textContent) === value;
    }

    function findExact(root, value) {
        return Array.from(root.querySelectorAll("*")).filter(function (element) {
            return isExactText(element, value);
        });
    }

    function containsExactDescendant(root, value) {
        return Array.from(root.querySelectorAll("*")).some(function (element) {
            return isExactText(element, value);
        });
    }

    function findDetailsContainer(identityLabel, memberList) {
        let candidate = identityLabel.parentElement;
        let depth = 0;

        while (
            candidate &&
            candidate !== memberList &&
            depth < 8
        ) {
            const hasRole =
                containsExactDescendant(candidate, TARGET_LABELS[0]);
            const hasIdentity =
                containsExactDescendant(candidate, TARGET_LABELS[1]);
            const hasDetailsHeading =
                containsExactDescendant(candidate, "details");

            if (hasRole && hasIdentity && hasDetailsHeading) {
                return candidate;
            }

            candidate = candidate.parentElement;
            depth += 1;
        }

        return null;
    }

    function removeLegacyIdentityDetails(memberList) {
        const identityLabels = findExact(
            memberList,
            TARGET_LABELS[1]
        );

        identityLabels.forEach(function (identityLabel) {
            const detailsContainer =
                findDetailsContainer(identityLabel, memberList);

            if (detailsContainer) {
                detailsContainer.remove();
                return;
            }

            /*
             * Conservative fallback: if the legacy markup changes, remove
             * only the individual Paryx/account rows and explanatory copy.
             * Never remove the containing member card unless we positively
             * identify the complete Details block above.
             */
            const roleLabels = findExact(memberList, TARGET_LABELS[0]);

            [identityLabel].concat(roleLabels).forEach(function (label) {
                const row = label.parentElement;
                if (row && row !== memberList) {
                    row.remove();
                }
            });

            Array.from(memberList.querySelectorAll("p,small")).forEach(
                function (element) {
                    const text = normalise(element.textContent);
                    if (
                        text.includes("identity belongs to paryx") ||
                        text.includes("paryx account") ||
                        text.includes("clubhub never receives")
                    ) {
                        element.remove();
                    }
                }
            );
        });
    }

    function initialise() {
        const memberList = document.getElementById(MEMBER_LIST_ID);

        if (!memberList) {
            return;
        }

        removeLegacyIdentityDetails(memberList);

        const observer = new MutationObserver(function () {
            removeLegacyIdentityDetails(memberList);
        });

        observer.observe(memberList, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialise,
            { once: true }
        );
    } else {
        initialise();
    }
})();
