(function () {
    "use strict";

    const script = document.currentScript;
    if (!script) return;

    const club = String(
        script.dataset.paryxClub ||
        script.getAttribute("data-club") ||
        ""
    ).trim().toLowerCase();

    if (!club) {
        console.error("Paryx booking widget: add data-paryx-club=\"your-club-slug\" to the embed script.");
        return;
    }

    const src = new URL("index.html", script.src);
    src.searchParams.set("club", club);

    const iframe = document.createElement("iframe");
    iframe.src = src.href;
    iframe.title = "Book a tee time";
    iframe.loading = "lazy";
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.style.width = "100%";
    iframe.style.height = "760px";
    iframe.style.border = "0";
    iframe.style.display = "block";
    iframe.style.background = "transparent";

    script.insertAdjacentElement("afterend", iframe);

    window.addEventListener("message", function (event) {
        if (
            event.source !== iframe.contentWindow ||
            event.data?.type !== "paryx-widget-resize" ||
            event.data?.club !== club
        ) {
            return;
        }

        const height = Math.max(420, Math.min(1800, Number(event.data.height || 0)));
        if (Number.isFinite(height)) {
            iframe.style.height = `${height}px`;
        }
    });
})();
