(function () {
    "use strict";

    /*
     * Paryx Membership Identity v2 — ClubHub privacy guard v0.24.2
     *
     * ClubHub must not reveal or imply whether a club member has a Paryx
     * Player account. Remove the legacy member-detail UI that exposes:
     *   - ClubHub role
     *   - Paryx account / global identity
     *   - explanatory Paryx account identity copy
     *
     * This runs document-wide because the member editor/detail panel may be
     * rendered outside #memberList.
     */

    const HIDDEN_LABELS = new Set([
        "clubhub role",
        "paryx account",
        "paryx identity"
    ]);

    function normalise(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function isLeafLike(element) {
        return element && element.children.length === 0;
    }

    function hideElement(element) {
        if (!element || element === document.body || element === document.documentElement) {
            return;
        }
        element.hidden = true;
        element.style.setProperty("display", "none", "important");
        element.setAttribute("aria-hidden", "true");
    }

    function findSmallestFieldContainer(label) {
        let candidate = label.parentElement;
        let depth = 0;

        while (candidate && candidate !== document.body && depth < 5) {
            const text = normalise(candidate.textContent);

            // An individual detail tile normally contains only its label/value.
            // Stop before accidentally hiding the whole 2x2 details grid.
            if (
                text.length <= 180 &&
                !text.includes("email") &&
                !text.includes("handicap index") &&
                !text.includes("membership number")
            ) {
                return candidate;
            }

            candidate = candidate.parentElement;
            depth += 1;
        }

        return label.parentElement;
    }

    function hideIdentityFields(root) {
        const elements = Array.from(root.querySelectorAll("span,strong,label,div,p,small"));

        for (const element of elements) {
            const text = normalise(element.textContent);

            if (HIDDEN_LABELS.has(text)) {
                hideElement(findSmallestFieldContainer(element));
                continue;
            }

            // Remove the explanatory block shown below the four detail tiles.
            if (
                text.includes("global paryx account") &&
                (
                    text.includes("clubhub edits only") ||
                    text.includes("account identity belong") ||
                    text.includes("account identity belongs")
                )
            ) {
                let container = element;

                // Prefer the smallest standalone info block rather than a large
                // editor/card wrapper that may also contain membership fields.
                for (let i = 0; i < 3 && container.parentElement; i += 1) {
                    const parent = container.parentElement;
                    const parentText = normalise(parent.textContent);
                    if (
                        parentText.length <= 420 &&
                        !parentText.includes("membership number") &&
                        !parentText.includes("membership type")
                    ) {
                        container = parent;
                    } else {
                        break;
                    }
                }

                hideElement(container);
            }
        }
    }

    function scrub() {
        hideIdentityFields(document);
    }

    function initialise() {
        scrub();

        const observer = new MutationObserver(function () {
            scrub();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialise, { once: true });
    } else {
        initialise();
    }
})();
